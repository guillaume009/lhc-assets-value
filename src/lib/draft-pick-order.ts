import type { DashboardInput, DraftOrder, DraftPick } from "@/lib/domain";

export type DraftPickOrderUpdate = DraftOrder;

export type DraftPickOrderGroup = {
  team: string;
  issuerTeam: string;
  season: number;
  projectedSlot: number;
  picks: DraftPick[];
  rounds: number[];
  pickCount: number;
};

const DEFAULT_PROJECTED_SLOT = 16;

const normalizeProjectedSlot = (projectedSlot: number) => Math.max(1, Math.round(projectedSlot));

const normalizeTeamLabel = (team: string) => team.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const dedupeTeams = (teams: string[]) =>
  [...new Set(teams.filter((team) => team && team !== "Free Agent"))].sort((left, right) => left.localeCompare(right));

export const isSameDraftPickTeam = (leftTeam: string, rightTeam: string) => {
  const left = normalizeTeamLabel(leftTeam);
  const right = normalizeTeamLabel(rightTeam);

  if (left === right) {
    return true;
  }

  const shortestLength = Math.min(left.length, right.length);

  if (shortestLength < 5) {
    return false;
  }

  return left.endsWith(right) || right.endsWith(left);
};

export const getDraftPickIssuerTeam = (pick: DraftPick) => pick.issuerTeam?.trim() || pick.team;

export const hasTradedDraftPick = (pick: DraftPick) => !isSameDraftPickTeam(getDraftPickIssuerTeam(pick), pick.team);

export const formatDraftPickTeamLabel = (pick: DraftPick) =>
  hasTradedDraftPick(pick) ? `${pick.team} (${getDraftPickIssuerTeam(pick)})` : pick.team;

const resolveDraftPickTeamName = (team: string, knownTeams: string[]) => {
  const exactMatch = knownTeams.find((knownTeam) => knownTeam === team);

  if (exactMatch) {
    return exactMatch;
  }

  return knownTeams.find((knownTeam) => isSameDraftPickTeam(knownTeam, team)) ?? team;
};

const normalizeDraftPicksForOrders = (draftPicks: DraftPick[], knownTeams: string[]) =>
  draftPicks.map((pick) => ({
    ...pick,
    issuerTeam: resolveDraftPickTeamName(getDraftPickIssuerTeam(pick), knownTeams),
  }));

export const getDraftPickOrderKey = (team: string, season: number) => `${season}::${team}`;

const collectLeagueTeams = ({
  teamName,
  roster,
  leagueTargets,
  draftPicks,
  draftOrders,
}: DashboardInput) =>
  dedupeTeams([
    teamName,
    ...roster.map((player) => player.team),
    ...leagueTargets.map((player) => player.team),
    ...draftPicks.map((pick) => pick.team),
    ...draftPicks.map((pick) => getDraftPickIssuerTeam(pick)),
    ...(draftOrders?.map((draftOrder) => draftOrder.team) ?? []),
  ]);

const collectRelevantYears = ({ draftPicks, draftOrders }: DashboardInput) => {
  const currentYear = new Date().getFullYear();
  const latestYear = Math.max(
    currentYear,
    ...draftPicks.map((pick) => pick.season),
    ...(draftOrders?.map((draftOrder) => draftOrder.season) ?? []),
  );

  return Array.from(
    { length: latestYear - currentYear + 1 },
    (_, index) => currentYear + index,
  );
};

const getLegacyProjectedSlotByKey = (draftPicks: DraftPick[]) => {
  const projectedSlotByKey = new Map<string, number>();

  for (const pick of draftPicks) {
    const key = getDraftPickOrderKey(getDraftPickIssuerTeam(pick), pick.season);
    const projectedSlot = normalizeProjectedSlot(pick.projectedSlot);
    const existingProjectedSlot = projectedSlotByKey.get(key);

    if (existingProjectedSlot === undefined || projectedSlot < existingProjectedSlot) {
      projectedSlotByKey.set(key, projectedSlot);
    }
  }

  return projectedSlotByKey;
};

