import type { Metadata } from "next";

import { TeamDirectoryShell } from "@/app/teams/team-directory-shell";
import type { SourceHoverSummary } from "@/app/source-hover-label";
import { loadDashboardInput } from "@/lib/dashboard-data-source";
import { getDirectoryPlayers } from "@/lib/player-directory";
import { loadTradeHistory } from "@/lib/trade-history";
import { getTeamDirectoryEntries } from "@/lib/team-directory";

export const metadata: Metadata = {
  title: "Team Directory | Northstar GM",
  description: "Browse tracked teams, their roster value, and associated draft assets.",
};

export default async function TeamsPage() {
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const teams = getTeamDirectoryEntries(input, players, tradeHistory.valueSignals);
  const sourceSummary: SourceHoverSummary = {
    rosterCount: input.roster.length,
    targetCount: input.leagueTargets.length,
    ownedPickCount: input.draftPicks.length,
    draftOrderCount: input.draftOrders.length,
  };

  return <TeamDirectoryShell source={source} sourceSummary={sourceSummary} teams={teams} />;
}