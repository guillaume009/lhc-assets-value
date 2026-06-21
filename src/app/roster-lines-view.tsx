"use client";

import { useMemo, useState, type DragEvent } from "react";

import { PlayerLink } from "@/app/player-link";
import type { Position } from "@/lib/domain";
import type { DirectoryPlayer } from "@/lib/player-directory";
import { formatMillions } from "@/lib/salary-cap";

type LineupPlayer = Pick<
  DirectoryPlayer,
  "age" | "capHit" | "contractStatus" | "id" | "inMinors" | "name" | "position" | "role" | "score" | "team" | "yearsRemaining"
> & {
  isTemporaryGuest?: boolean;
};

type RosterLinesViewProps = {
  availablePlayers: LineupPlayer[];
  players: LineupPlayer[];
  teamName: string;
  view?: "breakdown" | "lines";
};

type SortDirection = "asc" | "desc";
type ContractBreakdownFilter = "all" | "signed-next-year" | "unsigned-next-year";

type LevelKey = "nhl" | "farm";
type FamilyKey = "forward" | "defense" | "goalie";
type ContractBreakdownSortKey = "age" | "default" | "name" | "position" | `season:${number}`;

type ContractBreakdownSortState = {
  direction: SortDirection;
  key: ContractBreakdownSortKey;
};

type SlotDefinition = {
  id: string;
  family: FamilyKey;
  isExtra?: boolean;
  label: string;
  level: LevelKey;
  lineNumber?: number;
  position: Position;
  shortLabel: string;
};

type LevelChart = {
  defensePairs: SlotDefinition[][];
  extraGroups: Array<{ family: FamilyKey; slots: SlotDefinition[] }>;
  forwardLines: SlotDefinition[][];
  goalieSlots: SlotDefinition[];
};

type DepthChartLayout = {
  charts: Record<LevelKey, LevelChart>;
  initialAssignments: Record<string, string | null>;
};

type SavedRosterLinesLayout = {
  assignments: Record<string, string | null>;
  temporaryPlayerIds: string[];
};

const familyByPosition: Record<Position, FamilyKey> = {
  C: "forward",
  G: "goalie",
  LD: "defense",
  LW: "forward",
  RD: "defense",
  RW: "forward",
};

const slotPreferences: Record<Position, Position[]> = {
  C: ["C", "LW", "RW"],
  G: ["G"],
  LD: ["LD", "RD"],
  LW: ["LW", "RW", "C"],
  RD: ["RD", "LD"],
  RW: ["RW", "LW", "C"],
};

const levelCopy: Record<LevelKey, { description: string; title: string }> = {
  farm: {
    description: "Bottom six, extra defenders, and tandem depth for the minor-league club.",
    title: "Farm depth chart",
  },
  nhl: {
    description: "Projected NHL lineup with four forward lines, three pairs, and the goalie tandem.",
    title: "NHL depth chart",
  },
};

const extraFamilyLabels: Record<FamilyKey, string> = {
  defense: "Extra defense",
  forward: "Extra forwards",
  goalie: "Extra goalies",
};

const contractBreakdownGroupCopy: Record<FamilyKey, { title: string; shortTitle: string }> = {
  defense: {
    shortTitle: "D",
    title: "Defense",
  },
  forward: {
    shortTitle: "F",
    title: "Forwards",
  },
  goalie: {
    shortTitle: "G",
    title: "Goaltenders",
  },
};

const maxDisplayedContractYears = 8;
const minimumRosterContracts = 43;
const maximumRosterContracts = 50;

const getRosterLinesLayoutStorageKey = (teamName: string) => `nhl-sim-asset-tool:roster-lines-layout:${teamName}`;

const createPositionBuckets = (): Record<Position, LineupPlayer[]> => ({
  C: [],
  G: [],
  LD: [],
  LW: [],
  RD: [],
  RW: [],
});

const sortPlayersForDepthChart = (players: LineupPlayer[]) =>
  [...players].sort(
    (left, right) =>
      right.score - left.score ||
      right.capHit - left.capHit ||
      left.age - right.age ||
      left.name.localeCompare(right.name),
  );

const compareByDepthChartDefault = (left: LineupPlayer, right: LineupPlayer) => {
  const ordered = sortPlayersForDepthChart([left, right]);

  if (ordered[0]?.id === left.id) {
    return -1;
  }

  if (ordered[0]?.id === right.id) {
    return 1;
  }

  return 0;
};

const defaultContractBreakdownSortStateByFamily: Record<FamilyKey, ContractBreakdownSortState> = {
  defense: { direction: "desc", key: "default" },
  forward: { direction: "desc", key: "default" },
  goalie: { direction: "desc", key: "default" },
};

const buildCoreChart = (level: LevelKey): LevelChart => ({
  defensePairs: Array.from({ length: 3 }, (_, index) => [
    {
      family: "defense",
      id: `${level}-defense-${index + 1}-ld`,
      label: `${index + 1}${ordinalSuffix(index + 1)} pair left defense`,
      level,
      lineNumber: index + 1,
      position: "LD",
      shortLabel: `P${index + 1} LD`,
    },
    {
      family: "defense",
      id: `${level}-defense-${index + 1}-rd`,
      label: `${index + 1}${ordinalSuffix(index + 1)} pair right defense`,
      level,
      lineNumber: index + 1,
      position: "RD",
      shortLabel: `P${index + 1} RD`,
    },
  ]),
  extraGroups: [],
  forwardLines: Array.from({ length: 4 }, (_, index) => [
    {
      family: "forward",
      id: `${level}-forward-${index + 1}-lw`,
      label: `${index + 1}${ordinalSuffix(index + 1)} line left wing`,
      level,
      lineNumber: index + 1,
      position: "LW",
      shortLabel: `L${index + 1} LW`,
    },
    {
      family: "forward",
      id: `${level}-forward-${index + 1}-c`,
      label: `${index + 1}${ordinalSuffix(index + 1)} line center`,
      level,
      lineNumber: index + 1,
      position: "C",
      shortLabel: `L${index + 1} C`,
    },
    {
      family: "forward",
      id: `${level}-forward-${index + 1}-rw`,
      label: `${index + 1}${ordinalSuffix(index + 1)} line right wing`,
      level,
      lineNumber: index + 1,
      position: "RW",
      shortLabel: `L${index + 1} RW`,
    },
  ]),
  goalieSlots: [
    {
      family: "goalie",
      id: `${level}-goalie-1`,
      label: "Starter",
      level,
      lineNumber: 1,
      position: "G",
      shortLabel: "Starter",
    },
    {
      family: "goalie",
      id: `${level}-goalie-2`,
      label: "Backup",
      level,
      lineNumber: 2,
      position: "G",
      shortLabel: "Backup",
    },
  ],
});

const getCoreSlots = (chart: LevelChart) => [
  ...chart.forwardLines.flat(),
  ...chart.defensePairs.flat(),
  ...chart.goalieSlots,
];

const takeNextPlayer = (
  preferences: Position[],
  buckets: Record<Position, LineupPlayer[]>,
  usedPlayerIds: Set<string>,
) => {
  for (const position of preferences) {
    const bucket = buckets[position];

    while (bucket.length > 0) {
      const candidate = bucket.shift();

      if (candidate && !usedPlayerIds.has(candidate.id)) {
        return candidate;
      }
    }
  }

  return null;
};

