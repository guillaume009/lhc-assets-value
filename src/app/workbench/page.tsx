import type { Metadata } from "next";

import type { SourceHoverSummary } from "@/app/source-hover-label";
import { TradeWorkbenchShell } from "@/app/workbench/trade-workbench-shell";
import { loadDashboardInput } from "@/lib/dashboard-data-source";
import { getDirectoryPlayers } from "@/lib/player-directory";
import { loadTradeHistory } from "@/lib/trade-history";
import { buildWorkbenchTeams } from "@/lib/trade-workbench";

export const metadata: Metadata = {
  title: "Trade Workbench | Northstar GM",
  description: "Build a proposed deal between two teams and compare package value, roster impact, and draft-capital changes.",
};

export default async function TradeWorkbenchPage() {
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const teams = buildWorkbenchTeams(input, players, tradeHistory.valueSignals);
  const sourceSummary: SourceHoverSummary = {
    rosterCount: input.roster.length,
    targetCount: input.leagueTargets.length,
    ownedPickCount: input.draftPicks.length,
    draftOrderCount: input.draftOrders.length,
  };

  return <TradeWorkbenchShell source={source} sourceSummary={sourceSummary} teams={teams} />;
}