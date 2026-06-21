import type { ContractStatus, NormalizedDashboardInput, Player, Position } from "@/lib/domain";
import type { DirectoryPlayer } from "@/lib/player-directory";
import type { TradeRecord, TradeSideSummary } from "@/lib/trade-history";
import {
  getTeamDirectoryEntries,
  getTeamPicks,
  getTeamPlayers,
  type TeamDirectoryPick,
} from "@/lib/team-directory";
import { assessTeam, type TeamAssessment, type TradeValueSignals } from "@/lib/valuation";

type WorkbenchTeamSummary = {
  id: string;
  name: string;
  averageScore: number;
  isOwnTeam: boolean;
};

export type WorkbenchAsset = {
  assetId: string;
  kind: "player" | "pick";
  id: string;
  teamName: string;
  label: string;
  subtitle: string;
  score: number;
  issuerTeam?: string;
  player?: Player;
};

export type WorkbenchTeam = {
  team: WorkbenchTeamSummary;
  assets: WorkbenchAsset[];
};

export type TradePackageSummary = {
  assetCount: number;
  playerCount: number;
  pickCount: number;
  totalScore: number;
};

export type TradeWorkbenchImpact = {
  before: TeamAssessment;
  after: TeamAssessment;
  rosterDelta: number;
  pickValueBefore: number;
  pickValueAfter: number;
  pickValueDelta: number;
  playerCountBefore: number;
  playerCountAfter: number;
  pickCountBefore: number;
  pickCountAfter: number;
};

type PackageFingerprint = TradePackageSummary & {
  headlinerKind: "player" | "pick" | "none";
  headlinerPosition: string | null;
  headlinerTier: "elite" | "core" | "chip" | "depth" | null;
  headlinerRoleFamily: string | null;
  headlinerAgeBand: string | null;
  headlinerContractStatus: ContractStatus | null;
};

type PackageComparison = {
  distance: number;
  scoreGap: number;
  playerCountGap: number;
  pickCountGap: number;
  assetCountGap: number;
  headlinerAligned: boolean;
  roleAligned: boolean;
  ageBandAligned: boolean;
  contractAligned: boolean;
};

export type ComparableTradeMatch = {
  trade: TradeRecord;
  similarityScore: number;
  explanation: string;
  leftMatchedSide: TradeSideSummary;
  rightMatchedSide: TradeSideSummary;
  leftComparison: PackageComparison;
  rightComparison: PackageComparison;
};

export type ComparableMarketRead = {
  leftMedianScore: number;
  rightMedianScore: number;
  leftDeltaFromMedian: number;
  rightDeltaFromMedian: number;
  overallLabel: "balanced" | "team-a-rich" | "team-b-rich";
  summary: string;
};

const toWorkbenchTeamSummary = (team: ReturnType<typeof getTeamDirectoryEntries>[number]): WorkbenchTeamSummary => ({
  id: team.id,
  name: team.name,
  averageScore: team.averageScore,
  isOwnTeam: team.isOwnTeam,
});

const toWorkbenchPlayer = (player: DirectoryPlayer): Player => ({
  id: player.id,
  name: player.name,
  team: player.team,
  position: player.position,
  role: player.role,
  age: player.age,
  capHit: player.capHit,
  yearsRemaining: player.yearsRemaining,
  contractStatus: player.contractStatus,
  performance: player.performance,
  playDriving: player.playDriving,
  defense: player.defense,
  specialTeams: player.specialTeams,
  chemistryFit: player.chemistryFit,
  upside: player.upside,
  simulationStats: player.simulationStats,
});

const buildPlayerAsset = (player: DirectoryPlayer): WorkbenchAsset => ({
  assetId: `player:${player.id}`,
  kind: "player",
  id: player.id,
  teamName: player.team,
  label: player.name,
  subtitle: `${player.position} / ${player.market} / $${player.capHit.toFixed(1)}M`,
  score: player.score,
  player: toWorkbenchPlayer(player),
});