const collectRemainingPlayers = (
  family: FamilyKey,
  buckets: Record<Position, LineupPlayer[]>,
  usedPlayerIds: Set<string>,
) => {
  const positions = (Object.keys(buckets) as Position[]).filter((position) => familyByPosition[position] === family);

  return positions.flatMap((position) => buckets[position].filter((player) => !usedPlayerIds.has(player.id)));
};

const buildLevelLayout = (level: LevelKey, players: LineupPlayer[]) => {
  const chart = buildCoreChart(level);
  const assignments: Record<string, string | null> = {};
  const usedPlayerIds = new Set<string>();
  const sortedPlayers = sortPlayersForDepthChart(players);
  const buckets = createPositionBuckets();

  for (const player of sortedPlayers) {
    buckets[player.position].push(player);
  }

  const coreSlots = getCoreSlots(chart);

  for (const slot of coreSlots) {
    assignments[slot.id] = null;
  }

  for (const slot of coreSlots) {
    const exactFit = takeNextPlayer([slot.position], buckets, usedPlayerIds);

    if (!exactFit) {
      continue;
    }

    usedPlayerIds.add(exactFit.id);
    assignments[slot.id] = exactFit.id;
  }

  for (const slot of chart.forwardLines.flat().filter((candidate) => assignments[candidate.id] === null)) {
    const fallback = takeNextPlayer(slotPreferences[slot.position].slice(1), buckets, usedPlayerIds);

    if (!fallback) {
      continue;
    }

    usedPlayerIds.add(fallback.id);
    assignments[slot.id] = fallback.id;
  }

  for (const slot of chart.defensePairs.flat().filter((candidate) => assignments[candidate.id] === null)) {
    const fallback = takeNextPlayer(slotPreferences[slot.position].slice(1), buckets, usedPlayerIds);

    if (!fallback) {
      continue;
    }

    usedPlayerIds.add(fallback.id);
    assignments[slot.id] = fallback.id;
  }

  const extraGroups = (Object.keys(extraFamilyLabels) as FamilyKey[])
    .map((family) => {
      const leftovers = collectRemainingPlayers(family, buckets, usedPlayerIds);
      const slots = leftovers.map((player, index) => ({
        family,
        id: `${level}-extra-${family}-${index + 1}`,
        isExtra: true,
        label: `${extraFamilyLabels[family]} ${index + 1}`,
        level,
        position: player.position,
        shortLabel: `X${index + 1}`,
      }));

      slots.forEach((slot, index) => {
        assignments[slot.id] = leftovers[index]?.id ?? null;
      });

      return { family, slots };
    })
    .filter((group) => group.slots.length > 0);

  chart.extraGroups = extraGroups;

  return { assignments, chart };
};

const buildDepthChartLayout = (players: LineupPlayer[]): DepthChartLayout => {
  const groups: Record<LevelKey, RosterScore[]> = {
    farm: [],
    nhl: [],
  };

  for (const player of players) {
    groups[player.inMinors ? "farm" : "nhl"].push(player);
  }

  const nhlLayout = buildLevelLayout("nhl", groups.nhl);
  const farmLayout = buildLevelLayout("farm", groups.farm);

  return {
    charts: {
      farm: farmLayout.chart,
      nhl: nhlLayout.chart,
    },
    initialAssignments: {
      ...nhlLayout.assignments,
      ...farmLayout.assignments,
    },
  };
};

const ordinalSuffix = (value: number) => {
  if (value % 100 >= 11 && value % 100 <= 13) {
    return "th";
  }

  switch (value % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
};

const contractPalette = (player: LineupPlayer) => {
  switch (player.contractStatus) {
    case "prospect":
      return {
        badge: "border border-sky-200 bg-sky-50 text-sky-700",
        empty: "bg-sky-100/80",
        filled: "bg-sky-500",
      };
    case "rfa":
      return {
        badge: "border border-emerald-200 bg-emerald-50 text-emerald-700",
        empty: "bg-emerald-100/80",
        filled: "bg-emerald-500",
      };
    case "ufa":
      return {
        badge: "border border-amber-200 bg-amber-50 text-amber-700",
        empty: "bg-amber-100/80",
        filled: "bg-amber-500",
      };
    case "signed":
      return {
        badge: "border border-slate-200 bg-slate-100 text-slate-700",
        empty: "bg-slate-200/80",
        filled: "bg-slate-500",
      };
  }
};

const contractLabel = (player: LineupPlayer) => {
  if (player.contractStatus === "prospect") {
    return player.yearsRemaining > 0 ? `Prospect · ${player.yearsRemaining}Y` : "Prospect";
  }

  if (player.contractStatus === "ufa") {
    return player.yearsRemaining > 0 ? `UFA in ${player.yearsRemaining}Y` : "UFA now";
  }

  if (player.contractStatus === "rfa") {
    return player.yearsRemaining > 0 ? `RFA in ${player.yearsRemaining}Y` : "RFA now";
  }

  return player.yearsRemaining > 0 ? `${player.yearsRemaining}Y left` : "Signed";
};

const contractYearsFilled = (player: LineupPlayer) => Math.max(0, Math.min(maxDisplayedContractYears, player.yearsRemaining));

const compactPlayerName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length <= 1) {
    return name;
  }

  const firstInitial = parts[0]?.[0]?.toUpperCase();
  const remainder = parts.slice(1).join(" ");

  return firstInitial ? `${firstInitial}. ${remainder}` : name;
};

const getCurrentSimulationYear = (now: Date = new Date()) => now.getUTCFullYear();

const formatSimulationSeason = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

const getContractBreakdownActiveSeasons = (player: LineupPlayer) => {
  if (player.contractStatus === "signed") {
    return Math.max(0, player.yearsRemaining + 1);
  }

  return Math.max(0, player.yearsRemaining);
};

const getPostContractStatus = (player: LineupPlayer) => {
  if (player.contractStatus === "signed") {
    return player.age <= 27 ? "rfa" : "ufa";
  }

  return player.contractStatus;
};

const getContractBreakdownEndpoint = (player: LineupPlayer) => {
  switch (getPostContractStatus(player)) {
    case "prospect":
      return {
        className: "border border-sky-200 bg-sky-50 text-sky-700",
        label: "OPEN",
        title: "Rights window ends",
      };
    case "rfa":
      return {
        className: "border border-emerald-200 bg-emerald-50 text-emerald-700",
        label: "RFA",
        title: "Restricted free agent",
      };
    case "ufa":
      return {
        className: "border border-amber-200 bg-amber-50 text-amber-700",
        label: "UFA",
        title: "Unrestricted free agent",
      };
  }
};

