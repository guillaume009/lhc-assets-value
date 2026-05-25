import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { SourceHoverSummary } from "@/app/source-hover-label";
import { PlayerProfileShell } from "@/app/players/[playerId]/player-profile-shell";
import { loadDashboardInput } from "@/lib/dashboard-data-source";
import { getDirectoryPlayer, getDirectoryPlayers } from "@/lib/player-directory";
import { getTradesForPlayer, loadTradeHistory } from "@/lib/trade-history";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ playerId: string }>;
}): Promise<Metadata> {
  const { playerId } = await params;
  const [{ input }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const player = getDirectoryPlayer(players, playerId);

  if (!player) {
    return {
      title: "Player Not Found | Northstar GM",
    };
  }

  return {
    title: `${player.name} | Northstar GM`,
    description: `${player.team} ${player.position} profile with valuation signals, contract context, and market framing.`,
  };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const player = getDirectoryPlayer(players, playerId);

  if (!player) {
    notFound();
  }

  const sourceSummary: SourceHoverSummary = {
    rosterCount: input.roster.length,
    targetCount: input.leagueTargets.length,
    ownedPickCount: input.draftPicks.length,
    draftOrderCount: input.draftOrders.length,
  };

  return (
    <PlayerProfileShell
      player={player}
      source={source}
      sourceSummary={sourceSummary}
      trades={getTradesForPlayer(tradeHistory, playerId)}
    />
  );
}