const buildPickAsset = (pick: TeamDirectoryPick, picksPerRound: number): WorkbenchAsset => {
  const overallRank = (pick.round - 1) * picksPerRound + pick.projectedSlot;

  return {
    assetId: `pick:${pick.id}`,
    kind: "pick",
    id: pick.id,
    teamName: pick.team,
    label: `${pick.season} Round ${pick.round}`,
    subtitle: `Projected rank ${overallRank} (slot ${pick.projectedSlot})`,
    score: pick.score,
    issuerTeam: pick.issuerTeam,
  };
};

export const buildWorkbenchTeams = (
  input: NormalizedDashboardInput,
  players: DirectoryPlayer[],
  tradeValueSignals?: TradeValueSignals,
): WorkbenchTeam[] => {
  const teams = getTeamDirectoryEntries(input, players, tradeValueSignals);
  const picksPerRoundBySeason = new Map<number, number>();

  for (const order of input.draftOrders) {
    picksPerRoundBySeason.set(order.season, (picksPerRoundBySeason.get(order.season) ?? 0) + 1);
  }

  return teams.map((team) => {
    const teamPlayers = getTeamPlayers(players, team.name);
    const teamPicks = getTeamPicks(input, team.name, tradeValueSignals);

    return {
      team: toWorkbenchTeamSummary(team),
      assets: [
        ...teamPlayers.map(buildPlayerAsset),
        ...teamPicks.map((pick) => buildPickAsset(pick, picksPerRoundBySeason.get(pick.season) ?? 1)),
      ].sort(
        (left, right) => right.score - left.score || left.label.localeCompare(right.label),
      ),
    };
  });
};

const getWorkbenchPlayers = (assets: WorkbenchAsset[]) =>
  assets.flatMap((asset) => (asset.kind === "player" && asset.player ? [asset.player] : []));

const getWorkbenchPicks = (assets: WorkbenchAsset[]) =>
  assets.filter((asset) => asset.kind === "pick");

export const summarizeTradePackage = (assets: WorkbenchAsset[]): TradePackageSummary => ({
  assetCount: assets.length,
  playerCount: assets.filter((asset) => asset.kind === "player").length,
  pickCount: assets.filter((asset) => asset.kind === "pick").length,
  totalScore: Math.round(assets.reduce((total, asset) => total + asset.score, 0)),
});

const getScoreTier = (score: number): PackageFingerprint["headlinerTier"] => {
  if (score >= 85) {
    return "elite";
  }

  if (score >= 76) {
    return "core";
  }

  if (score >= 66) {
    return "chip";
  }

  return "depth";
};

const getAgeBand = (age: number) => {
  if (age <= 21) {
    return "prospect";
  }

  if (age <= 25) {
    return "young";
  }

  if (age <= 29) {
    return "prime";
  }

  return "veteran";
};

const getRoleFamily = (position: Position | null, role: string | undefined) => {
  if (position === "G") {
    return "goalie";
  }

  if (position === "LD" || position === "RD") {
    return "defense";
  }

  if (position === "C" || position === "LW" || position === "RW") {
    return "forward";
  }

  if (role?.toLowerCase().includes("goalie")) {
    return "goalie";
  }

  if (role?.toLowerCase().includes("defense")) {
    return "defense";
  }

  if (role?.toLowerCase().includes("forward")) {
    return "forward";
  }

  return null;
};

const parseHistoricalPlayerPosition = (description: string | undefined) => {
  const position = description?.split("/")[0]?.trim();
  return position && position.length > 0 ? position : null;
};

