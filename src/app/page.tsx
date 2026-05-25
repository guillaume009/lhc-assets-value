import { DashboardShell } from "@/app/dashboard-shell";
import { loadDashboardInput } from "@/lib/dashboard-data-source";
import { getDirectoryPlayers, getDirectoryTeams } from "@/lib/player-directory";
import { loadTradeHistory } from "@/lib/trade-history";
import { getDashboardSnapshot } from "@/lib/valuation";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const snapshot = getDashboardSnapshot(input, tradeHistory.valueSignals);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const teams = getDirectoryTeams(players);

  return (
    <DashboardShell
      draftOrders={input.draftOrders}
      initialSearchParams={resolvedSearchParams}
      players={players}
      snapshot={snapshot}
      source={source}
      teams={teams}
    />
  );
}
