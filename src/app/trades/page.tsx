import type { Metadata } from "next";

import type { SourceHoverSummary } from "@/app/source-hover-label";
import { TradeHistoryShell } from "@/app/trades/trade-history-shell";
import { loadDashboardInput } from "@/lib/dashboard-data-source";
import { loadTradeHistory } from "@/lib/trade-history";
import { getTradeSignalWeight } from "@/lib/valuation";

export const metadata: Metadata = {
  title: "Past Trades | Northstar GM",
  description: "Browse approved PHO trades and compare the moved assets against the current value model.",
};

export default async function TradesPage() {
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const sourceSummary: SourceHoverSummary = {
    rosterCount: input.roster.length,
    targetCount: input.leagueTargets.length,
    ownedPickCount: input.draftPicks.length,
    draftOrderCount: input.draftOrders.length,
  };

  return (
    <TradeHistoryShell
      source={source}
      sourceSummary={sourceSummary}
      tradeSignalWeight={getTradeSignalWeight()}
      trades={tradeHistory.trades}
    />
  );
}