const getPackageFingerprint = (assets: WorkbenchAsset[]): PackageFingerprint => {
  const summary = summarizeTradePackage(assets);
  const sortedAssets = [...assets].sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
  const headliner = sortedAssets[0];

  if (!headliner) {
    return {
      ...summary,
      headlinerKind: "none",
      headlinerPosition: null,
      headlinerTier: null,
      headlinerRoleFamily: null,
      headlinerAgeBand: null,
      headlinerContractStatus: null,
    };
  }

  return {
    ...summary,
    headlinerKind: headliner.kind,
    headlinerPosition: headliner.kind === "player" && headliner.player ? headliner.player.position : null,
    headlinerTier: getScoreTier(headliner.score),
    headlinerRoleFamily:
      headliner.kind === "player" && headliner.player
        ? getRoleFamily(headliner.player.position, headliner.player.role)
        : null,
    headlinerAgeBand:
      headliner.kind === "player" && headliner.player
        ? getAgeBand(headliner.player.age)
        : null,
    headlinerContractStatus:
      headliner.kind === "player" && headliner.player
        ? headliner.player.contractStatus
        : null,
  };
};

const getHistoricalSideFingerprint = (side: TradeSideSummary): PackageFingerprint => {
  const playerAssets = side.assets.filter((asset) => asset.type === "player");
  const pickAssets = side.assets.filter((asset) => asset.type === "draft_pick");
  const scoredAssets = side.assets.filter((asset) => asset.score !== null);
  const headliner = [...scoredAssets].sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.label.localeCompare(right.label))[0];

  return {
    assetCount: side.assets.length,
    playerCount: playerAssets.length,
    pickCount: pickAssets.length,
    totalScore: side.assetScoreTotal,
    headlinerKind:
      headliner?.type === "player" ? "player" : headliner?.type === "draft_pick" ? "pick" : "none",
    headlinerPosition: headliner?.type === "player" ? parseHistoricalPlayerPosition(headliner.description) : null,
    headlinerTier: headliner?.score === null || headliner?.score === undefined ? null : getScoreTier(headliner.score),
    headlinerRoleFamily:
      headliner?.type === "player"
        ? getRoleFamily(headliner.position ?? null, headliner.role)
        : null,
    headlinerAgeBand:
      headliner?.type === "player" && headliner.age !== undefined
        ? getAgeBand(headliner.age)
        : null,
    headlinerContractStatus:
      headliner?.type === "player"
        ? headliner.contractStatus ?? null
        : null,
  };
};

const comparePackageFingerprints = (proposal: PackageFingerprint, historical: PackageFingerprint): PackageComparison => {
  const scoreGap = Math.abs(proposal.totalScore - historical.totalScore);
  const playerCountGap = Math.abs(proposal.playerCount - historical.playerCount);
  const pickCountGap = Math.abs(proposal.pickCount - historical.pickCount);
  const assetCountGap = Math.abs(proposal.assetCount - historical.assetCount);
  const roleAligned =
    proposal.headlinerKind === "player" &&
    historical.headlinerKind === "player" &&
    proposal.headlinerRoleFamily !== null &&
    proposal.headlinerRoleFamily === historical.headlinerRoleFamily;
  const ageBandAligned =
    proposal.headlinerKind === "player" &&
    historical.headlinerKind === "player" &&
    proposal.headlinerAgeBand !== null &&
    proposal.headlinerAgeBand === historical.headlinerAgeBand;
  const contractAligned =
    proposal.headlinerKind === "player" &&
    historical.headlinerKind === "player" &&
    proposal.headlinerContractStatus !== null &&
    proposal.headlinerContractStatus === historical.headlinerContractStatus;
  const headlinerAligned =
    proposal.headlinerKind !== "none" &&
    historical.headlinerKind !== "none" &&
    proposal.headlinerKind === historical.headlinerKind &&
    (proposal.headlinerKind !== "player" || proposal.headlinerPosition === historical.headlinerPosition) &&
    proposal.headlinerTier === historical.headlinerTier &&
    (proposal.headlinerKind !== "player" || (roleAligned && ageBandAligned && contractAligned));

  const distance =
    scoreGap * 1.2 +
    playerCountGap * 12 +
    pickCountGap * 10 +
    assetCountGap * 4 +
    (proposal.headlinerKind !== historical.headlinerKind ? 12 : 0) +
    (proposal.headlinerKind === "player" && historical.headlinerKind === "player" && proposal.headlinerPosition !== historical.headlinerPosition ? 8 : 0) +
    (proposal.headlinerTier !== historical.headlinerTier ? 6 : 0) +
    (proposal.headlinerKind === "player" && historical.headlinerKind === "player" && !roleAligned ? 7 : 0) +
    (proposal.headlinerKind === "player" && historical.headlinerKind === "player" && !ageBandAligned ? 5 : 0) +
    (proposal.headlinerKind === "player" && historical.headlinerKind === "player" && !contractAligned ? 5 : 0);

  return {
    distance,
    scoreGap,
    playerCountGap,
    pickCountGap,
    assetCountGap,
    headlinerAligned,
    roleAligned,
    ageBandAligned,
    contractAligned,
  };
};

