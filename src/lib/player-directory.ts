import type { NormalizedDashboardInput, Player } from "@/lib/domain";
import { getRealUpsideProfile, type RealUpsideProfile } from "@/lib/real-upside";
import {
  extensionAdvice,
  marketLabel,
  scorePlayer,
  type TradeValueSignals,
  tradeRange,
} from "@/lib/valuation";

export type DirectoryPlayer = Player & {
  score: number;
  market: string;
  tradeRange: string;
  extension: ReturnType<typeof extensionAdvice>;
  isOwnTeam: boolean;
  adjustedUpside: number;
  realUpsideProfile: RealUpsideProfile | null;
};

let directoryPlayersCache:
  | { input: NormalizedDashboardInput; tradeValueSignals: TradeValueSignals | undefined; result: DirectoryPlayer[] }
  | null = null;

let directoryTeamsCache: { players: DirectoryPlayer[]; result: string[] } | null = null;

export const getDirectoryPlayers = (input: NormalizedDashboardInput, tradeValueSignals?: TradeValueSignals): DirectoryPlayer[] => {
  if (
    directoryPlayersCache &&
    directoryPlayersCache.input === input &&
    directoryPlayersCache.tradeValueSignals === tradeValueSignals
  ) {
    return directoryPlayersCache.result;
  }

  const allPlayers = [...input.roster, ...input.leagueTargets];

  const result = allPlayers
    .map((player) => {
      const score = scorePlayer(player, tradeValueSignals);
      const realUpsideProfile = getRealUpsideProfile(player);

      return {
        ...player,
        score,
        market: marketLabel(score),
        tradeRange: tradeRange(score),
        extension: extensionAdvice(player, tradeValueSignals),
        isOwnTeam: player.team === input.teamName,
        adjustedUpside: realUpsideProfile?.adjustedUpside ?? player.upside,
        realUpsideProfile,
      };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  directoryPlayersCache = { input, tradeValueSignals, result };
  return result;
};

export const getDirectoryTeams = (players: DirectoryPlayer[]) => {
  if (directoryTeamsCache && directoryTeamsCache.players === players) {
    return directoryTeamsCache.result;
  }

  const result = [...new Set(players.map((player) => player.team))].sort((left, right) => left.localeCompare(right));
  directoryTeamsCache = { players, result };
  return result;
};

export const getDirectoryPlayer = (players: DirectoryPlayer[], playerId: string) =>
  players.find((player) => player.id === playerId) ?? null;
