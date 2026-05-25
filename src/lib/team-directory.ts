import type { DraftPick, NormalizedDashboardInput } from "@/lib/domain";
import { getDraftPickIssuerTeam } from "@/lib/draft-pick-order";
import type { DirectoryPlayer } from "@/lib/player-directory";
import { assessTeam, scorePick, type TradeValueSignals } from "@/lib/valuation";

export type TeamDirectoryPick = DraftPick & {
  score: number;
};

export type DirectoryTeam = {
  id: string;
  name: string;
  playerCount: number;
  pickCount: number;
  averageScore: number;
  totalPickValue: number;
  topPlayer: DirectoryPlayer | null;
  projectedSlot: number | null;
  prospectCount: number;
  strongestBucket: string | null;
  weakestBucket: string | null;
  isOwnTeam: boolean;
};

export const getTeamId = (teamName: string) => encodeURIComponent(teamName);

export const getTeamPath = (teamName: string) => `/teams/${getTeamId(teamName)}`;

export const getTeamNameFromId = (teamId: string) => {
  try {
    return decodeURIComponent(teamId);
  } catch {
    return teamId;
  }
};

export const getTeamPlayers = (players: DirectoryPlayer[], teamName: string) =>
  players.filter((player) => player.team === teamName);

export const getTeamPicks = (input: NormalizedDashboardInput, teamName: string, tradeValueSignals?: TradeValueSignals): TeamDirectoryPick[] =>
  input.draftPicks
    .filter((pick) => pick.team === teamName)
    .map((pick) => ({
      ...pick,
      score: scorePick(pick, tradeValueSignals),
    }))
    .sort((left, right) => left.season - right.season || left.round - right.round || left.projectedSlot - right.projectedSlot);

export const getTeamDirectoryEntries = (
  input: NormalizedDashboardInput,
  players: DirectoryPlayer[],
  tradeValueSignals?: TradeValueSignals,
): DirectoryTeam[] => {
  const currentSeason = new Date().getFullYear();
  const teamNames = [...new Set([
    input.teamName,
    ...players.map((player) => player.team),
    ...input.draftPicks.map((pick) => pick.team),
    ...input.draftPicks.map((pick) => getDraftPickIssuerTeam(pick)),
    ...input.draftOrders.map((order) => order.team),
  ])].sort((left, right) => left.localeCompare(right));

  return teamNames
    .map((teamName) => {
      const teamPlayers = getTeamPlayers(players, teamName);
      const teamPicks = getTeamPicks(input, teamName, tradeValueSignals);
      const teamAssessment = assessTeam(teamPlayers, tradeValueSignals);
      const projectedSlot =
        input.draftOrders.find((order) => order.team === teamName && order.season === currentSeason)?.projectedSlot ?? null;

      return {
        id: getTeamId(teamName),
        name: teamName,
        playerCount: teamPlayers.length,
        pickCount: teamPicks.length,
        averageScore: teamAssessment.overall,
        totalPickValue: teamPicks.reduce((total, pick) => total + pick.score, 0),
        topPlayer: teamPlayers[0] ?? null,
        projectedSlot,
        prospectCount: teamAssessment.prospectCount,
        strongestBucket: teamPlayers.length > 0 ? teamAssessment.strongest.bucket : null,
        weakestBucket: teamPlayers.length > 0 ? teamAssessment.weakest.bucket : null,
        isOwnTeam: teamName === input.teamName,
      };
    })
    .sort(
      (left, right) =>
        Number(right.isOwnTeam) - Number(left.isOwnTeam) ||
        right.averageScore - left.averageScore ||
        right.totalPickValue - left.totalPickValue ||
        left.name.localeCompare(right.name),
    );
};

export const getDirectoryTeam = (teams: DirectoryTeam[], teamId: string) => {
  const teamName = getTeamNameFromId(teamId);

  return teams.find((team) => team.name === teamName || team.id === teamId) ?? null;
};