const buildComparableTradeExplanation = (leftComparison: PackageComparison, rightComparison: PackageComparison) => {
  if (leftComparison.scoreGap <= 10 && rightComparison.scoreGap <= 10) {
    return "Close total value on both sides.";
  }

  if (
    leftComparison.playerCountGap === 0 &&
    rightComparison.playerCountGap === 0 &&
    leftComparison.pickCountGap === 0 &&
    rightComparison.pickCountGap === 0
  ) {
    return "Matches the player and pick mix on both sides.";
  }

  if (leftComparison.headlinerAligned || rightComparison.headlinerAligned) {
    return "Headlining asset profile lines up with the proposal.";
  }

  if (leftComparison.roleAligned || rightComparison.roleAligned) {
    return "Role and position profile matches the likely centerpiece of the deal.";
  }

  if (leftComparison.ageBandAligned || rightComparison.ageBandAligned || leftComparison.contractAligned || rightComparison.contractAligned) {
    return "Age band and contract situation are in the same market neighborhood.";
  }

  return "Similar package size with nearby outgoing value.";
};

const toMedian = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex];
  }

  return Math.round((sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2);
};

export const findComparableTrades = (
  leftOutgoingAssets: WorkbenchAsset[],
  rightOutgoingAssets: WorkbenchAsset[],
  trades: TradeRecord[],
  limit = 3,
): ComparableTradeMatch[] => {
  if (leftOutgoingAssets.length === 0 || rightOutgoingAssets.length === 0) {
    return [];
  }

  const leftFingerprint = getPackageFingerprint(leftOutgoingAssets);
  const rightFingerprint = getPackageFingerprint(rightOutgoingAssets);

  return trades
    .flatMap((trade) => {
      if (trade.sides.length < 2) {
        return [];
      }

      let bestMatch: ComparableTradeMatch | null = null;

      for (let leftIndex = 0; leftIndex < trade.sides.length; leftIndex += 1) {
        for (let rightIndex = 0; rightIndex < trade.sides.length; rightIndex += 1) {
          if (leftIndex === rightIndex) {
            continue;
          }

          const leftMatchedSide = trade.sides[leftIndex];
          const rightMatchedSide = trade.sides[rightIndex];
          const leftComparison = comparePackageFingerprints(leftFingerprint, getHistoricalSideFingerprint(leftMatchedSide));
          const rightComparison = comparePackageFingerprints(rightFingerprint, getHistoricalSideFingerprint(rightMatchedSide));
          const combinedDistance = leftComparison.distance + rightComparison.distance;
          const similarityScore = Math.max(0, Math.round(100 - combinedDistance / 3));
          const candidate: ComparableTradeMatch = {
            trade,
            similarityScore,
            explanation: buildComparableTradeExplanation(leftComparison, rightComparison),
            leftMatchedSide,
            rightMatchedSide,
            leftComparison,
            rightComparison,
          };

          if (!bestMatch || candidate.similarityScore > bestMatch.similarityScore) {
            bestMatch = candidate;
          }
        }
      }

      return bestMatch ? [bestMatch] : [];
    })
    .sort(
      (left, right) =>
        right.similarityScore - left.similarityScore ||
        new Date(right.trade.approvedAt ?? right.trade.createdAt).getTime() - new Date(left.trade.approvedAt ?? left.trade.createdAt).getTime() ||
        right.trade.id - left.trade.id,
    )
    .slice(0, limit);
};