export const buildNormalizedDraftOrders = (input: DashboardInput): DraftOrder[] => {
  const baseTeams = dedupeTeams([
    input.teamName,
    ...input.roster.map((player) => player.team),
    ...input.leagueTargets.map((player) => player.team),
    ...input.draftPicks.map((pick) => pick.team),
    ...(input.draftOrders?.map((draftOrder) => draftOrder.team) ?? []),
  ]);
  const normalizedDraftPicks = normalizeDraftPicksForOrders(input.draftPicks, baseTeams);
  const teams = collectLeagueTeams({
    ...input,
    draftPicks: normalizedDraftPicks,
  });
  const years = collectRelevantYears(input);
  const currentYear = new Date().getFullYear();
  const legacyProjectedSlotByKey = getLegacyProjectedSlotByKey(normalizedDraftPicks);
  const explicitProjectedSlotByKey = new Map(
    (input.draftOrders ?? []).map((draftOrder) => [
      getDraftPickOrderKey(draftOrder.team, draftOrder.season),
      normalizeProjectedSlot(draftOrder.projectedSlot),
    ]),
  );

  return years
    .flatMap((season) =>
      teams.map((team) => {
        const currentYearKey = getDraftPickOrderKey(team, currentYear);
        const seasonKey = getDraftPickOrderKey(team, season);
        const currentYearProjectedSlot =
          explicitProjectedSlotByKey.get(currentYearKey) ??
          legacyProjectedSlotByKey.get(currentYearKey) ??
          DEFAULT_PROJECTED_SLOT;

        return {
          team,
          season,
          projectedSlot:
            explicitProjectedSlotByKey.get(seasonKey) ??
            legacyProjectedSlotByKey.get(seasonKey) ??
            currentYearProjectedSlot,
        };
      }),
    )
    .sort(
      (left, right) =>
        left.season - right.season ||
        left.projectedSlot - right.projectedSlot ||
        left.team.localeCompare(right.team),
    );
};

export const applyDraftOrdersToPicks = (
  draftPicks: DraftPick[],
  draftOrders: DraftOrder[],
): DraftPick[] => {
  const knownTeams = dedupeTeams(draftOrders.map((draftOrder) => draftOrder.team));
  const projectedSlotByKey = new Map(
    draftOrders.map((draftOrder) => [
      getDraftPickOrderKey(draftOrder.team, draftOrder.season),
      normalizeProjectedSlot(draftOrder.projectedSlot),
    ]),
  );

  return [...draftPicks]
    .map((pick) => {
      const issuerTeam = resolveDraftPickTeamName(getDraftPickIssuerTeam(pick), knownTeams);

      return {
        ...pick,
        issuerTeam,
        projectedSlot: projectedSlotByKey.get(getDraftPickOrderKey(issuerTeam, pick.season)) ??
          normalizeProjectedSlot(pick.projectedSlot),
      };
    })
    .sort(
      (left, right) =>
        left.season - right.season ||
        left.projectedSlot - right.projectedSlot ||
        getDraftPickIssuerTeam(left).localeCompare(getDraftPickIssuerTeam(right)) ||
        left.team.localeCompare(right.team) ||
        left.round - right.round,
    );
};

export const buildDraftPickOrderGroups = (draftPicks: DraftPick[]): DraftPickOrderGroup[] => {
  const groups = new Map<string, DraftPickOrderGroup>();

  for (const pick of draftPicks) {
    const issuerTeam = getDraftPickIssuerTeam(pick);
    const key = getDraftPickOrderKey(issuerTeam, pick.season);
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.picks.push(pick);
      existingGroup.rounds.push(pick.round);
      existingGroup.pickCount += 1;
      continue;
    }

    groups.set(key, {
      team: pick.team,
      issuerTeam,
      season: pick.season,
      projectedSlot: pick.projectedSlot,
      picks: [pick],
      rounds: [pick.round],
      pickCount: 1,
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    picks: [...group.picks].sort((left, right) => left.round - right.round || left.id.localeCompare(right.id)),
    rounds: [...group.rounds].sort((left, right) => left - right),
  }));
};