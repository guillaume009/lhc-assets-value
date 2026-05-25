import type { Metadata } from "next";

import { PlayerDirectoryShell } from "@/app/players/player-directory-shell";
import type { SourceHoverSummary } from "@/app/source-hover-label";
import { loadDashboardInput } from "@/lib/dashboard-data-source";
import { getDirectoryPlayers, getDirectoryTeams } from "@/lib/player-directory";
import { loadTradeHistory } from "@/lib/trade-history";

export const metadata: Metadata = {
  title: "Player Directory | Northstar GM",
  description: "Browse every player in the league with searchable filters, valuation scores, and full player profiles.",
};

export default async function PlayersPage() {
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const teams = getDirectoryTeams(players);
  const sourceSummary: SourceHoverSummary = {
    rosterCount: input.roster.length,
    targetCount: input.leagueTargets.length,
    ownedPickCount: input.draftPicks.length,
    draftOrderCount: input.draftOrders.length,
  };

  return <PlayerDirectoryShell players={players} source={source} sourceSummary={sourceSummary} teams={teams} />;
}