const getContractBreakdownCell = (player: LineupPlayer, yearOffset: number) => {
  if (yearOffset < 0) {
    if (player.contractStatus === "prospect") {
      return {
        className: "border border-sky-200 bg-sky-50 text-sky-700",
        label: "PRO",
        title: "Prospect rights this season",
      };
    }

    return {
      className: `${contractPalette(player).badge} min-w-[5.75rem] justify-center`,
      label: formatMillions(player.capHit),
      title: "Current season cap hit",
    };
  }

  const activeSeasons = getContractBreakdownActiveSeasons(player);
  const palette = contractPalette(player);

  if (player.contractStatus === "prospect") {
    if (yearOffset < activeSeasons) {
      return {
        className: "border border-sky-200 bg-sky-50 text-sky-700",
        label: "PRO",
        title: yearOffset === 0 ? "Prospect rights next season" : `Prospect rights carry into year ${yearOffset + 1}`,
      };
    }

    if (yearOffset === activeSeasons) {
      return getContractBreakdownEndpoint(player);
    }

    return null;
  }

  if (yearOffset < activeSeasons) {
    return {
      className: `${palette.badge} min-w-[5.75rem] justify-center`,
      label: formatMillions(player.capHit),
      title: yearOffset === 0 ? "Projected cap hit next season" : `Projected cap hit in year ${yearOffset + 1}`,
    };
  }

  if (yearOffset === activeSeasons) {
    return getContractBreakdownEndpoint(player);
  }

  return null;
};

const isSignedForNextYear = (player: LineupPlayer) => getContractBreakdownActiveSeasons(player) > 0;

const getContractBreakdownSortValue = (player: LineupPlayer, yearOffset: number) => {
  if (yearOffset < 0) {
    if (player.contractStatus === "prospect") {
      return {
        kindRank: 3,
        numericValue: 1,
        textValue: "PRO",
      };
    }

    return {
      kindRank: 4,
      numericValue: player.capHit,
      textValue: formatMillions(player.capHit),
    };
  }

  const activeSeasons = getContractBreakdownActiveSeasons(player);

  if (player.contractStatus === "prospect") {
    if (yearOffset < activeSeasons) {
      return {
        kindRank: 3,
        numericValue: activeSeasons - yearOffset,
        textValue: "PRO",
      };
    }

    if (yearOffset === activeSeasons) {
      return {
        kindRank: 2,
        numericValue: 0,
        textValue: "OPEN",
      };
    }

    return {
      kindRank: 0,
      numericValue: 0,
      textValue: "",
    };
  }

  if (yearOffset < activeSeasons) {
    return {
      kindRank: 4,
      numericValue: player.capHit,
      textValue: formatMillions(player.capHit),
    };
  }

  if (yearOffset === activeSeasons) {
    const endpoint = getContractBreakdownEndpoint(player);
    const postContractStatus = getPostContractStatus(player);

    return {
      kindRank: 1,
      numericValue:
        postContractStatus === "rfa" ? 3 : postContractStatus === "ufa" ? 2 : 0,
      textValue: endpoint.label,
    };
  }

  return {
    kindRank: 0,
    numericValue: 0,
    textValue: "",
  };
};

const compareContractBreakdownPlayers = (
  left: LineupPlayer,
  right: LineupPlayer,
  sortState: ContractBreakdownSortState,
) => {
  switch (sortState.key) {
    case "default":
      return compareByDepthChartDefault(left, right);
    case "name":
      return left.name.localeCompare(right.name) || compareByDepthChartDefault(left, right);
    case "position":
      return left.position.localeCompare(right.position) || left.name.localeCompare(right.name);
    case "age":
      return left.age - right.age || left.name.localeCompare(right.name);
    default: {
      const seasonIndex = Number.parseInt(sortState.key.slice("season:".length), 10);
      const leftValue = getContractBreakdownSortValue(left, seasonIndex);
      const rightValue = getContractBreakdownSortValue(right, seasonIndex);

      return (
        leftValue.kindRank - rightValue.kindRank ||
        leftValue.numericValue - rightValue.numericValue ||
        leftValue.textValue.localeCompare(rightValue.textValue) ||
        left.name.localeCompare(right.name)
      );
    }
  }
};

const sortContractBreakdownPlayers = (
  players: LineupPlayer[],
  sortState: ContractBreakdownSortState,
) => {
  if (sortState.key === "default") {
    return sortState.direction === "desc" ? players : [...players].reverse();
  }

  return [...players].sort((left, right) => {
    const result = compareContractBreakdownPlayers(left, right, sortState);

    return sortState.direction === "asc" ? result : -result;
  });
};

const renderSortLabel = (isActive: boolean, direction: SortDirection) => {
  if (!isActive) {
    return "↕";
  }

  return direction === "asc" ? "↑" : "↓";
};

const getContractBreakdownInitialDirection = (key: ContractBreakdownSortKey): SortDirection => {
  if (key === "name" || key === "position") {
    return "asc";
  }

  return "desc";
};

const levelSummary = (chart: LevelChart, assignments: Record<string, string | null>) => {
  const forwardCount = chart.forwardLines.flat().filter((slot) => assignments[slot.id]).length;
  const defenseCount = chart.defensePairs.flat().filter((slot) => assignments[slot.id]).length;
  const goalieCount = chart.goalieSlots.filter((slot) => assignments[slot.id]).length;

  return `${forwardCount}/12 F · ${defenseCount}/6 D · ${goalieCount}/2 G assigned`;
};

const areTemporaryPlayerIdsEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((playerId, index) => playerId === right[index]);
};

const areAssignmentsEqual = (left: Record<string, string | null>, right: Record<string, string | null>) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((slotId) => left[slotId] === right[slotId]);
};

const readSavedRosterLinesLayout = (teamName: string): SavedRosterLinesLayout | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(getRosterLinesLayoutStorageKey(teamName));

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as {
      assignments?: unknown;
      temporaryPlayerIds?: unknown;
    };

    if (!parsedValue || typeof parsedValue !== "object") {
      return null;
    }

    const assignments = Object.fromEntries(
      Object.entries(parsedValue.assignments ?? {}).filter((entry): entry is [string, string | null] => {
        const value = entry[1];

        return typeof value === "string" || value === null;
      }),
    );

    const temporaryPlayerIds = Array.isArray(parsedValue.temporaryPlayerIds)
      ? parsedValue.temporaryPlayerIds.filter((playerId): playerId is string => typeof playerId === "string")
      : [];

    return {
      assignments,
      temporaryPlayerIds,
    };
  } catch {
    return null;
  }
};

const restoreSavedRosterLinesLayout = (
  players: LineupPlayer[],
  externalPlayersById: Map<string, LineupPlayer>,
  savedLayout: SavedRosterLinesLayout,
) => {
  const temporaryPlayerIds = savedLayout.temporaryPlayerIds.filter((playerId) => externalPlayersById.has(playerId));
  const temporaryPlayers = temporaryPlayerIds.flatMap((playerId) => {
    const player = externalPlayersById.get(playerId);

    return player ? [{ ...player, isTemporaryGuest: true }] : [];
  });
  const resolvedPlayers = [...players, ...temporaryPlayers];
  const resolvedLayout = buildDepthChartLayout(resolvedPlayers);
  const availablePlayerIds = new Set(resolvedPlayers.map((player) => player.id));
  const nextAssignments = Object.fromEntries(
    Object.keys(resolvedLayout.initialAssignments).map((slotId) => [slotId, null] as const),
  ) as Record<string, string | null>;
  const usedPlayerIds = new Set<string>();

  for (const slotId of Object.keys(resolvedLayout.initialAssignments)) {
    const savedPlayerId = savedLayout.assignments[slotId];

    if (typeof savedPlayerId !== "string" || !availablePlayerIds.has(savedPlayerId) || usedPlayerIds.has(savedPlayerId)) {
      continue;
    }

    nextAssignments[slotId] = savedPlayerId;
    usedPlayerIds.add(savedPlayerId);
  }

  for (const [slotId, playerId] of Object.entries(resolvedLayout.initialAssignments)) {
    if (nextAssignments[slotId] !== null || typeof playerId !== "string" || usedPlayerIds.has(playerId)) {
      continue;
    }

    nextAssignments[slotId] = playerId;
    usedPlayerIds.add(playerId);
  }

  return {
    assignments: nextAssignments,
    temporaryPlayerIds,
  };
};

