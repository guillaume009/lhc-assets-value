import type { NormalizedDashboardInput, Player } from "@/lib/domain";
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
};

export const getDirectoryPlayers = (input: NormalizedDashboardInput, tradeValueSignals?: TradeValueSignals): DirectoryPlayer[] => {
  const allPlayers = [...input.roster, ...input.leagueTargets];

  return allPlayers
    .map((player) => {
      const score = scorePlayer(player, tradeValueSignals);

      return {
        ...player,
        score,
        market: marketLabel(score),
        tradeRange: tradeRange(score),
        extension: extensionAdvice(player, tradeValueSignals),
        isOwnTeam: player.team === input.teamName,
      };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
};

export const getDirectoryTeams = (players: DirectoryPlayer[]) =>
  [...new Set(players.map((player) => player.team))].sort((left, right) => left.localeCompare(right));

export const getDirectoryPlayer = (players: DirectoryPlayer[], playerId: string) =>
  players.find((player) => player.id === playerId) ?? null;