export const buildComparableMarketRead = (
  leftOutgoingAssets: WorkbenchAsset[],
  rightOutgoingAssets: WorkbenchAsset[],
  matches: ComparableTradeMatch[],
): ComparableMarketRead | null => {
  if (matches.length === 0) {
    return null;
  }

  const leftProposalScore = summarizeTradePackage(leftOutgoingAssets).totalScore;
  const rightProposalScore = summarizeTradePackage(rightOutgoingAssets).totalScore;
  const leftMedianScore = toMedian(matches.map((match) => match.leftMatchedSide.assetScoreTotal));
  const rightMedianScore = toMedian(matches.map((match) => match.rightMatchedSide.assetScoreTotal));
  const leftDeltaFromMedian = leftProposalScore - leftMedianScore;
  const rightDeltaFromMedian = rightProposalScore - rightMedianScore;
  const overallLabel =
    Math.abs(leftDeltaFromMedian) <= 5 && Math.abs(rightDeltaFromMedian) <= 5
      ? "balanced"
      : leftDeltaFromMedian > rightDeltaFromMedian
        ? "team-a-rich"
        : "team-b-rich";
  const summary =
    overallLabel === "balanced"
      ? "The current proposal sits close to the median return from the matched historical comps."
      : overallLabel === "team-a-rich"
        ? `Team A is paying about ${leftDeltaFromMedian} points above the median matched outgoing package.`
        : `Team B is paying about ${rightDeltaFromMedian} points above the median matched outgoing package.`;

  return {
    leftMedianScore,
    rightMedianScore,
    leftDeltaFromMedian,
    rightDeltaFromMedian,
    overallLabel,
    summary,
  };
};

export const evaluateTradeImpact = (
  team: WorkbenchTeam,
  outgoingAssets: WorkbenchAsset[],
  incomingAssets: WorkbenchAsset[],
): TradeWorkbenchImpact => {
  const outgoingPlayerIds = new Set(outgoingAssets.filter((asset) => asset.kind === "player").map((asset) => asset.id));
  const outgoingPickIds = new Set(outgoingAssets.filter((asset) => asset.kind === "pick").map((asset) => asset.id));
  const teamPlayers = getWorkbenchPlayers(team.assets);
  const teamPicks = getWorkbenchPicks(team.assets);
  const incomingPlayers = getWorkbenchPlayers(incomingAssets);
  const incomingPicks = getWorkbenchPicks(incomingAssets);
  const afterPlayers = [...teamPlayers.filter((player) => !outgoingPlayerIds.has(player.id)), ...incomingPlayers];
  const afterPicks = [...teamPicks.filter((pick) => !outgoingPickIds.has(pick.id)), ...incomingPicks];
  const before = assessTeam(teamPlayers);
  const after = assessTeam(afterPlayers);
  const pickValueBefore = Math.round(teamPicks.reduce((total, pick) => total + pick.score, 0));
  const pickValueAfter = Math.round(afterPicks.reduce((total, pick) => total + pick.score, 0));

  return {
    before,
    after,
    rosterDelta: after.overall - before.overall,
    pickValueBefore,
    pickValueAfter,
    pickValueDelta: pickValueAfter - pickValueBefore,
    playerCountBefore: teamPlayers.length,
    playerCountAfter: afterPlayers.length,
    pickCountBefore: teamPicks.length,
    pickCountAfter: afterPicks.length,
  };
};