const saveRosterLinesLayout = (teamName: string, nextLayout: SavedRosterLinesLayout) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getRosterLinesLayoutStorageKey(teamName), JSON.stringify(nextLayout));
};

const buildInitialRosterLinesLayout = (
  players: LineupPlayer[],
  externalPlayersById: Map<string, LineupPlayer>,
  teamName: string,
): SavedRosterLinesLayout => {
  const savedLayout = readSavedRosterLinesLayout(teamName);

  if (!savedLayout) {
    return {
      assignments: buildDepthChartLayout(players).initialAssignments,
      temporaryPlayerIds: [],
    };
  }

  return restoreSavedRosterLinesLayout(players, externalPlayersById, savedLayout);
};

export function RosterLinesView({ availablePlayers, players, teamName, view = "lines" }: RosterLinesViewProps) {
  const [guestQuery, setGuestQuery] = useState("");
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [contractBreakdownFilter, setContractBreakdownFilter] = useState<ContractBreakdownFilter>("all");
  const [contractBreakdownSortStateByFamily, setContractBreakdownSortStateByFamily] = useState<
    Record<FamilyKey, ContractBreakdownSortState>
  >(defaultContractBreakdownSortStateByFamily);

  const externalPlayersById = useMemo(
    () =>
      new Map(
        availablePlayers
          .filter((player) => player.team !== teamName)
          .map((player) => [player.id, player] as const),
      ),
    [availablePlayers, teamName],
  );
  const [initialLayoutState] = useState<SavedRosterLinesLayout>(() =>
    buildInitialRosterLinesLayout(players, externalPlayersById, teamName),
  );
  const [savedLayoutState, setSavedLayoutState] = useState<SavedRosterLinesLayout>(initialLayoutState);
  const [temporaryPlayerIds, setTemporaryPlayerIds] = useState<string[]>(initialLayoutState.temporaryPlayerIds);

  const temporaryPlayers = useMemo(
    () =>
      temporaryPlayerIds.flatMap((playerId) => {
        const player = externalPlayersById.get(playerId);

        return player ? [{ ...player, isTemporaryGuest: true }] : [];
      }),
    [temporaryPlayerIds, externalPlayersById],
  );

  const buildTemporaryPlayersFromIds = (playerIds: string[]) =>
    playerIds.flatMap((playerId) => {
      const player = externalPlayersById.get(playerId);

      return player ? [{ ...player, isTemporaryGuest: true }] : [];
    });

  const buildAssignmentsForTemporaryIds = (
    playerIds: string[],
    currentAssignments?: Record<string, string | null>,
  ) => {
    const nextLineupPlayers = [...players, ...buildTemporaryPlayersFromIds(playerIds)];
    const nextLayout = buildDepthChartLayout(nextLineupPlayers);
    const mergedAssignments = currentAssignments
      ? {
          ...nextLayout.initialAssignments,
          ...Object.fromEntries(
            Object.entries(currentAssignments).filter(([slotId]) => slotId in nextLayout.initialAssignments),
          ),
        }
      : nextLayout.initialAssignments;

    return {
      nextAssignments: mergedAssignments,
      nextLayout,
    };
  };

  const lineupPlayers = useMemo(() => [...players, ...temporaryPlayers], [players, temporaryPlayers]);
  const playersById = useMemo(() => new Map(lineupPlayers.map((player) => [player.id, player])), [lineupPlayers]);
  const layout = useMemo(() => buildDepthChartLayout(lineupPlayers), [lineupPlayers]);
  const initialSlotByPlayerId = useMemo(
    () =>
      new Map(
        Object.entries(layout.initialAssignments)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([slotId, playerId]) => [playerId, slotId] as const),
      ),
    [layout.initialAssignments],
  );
  const [assignments, setAssignments] = useState<Record<string, string | null>>(initialLayoutState.assignments);
  const defaultAssignments = useMemo(() => buildDepthChartLayout(players).initialAssignments, [players]);
  const contractBreakdownStartYear = useMemo(() => getCurrentSimulationYear(), []);
  const contractBreakdownCurrentSeasonStartYear = useMemo(() => contractBreakdownStartYear - 1, [contractBreakdownStartYear]);
  const contractBreakdownSeasonCount = useMemo(
    () => Math.max(5, Math.min(maxDisplayedContractYears, Math.max(...players.map((player) => player.yearsRemaining), 0) + 2)),
    [players],
  );
  const contractBreakdownSeasons = useMemo(
    () => Array.from({ length: contractBreakdownSeasonCount }, (_, index) => contractBreakdownStartYear + index),
    [contractBreakdownSeasonCount, contractBreakdownStartYear],
  );
  const contractBreakdownGroups = useMemo(() => {
    const groups: Record<FamilyKey, LineupPlayer[]> = {
      defense: [],
      forward: [],
      goalie: [],
    };

    for (const player of sortPlayersForDepthChart(players)) {
      groups[familyByPosition[player.position]].push(player);
    }

    return (["forward", "defense", "goalie"] as const)
      .map((family) => ({
        capCommitted: groups[family].reduce(
          (total, player) => total + (player.contractStatus === "prospect" ? 0 : player.capHit),
          0,
        ),
        family,
        players: groups[family],
      }))
      .filter((group) => group.players.length > 0);
  }, [players]);
  const filteredContractBreakdownGroups = useMemo(() => {
    return contractBreakdownGroups
      .map((group) => {
        const filteredPlayers = group.players.filter((player) => {
          if (contractBreakdownFilter === "signed-next-year") {
            return isSignedForNextYear(player);
          }

          if (contractBreakdownFilter === "unsigned-next-year") {
            return !isSignedForNextYear(player);
          }

          return true;
        });

        return {
          ...group,
          capCommitted: filteredPlayers.reduce(
            (total, player) => total + (player.contractStatus === "prospect" ? 0 : player.capHit),
            0,
          ),
          players: filteredPlayers,
        };
      })
      .filter((group) => group.players.length > 0);
  }, [contractBreakdownFilter, contractBreakdownGroups]);
  const contractCount = useMemo(
    () => players.filter((player) => player.contractStatus !== "prospect").length,
    [players],
  );
  const hasSaveChanges =
    !areTemporaryPlayerIdsEqual(temporaryPlayerIds, savedLayoutState.temporaryPlayerIds) ||
    !areAssignmentsEqual(assignments, savedLayoutState.assignments);
  const hasResetChanges = temporaryPlayerIds.length > 0 || !areAssignmentsEqual(assignments, defaultAssignments);

  const rebuildAssignments = (nextTemporaryIds: string[]) => {
    setAssignments(buildAssignmentsForTemporaryIds(nextTemporaryIds).nextAssignments);
    setDraggedSlotId(null);
    setSelectedSlotId(null);
  };

  const availableGuestPlayers = useMemo(
    () =>
      availablePlayers.filter(
        (player) => player.team !== teamName && !temporaryPlayerIds.includes(player.id),
      ),
    [availablePlayers, teamName, temporaryPlayerIds],
  );

  const guestSuggestions = useMemo(() => {
    const normalizedQuery = guestQuery.trim().toLowerCase();

    if (normalizedQuery.length === 0) {
      return [];
    }

    return availableGuestPlayers
      .filter((player) => {
        return (
          player.name.toLowerCase().includes(normalizedQuery) ||
          player.team.toLowerCase().includes(normalizedQuery) ||
          player.position.toLowerCase().includes(normalizedQuery)
        );
      })
      .slice(0, 8);
  }, [availableGuestPlayers, guestQuery]);

  const handleAddTemporaryPlayer = (playerId: string) => {
    if (temporaryPlayerIds.includes(playerId)) {
      return;
    }

    const nextTemporaryIds = [...temporaryPlayerIds, playerId];
    setTemporaryPlayerIds(nextTemporaryIds);
    rebuildAssignments(nextTemporaryIds);
    setGuestQuery("");
  };

  const handleRemoveTemporaryPlayer = (playerId: string) => {
    const nextTemporaryIds = temporaryPlayerIds.filter((temporaryPlayerId) => temporaryPlayerId !== playerId);
    setTemporaryPlayerIds(nextTemporaryIds);
    rebuildAssignments(nextTemporaryIds);
  };

  const selectedPlayerName =
    selectedSlotId && assignments[selectedSlotId] ? playersById.get(assignments[selectedSlotId] ?? "")?.name ?? null : null;

  const findAssignedSlotId = (playerId: string) =>
    Object.entries(assignments).find(([, assignedPlayerId]) => assignedPlayerId === playerId)?.[0] ?? null;

  const movePlayer = (sourceSlotId: string, targetSlotId: string) => {
    if (sourceSlotId === targetSlotId) {
      setSelectedSlotId(null);
      return;
    }

    setAssignments((currentAssignments) => ({
      ...currentAssignments,
      [sourceSlotId]: currentAssignments[targetSlotId] ?? null,
      [targetSlotId]: currentAssignments[sourceSlotId] ?? null,
    }));
    setDraggedSlotId(null);
    setSelectedSlotId(null);
  };

  const placeTemporaryPlayer = (playerId: string, targetSlotId: string) => {
    setAssignments((currentAssignments) => {
      const sourceSlotId = Object.entries(currentAssignments).find(([, assignedPlayerId]) => assignedPlayerId === playerId)?.[0] ?? null;
      const targetPlayerId = currentAssignments[targetSlotId] ?? null;

      if (sourceSlotId === targetSlotId) {
        return currentAssignments;
      }

      const nextAssignments = {
        ...currentAssignments,
        [targetSlotId]: playerId,
      };

      if (sourceSlotId) {
        nextAssignments[sourceSlotId] = targetPlayerId;
      }

      return nextAssignments;
    });

    setDraggedSlotId(null);
    setSelectedSlotId(null);
  };

  const handleSlotClick = (slotId: string) => {
    if (!selectedSlotId) {
      if (assignments[slotId]) {
        setSelectedSlotId(slotId);
      }

      return;
    }

    if (selectedSlotId === slotId) {
      setSelectedSlotId(null);
      return;
    }

    movePlayer(selectedSlotId, slotId);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, slotId: string) => {
    if (!assignments[slotId]) {
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", slotId);
    setDraggedSlotId(slotId);
    setSelectedSlotId(null);
  };

  const handleTemporaryPlayerDragStart = (event: DragEvent<HTMLDivElement>, playerId: string) => {
    const assignedSlotId = findAssignedSlotId(playerId);

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `temp-player:${playerId}`);
    setDraggedSlotId(assignedSlotId);
    setSelectedSlotId(null);
  };

  const handleGuestSuggestionDragStart = (event: DragEvent<HTMLDivElement>, playerId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `external-player:${playerId}`);
    setDraggedSlotId(null);
    setSelectedSlotId(null);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>, targetSlotId: string) => {
    event.preventDefault();

    const dragPayload = event.dataTransfer.getData("text/plain");

    if (dragPayload.startsWith("external-player:")) {
      const playerId = dragPayload.slice("external-player:".length);
      const nextTemporaryIds = temporaryPlayerIds.includes(playerId)
        ? temporaryPlayerIds
        : [...temporaryPlayerIds, playerId];
      const { nextAssignments, nextLayout } = buildAssignmentsForTemporaryIds(nextTemporaryIds, assignments);
      const sourceSlotId =
        Object.entries(nextLayout.initialAssignments).find(([, assignedPlayerId]) => assignedPlayerId === playerId)?.[0] ?? null;

      setTemporaryPlayerIds(nextTemporaryIds);

      if (!sourceSlotId) {
        setAssignments(nextAssignments);
        setDraggedSlotId(null);
        setSelectedSlotId(null);
        return;
      }

      const targetPlayerId = nextAssignments[targetSlotId] ?? null;
      setAssignments({
        ...nextAssignments,
        [sourceSlotId]: targetPlayerId,
        [targetSlotId]: playerId,
      });
      setDraggedSlotId(null);
      setSelectedSlotId(null);
      return;
    }

    if (dragPayload.startsWith("temp-player:")) {
      placeTemporaryPlayer(dragPayload.slice("temp-player:".length), targetSlotId);
      return;
    }

    const sourceSlotId = draggedSlotId ?? dragPayload;

    if (!sourceSlotId) {
      return;
    }

    movePlayer(sourceSlotId, targetSlotId);
  };

  const handleSaveLayout = () => {
    const nextSavedLayout = {
      assignments,
      temporaryPlayerIds,
    };

    saveRosterLinesLayout(teamName, nextSavedLayout);
    setSavedLayoutState(nextSavedLayout);
  };

  const toggleContractBreakdownSort = (family: FamilyKey, key: ContractBreakdownSortKey) => {
    setContractBreakdownSortStateByFamily((currentState) => {
      const activeState = currentState[family];
      const initialDirection = getContractBreakdownInitialDirection(key);

      if (activeState.key === key) {
        if (activeState.direction !== initialDirection) {
          return {
            ...currentState,
            [family]: defaultContractBreakdownSortStateByFamily[family],
          };
        }

        return {
          ...currentState,
          [family]: {
            direction: activeState.direction === "asc" ? "desc" : "asc",
            key,
          },
        };
      }

      return {
        ...currentState,
        [family]: {
          direction: initialDirection,
          key,
        },
      };
    });
  };

  return (
    <div className="mt-6 space-y-6">
      {view === "lines" ? (
        <>
          <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(225,29,72,0.16),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.6),transparent_50%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent-strong)]">Live lineup board</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">{teamName} by lines and depth slots</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Drag a player onto another card to swap them, or tap one card and then a second slot on touch devices.
            </p>
            <p className="mt-2 text-sm text-slate-500">You can also borrow a player from another team here temporarily without changing your actual roster.</p>
            <div className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500">
              <span className={`h-2.5 w-2.5 rounded-full ${selectedPlayerName ? "bg-[var(--accent)]" : "bg-slate-300"}`} aria-hidden="true" />
              <span>{selectedPlayerName ? `Selected: ${selectedPlayerName}` : "Tap a player to stage a move"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 ${
                hasResetChanges
                  ? "border border-[var(--accent)] bg-[rgba(37,99,235,0.12)] text-[var(--accent)] shadow-[0_10px_24px_rgba(37,99,235,0.14)] transition hover:bg-[rgba(37,99,235,0.18)] focus-visible:ring-[rgba(37,99,235,0.24)]"
                  : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400 shadow-none focus-visible:ring-slate-200"
              }`}
              disabled={!hasResetChanges}
              onClick={() => {
                setTemporaryPlayerIds([]);
                setAssignments(defaultAssignments);
                setDraggedSlotId(null);
                setSelectedSlotId(null);
                setGuestQuery("");
              }}
              type="button"
            >
              Reset layout
            </button>
            <button
              className={`rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 ${
                hasSaveChanges
                  ? "border border-emerald-300 bg-emerald-50 text-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.12)] transition hover:bg-emerald-100 focus-visible:ring-[rgba(16,185,129,0.24)]"
                  : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400 shadow-none focus-visible:ring-slate-200"
              }`}
              disabled={!hasSaveChanges}
              onClick={handleSaveLayout}
              type="button"
            >
              Save layout
            </button>
          </div>
        </div>

        <div className="relative border-t border-[var(--line)] px-5 pb-5 pt-5 sm:px-6">
          <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4 backdrop-blur">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <label className="min-w-[16rem] flex-1 text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Find external player</span>
                <input
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                  onChange={(event) => setGuestQuery(event.target.value)}
                  placeholder="Name, team, or position"
                  type="search"
                  value={guestQuery}
                />
              </label>
            </div>

            {temporaryPlayers.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {temporaryPlayers.map((player) => (
                  <div
                    key={`guest-${player.id}`}
                    className={`inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-2 text-sm text-slate-700 shadow-[0_8px_18px_rgba(17,32,49,0.06)] ${findAssignedSlotId(player.id) ? "cursor-grab active:cursor-grabbing" : ""}`}
                    draggable={Boolean(findAssignedSlotId(player.id))}
                    onDragEnd={() => setDraggedSlotId(null)}
                    onDragStart={(event) => handleTemporaryPlayerDragStart(event, player.id)}
                  >
                    <span className="font-semibold text-slate-900">{compactPlayerName(player.name)}</span>
                    <span className="text-slate-500">{player.team}</span>
                    <button
                      className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                      onClick={() => handleRemoveTemporaryPlayer(player.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {guestSuggestions.map((player) => (
                <div
                  key={player.id}
                  className="cursor-grab rounded-[1.25rem] border border-[var(--line)] bg-white p-3 text-left shadow-[0_10px_24px_rgba(17,32,49,0.06)] transition hover:border-slate-300 hover:shadow-[0_14px_28px_rgba(17,32,49,0.08)] active:cursor-grabbing"
                  draggable
                  onDragEnd={() => setDraggedSlotId(null)}
                  onDragStart={(event) => handleGuestSuggestionDragStart(event, player.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{player.name}</p>
                      <p className="mt-1 truncate text-sm text-slate-600">{player.team}</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="rounded-full bg-[rgba(37,99,235,0.1)] px-2.5 py-1 text-sm font-semibold text-[var(--accent)]">
                        {player.score}
                      </span>
                      <button
                        className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                        onClick={() => handleAddTemporaryPlayer(player.id)}
                        type="button"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span>{player.position}</span>
                    <span>{formatMillions(player.capHit)}</span>
                  </div>
                </div>
              ))}
            </div>

            {guestQuery.trim().length > 0 && guestSuggestions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No external players match the current search.</p>
            ) : null}
          </div>
        </div>
          </section>

          <div className="grid gap-6 2xl:grid-cols-2">
        {(["nhl", "farm"] as const).map((level) => {
          const chart = layout.charts[level];

          return (
            <section
              key={level}
              className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_60px_rgba(17,32,49,0.08)]"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.1),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.35),transparent_44%)]" />
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{level === "nhl" ? "Top club" : "Minor club"}</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">{levelCopy[level].title}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{levelCopy[level].description}</p>
                </div>
                <p className="rounded-full border border-[var(--line)] bg-white/90 px-4 py-2 text-sm text-slate-700 shadow-[0_10px_24px_rgba(17,32,49,0.08)]">
                  {levelSummary(chart, assignments)}
                </p>
              </div>

              <div className="relative mt-5 space-y-5">
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Offensive lines</h4>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">LW · C · RW</p>
                  </div>
                  <div className="space-y-3">
                    {chart.forwardLines.map((line, index) => (
                      <div key={`${level}-forward-line-${index + 1}`} className="grid gap-3 xl:grid-cols-3">
                        {line.map((slot) => (
                          <DepthChartSlot
                            key={slot.id}
                            draggedSlotId={draggedSlotId}
                            isMovedPlayer={Boolean(
                              assignments[slot.id] && initialSlotByPlayerId.get(assignments[slot.id] ?? "") !== slot.id,
                            )}
                            onClick={() => handleSlotClick(slot.id)}
                            onDragEnd={() => setDraggedSlotId(null)}
                            onDragOver={handleDragOver}
                            onDragStart={handleDragStart}
                            onDrop={(event) => handleDrop(event, slot.id)}
                            player={assignments[slot.id] ? playersById.get(assignments[slot.id] ?? "") ?? null : null}
                            selectedSlotId={selectedSlotId}
                            slot={slot}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </section>

                <div className="space-y-5">
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Defensive pairs</h4>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">LD · RD</p>
                    </div>
                    <div className="space-y-3">
                      {chart.defensePairs.map((pair, index) => (
                        <div key={`${level}-pair-${index + 1}`} className="grid gap-3 md:grid-cols-2">
                          {pair.map((slot) => (
                            <DepthChartSlot
                              key={slot.id}
                              draggedSlotId={draggedSlotId}
                              isMovedPlayer={Boolean(
                                assignments[slot.id] && initialSlotByPlayerId.get(assignments[slot.id] ?? "") !== slot.id,
                              )}
                              onClick={() => handleSlotClick(slot.id)}
                              onDragEnd={() => setDraggedSlotId(null)}
                              onDragOver={handleDragOver}
                              onDragStart={handleDragStart}
                              onDrop={(event) => handleDrop(event, slot.id)}
                              player={assignments[slot.id] ? playersById.get(assignments[slot.id] ?? "") ?? null : null}
                              selectedSlotId={selectedSlotId}
                              slot={slot}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Goalies</h4>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Starter · Backup</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {chart.goalieSlots.map((slot) => (
                        <DepthChartSlot
                          key={slot.id}
                          draggedSlotId={draggedSlotId}
                          isMovedPlayer={Boolean(
                            assignments[slot.id] && initialSlotByPlayerId.get(assignments[slot.id] ?? "") !== slot.id,
                          )}
                          onClick={() => handleSlotClick(slot.id)}
                          onDragEnd={() => setDraggedSlotId(null)}
                          onDragOver={handleDragOver}
                          onDragStart={handleDragStart}
                          onDrop={(event) => handleDrop(event, slot.id)}
                          player={assignments[slot.id] ? playersById.get(assignments[slot.id] ?? "") ?? null : null}
                          selectedSlotId={selectedSlotId}
                          slot={slot}
                        />
                      ))}
                    </div>
                  </section>
                </div>

                {chart.extraGroups.length > 0 ? (
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">Extras and reserves</h4>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Overflow players stay movable</p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      {chart.extraGroups.map((group) => (
                        <div key={`${level}-extras-${group.family}`} className="rounded-[1.25rem] border border-[var(--line)] bg-white/70 p-3 shadow-[0_12px_24px_rgba(17,32,49,0.06)]">
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{extraFamilyLabels[group.family]}</p>
                          <div className="mt-3 space-y-3">
                            {group.slots.map((slot) => (
                              <DepthChartSlot
                                key={slot.id}
                                draggedSlotId={draggedSlotId}
                                isMovedPlayer={Boolean(
                                  assignments[slot.id] && initialSlotByPlayerId.get(assignments[slot.id] ?? "") !== slot.id,
                                )}
                                onClick={() => handleSlotClick(slot.id)}
                                onDragEnd={() => setDraggedSlotId(null)}
                                onDragOver={handleDragOver}
                                onDragStart={handleDragStart}
                                onDrop={(event) => handleDrop(event, slot.id)}
                                player={assignments[slot.id] ? playersById.get(assignments[slot.id] ?? "") ?? null : null}
                                selectedSlotId={selectedSlotId}
                                slot={slot}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </section>
          );
        })}
          </div>
        </>
      ) : null}

      {view === "breakdown" ? (
        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_60px_rgba(17,32,49,0.08)] sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(225,29,72,0.12),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.5),transparent_40%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent-strong)]">Roster breakdown</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Contract status by season</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Active seasons repeat the current cap hit, and the first season after the deal shows the next contract state.
            </p>
          </div>
          <div className="flex flex-wrap items-stretch justify-end gap-2">
            <div className="flex min-h-[3.75rem] min-w-[11.5rem] flex-col justify-center rounded-full border border-[var(--line)] bg-white/88 px-4 py-2 text-center shadow-[0_10px_20px_rgba(17,32,49,0.06)]">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Contract count</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">{contractCount} contracts</p>
              <p className="text-[11px] text-slate-500">range {minimumRosterContracts}-{maximumRosterContracts}</p>
            </div>
            <button
              className={`inline-flex min-h-[3.75rem] min-w-[11.5rem] items-center justify-center rounded-full px-4 py-2 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 ${
                contractBreakdownFilter === "unsigned-next-year"
                  ? "border border-amber-300 bg-amber-50 text-amber-700 shadow-[0_10px_24px_rgba(217,119,6,0.12)] focus-visible:ring-[rgba(217,119,6,0.18)]"
                  : "border border-[var(--line)] bg-white/90 text-slate-700 shadow-[0_10px_24px_rgba(17,32,49,0.08)] hover:border-amber-200 hover:bg-amber-50/50"
              }`}
              onClick={() =>
                setContractBreakdownFilter((currentFilter) =>
                  currentFilter === "unsigned-next-year" ? "all" : "unsigned-next-year",
                )
              }
              type="button"
            >
              Not signed next year
            </button>
            <button
              className={`inline-flex min-h-[3.75rem] min-w-[11.5rem] items-center justify-center rounded-full px-4 py-2 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 ${
                contractBreakdownFilter === "signed-next-year"
                  ? "border border-emerald-300 bg-emerald-50 text-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.12)] focus-visible:ring-[rgba(16,185,129,0.18)]"
                  : "border border-[var(--line)] bg-white/90 text-slate-700 shadow-[0_10px_24px_rgba(17,32,49,0.08)] hover:border-emerald-200 hover:bg-emerald-50/50"
              }`}
              onClick={() =>
                setContractBreakdownFilter((currentFilter) =>
                  currentFilter === "signed-next-year" ? "all" : "signed-next-year",
                )
              }
              type="button"
            >
              Signed next year
            </button>
          </div>
        </div>

        <div className="relative mt-6 space-y-5">
          {filteredContractBreakdownGroups.length === 0 ? (
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 px-5 py-6 text-sm text-slate-600 shadow-[0_14px_30px_rgba(17,32,49,0.06)]">
              No players match the current contract filter.
            </div>
          ) : null}
          {filteredContractBreakdownGroups.map((group) => {
            const sortState = contractBreakdownSortStateByFamily[group.family];
            const sortedPlayers = sortContractBreakdownPlayers(group.players, sortState);

            return (
            <details
              key={`contract-breakdown-${group.family}`}
              className="group overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-white/78 shadow-[0_18px_40px_rgba(17,32,49,0.08)]"
              open
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(239,242,255,0.92))] px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
                <div className="flex items-start gap-3">
                  <span className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/70 bg-[linear-gradient(145deg,rgba(37,99,235,0.16),rgba(225,29,72,0.14))] text-slate-700 shadow-[0_10px_24px_rgba(37,99,235,0.12),inset_0_1px_0_rgba(255,255,255,0.65)]">
                    <span className="grid h-6 w-6 place-items-center rounded-xl bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                      <svg
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-[var(--accent)] transition-transform duration-300 ease-out group-open:rotate-180"
                        fill="none"
                        viewBox="0 0 16 16"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M3.25 5.75 8 10.25l4.75-4.5"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.2"
                        />
                      </svg>
                    </span>
                  </span>
                  <div>
                    <h4 className="text-lg font-semibold text-slate-900">{group.players.length} {contractBreakdownGroupCopy[group.family].title}</h4>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-[0.16em] text-slate-500 group-open:hidden">Expand</span>
                  <span className="hidden text-xs uppercase tracking-[0.16em] text-slate-500 group-open:inline">Collapse</span>
                  <p className="rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-sm text-slate-700 shadow-[0_8px_20px_rgba(17,32,49,0.06)]">
                    Cap committed {formatMillions(group.capCommitted)}
                  </p>
                </div>
              </summary>

              <div className="overflow-x-auto border-t border-[var(--line)]">
                <table className="min-w-full border-collapse text-left">
                  <thead className="bg-[linear-gradient(90deg,rgba(37,99,235,0.96),rgba(225,29,72,0.9))] text-sm uppercase tracking-[0.18em] text-white">
                    <tr>
                      <th className="px-4 py-3 font-medium">
                        <button className="flex items-center gap-2" onClick={() => toggleContractBreakdownSort(group.family, "name")} type="button">
                          <span>Player</span>
                          <span className="text-[10px] text-white/70">{renderSortLabel(sortState.key === "name", sortState.direction)}</span>
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button className="flex items-center gap-2" onClick={() => toggleContractBreakdownSort(group.family, "position")} type="button">
                          <span>Pos</span>
                          <span className="text-[10px] text-white/70">{renderSortLabel(sortState.key === "position", sortState.direction)}</span>
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button className="flex items-center gap-2" onClick={() => toggleContractBreakdownSort(group.family, "age")} type="button">
                          <span>Age</span>
                          <span className="text-[10px] text-white/70">{renderSortLabel(sortState.key === "age", sortState.direction)}</span>
                        </button>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <button className="flex items-center gap-2" onClick={() => toggleContractBreakdownSort(group.family, "season:-1")} type="button">
                          <span>{formatSimulationSeason(contractBreakdownCurrentSeasonStartYear)}</span>
                          <span className="text-[10px] text-white/70">
                            {renderSortLabel(sortState.key === "season:-1", sortState.direction)}
                          </span>
                        </button>
                      </th>
                      {contractBreakdownSeasons.map((season, seasonIndex) => (
                        <th key={`${group.family}-season-${season}`} className="px-4 py-3 font-medium">
                          <button className="flex items-center gap-2" onClick={() => toggleContractBreakdownSort(group.family, `season:${seasonIndex}`)} type="button">
                            <span>{formatSimulationSeason(season)}</span>
                            <span className="text-[10px] text-white/70">
                              {renderSortLabel(sortState.key === `season:${seasonIndex}`, sortState.direction)}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlayers.map((player, index) => (
                      <tr
                        key={`${group.family}-${player.id}`}
                        className={`${index % 2 === 0 ? "bg-white/88" : "bg-[rgba(239,242,255,0.82)]"} border-t border-[var(--line)] transition hover:bg-[rgba(219,234,254,0.66)]`}
                      >
                        <td className="px-4 py-4 align-top">
                          <div>
                            <PlayerLink className="font-semibold text-slate-900 underline-offset-4 hover:text-[var(--accent)] hover:underline" playerId={player.id}>
                              {player.name}
                            </PlayerLink>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span className="uppercase tracking-[0.18em]">{player.role}</span>
                              {player.inMinors ? (
                                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-semibold uppercase tracking-[0.14em] text-slate-600">
                                  Farm
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-sm font-semibold text-slate-700">{player.position}</td>
                        <td className="px-4 py-4 align-top text-sm text-slate-700">{player.age}</td>
                        {(() => {
                          const cell = getContractBreakdownCell(player, -1);

                          return (
                            <td className="px-4 py-4 align-top text-sm text-slate-700">
                              {cell ? (
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${cell.className}`}
                                  title={cell.title}
                                >
                                  {cell.label}
                                </span>
                              ) : (
                                <span className="text-slate-300">--</span>
                              )}
                            </td>
                          );
                        })()}
                        {contractBreakdownSeasons.map((season, seasonIndex) => {
                          const cell = getContractBreakdownCell(player, seasonIndex);

                          return (
                            <td key={`${player.id}-season-${season}`} className="px-4 py-4 align-top text-sm text-slate-700">
                              {cell ? (
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${cell.className}`}
                                  title={cell.title}
                                >
                                  {cell.label}
                                </span>
                              ) : (
                                <span className="text-slate-300">--</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            );
          })}
        </div>
        </section>
      ) : null}
    </div>
  );
}

type DepthChartSlotProps = {
  draggedSlotId: string | null;
  isMovedPlayer: boolean;
  onClick: () => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, slotId: string) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  player: LineupPlayer | null;
  selectedSlotId: string | null;
  slot: SlotDefinition;
};

function DepthChartSlot({
  draggedSlotId,
  isMovedPlayer,
  onClick,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  player,
  selectedSlotId,
  slot,
}: DepthChartSlotProps) {
  const isSelected = selectedSlotId === slot.id;
  const isDragged = draggedSlotId === slot.id;
  const isOffPosition = Boolean(player && !slot.isExtra && player.position !== slot.position);
  const isTemporaryGuest = Boolean(player?.isTemporaryGuest);
  const contractPaletteStyle = player ? contractPalette(player) : null;
  const contractFilledYears = player ? contractYearsFilled(player) : 0;

  return (
    <button
      className={`flex min-h-[9.5rem] w-full flex-col rounded-[1.25rem] border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(37,99,235,0.22)] ${
        player
          ? isTemporaryGuest
            ? "bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(225,29,72,0.08))] shadow-[0_12px_24px_rgba(37,99,235,0.1)]"
            : isMovedPlayer
              ? "bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(45,212,191,0.1))] shadow-[0_12px_24px_rgba(16,185,129,0.1)]"
            : "bg-white/82 shadow-[0_12px_24px_rgba(17,32,49,0.06)]"
          : "bg-white/55"
      } ${
        isSelected
          ? "border-[var(--accent)] shadow-[0_0_0_1px_rgba(37,99,235,0.24),0_12px_24px_rgba(37,99,235,0.08)]"
          : isDragged
            ? "border-slate-300 opacity-65"
            : isTemporaryGuest
              ? "border-[rgba(37,99,235,0.28)] hover:border-[rgba(37,99,235,0.4)] hover:shadow-[0_12px_24px_rgba(37,99,235,0.12)]"
              : isMovedPlayer
                ? "border-[rgba(16,185,129,0.32)] hover:border-[rgba(16,185,129,0.44)] hover:shadow-[0_12px_24px_rgba(16,185,129,0.12)]"
              : "border-[var(--line)] hover:border-slate-300 hover:shadow-[0_12px_24px_rgba(17,32,49,0.08)]"
      }`}
      draggable={Boolean(player)}
      onClick={onClick}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={(event) => onDragStart(event, slot.id)}
      onDrop={onDrop}
      type="button"
    >
      {player ? (
        <div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <PlayerLink className="truncate text-lg font-semibold text-slate-900 underline-offset-4 hover:text-[var(--accent)] hover:underline" playerId={player.id}>
                {compactPlayerName(player.name)}
              </PlayerLink>
              <span className="shrink-0 text-sm font-semibold text-slate-500">({player.score} {player.position})</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              {isOffPosition ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 uppercase tracking-[0.14em] text-amber-700">
                  playing {slot.position}
                </span>
              ) : null}
              <span className="rounded-full border border-[var(--line)] bg-slate-50 px-2.5 py-1">Age {player.age}</span>
              <span
                aria-label={contractLabel(player)}
                className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 ${contractPaletteStyle?.badge ?? ""}`}
                title={contractLabel(player)}
              >
                <span className="flex items-center gap-1" aria-hidden="true">
                  {Array.from({ length: maxDisplayedContractYears }, (_, index) => (
                    <span
                      key={`${player.id}-contract-year-${index + 1}`}
                      className={`h-1.5 w-3 rounded-full ${index < contractFilledYears ? contractPaletteStyle?.filled : contractPaletteStyle?.empty}`}
                    />
                  ))}
                </span>
              </span>
            </div>
            <div className="mt-3 text-sm text-slate-600">{formatMillions(player.capHit)}</div>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
          Drop a player here or tap this slot after selecting one.
        </div>
      )}
    </button>
  );
}