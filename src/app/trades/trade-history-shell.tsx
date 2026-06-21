"use client";

import { useMemo, useState } from "react";

import { StandalonePageHeader } from "@/app/standalone-page-header";
import type { SourceHoverSummary } from "@/app/source-hover-label";
import { TradeHistoryList } from "@/app/trade-history-list";
import { TradeRefreshButton } from "@/app/trades/trade-refresh-button";
import type { DashboardSourceInfo } from "@/lib/domain";
import type { TradeRecord } from "@/lib/trade-history";
import { DEFAULT_TRADE_SIGNAL_WEIGHT } from "@/lib/valuation";

type TradeHistoryShellProps = {
  source: DashboardSourceInfo;
  sourceSummary: SourceHoverSummary;
  trades: TradeRecord[];
  tradeSignalWeight: number;
};

const formatTradeSignalWeight = (value: number) => `${Math.round(value * 100)}%`;

export function TradeHistoryShell({ source, sourceSummary, trades, tradeSignalWeight }: TradeHistoryShellProps) {
  const [searchValue, setSearchValue] = useState("");
  const normalizedSearchValue = searchValue.trim().toLowerCase();
  const filteredTrades = useMemo(() => {
    if (!normalizedSearchValue) {
      return trades;
    }

    return trades.filter((trade) => {
      const searchableFields = [
        String(trade.id),
        trade.createdAt,
        trade.updatedAt,
        trade.approvedAt ?? "",
        ...trade.teams,
        ...trade.sides.flatMap((side) => [
          side.teamName,
          side.comments,
          ...side.assets.flatMap((asset) => [
            asset.label,
            asset.description ?? "",
            asset.type,
            asset.issuerTeam ?? "",
            asset.role ?? "",
            asset.position ?? "",
          ]),
        ]),
      ];

      return searchableFields.some((field) => field.toLowerCase().includes(normalizedSearchValue));
    });
  }, [normalizedSearchValue, trades]);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <StandalonePageHeader activeTab="trades" source={source} sourceSummary={sourceSummary} />
        <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Approved trades</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{trades.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Visible teams</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{new Set(trades.flatMap((trade) => trade.teams)).size}</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tracked assets moved</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{trades.reduce((total, trade) => total + trade.sides.reduce((count, side) => count + side.assets.length, 0), 0)}</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 sm:col-span-3 lg:col-span-1">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trade signal weight</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{formatTradeSignalWeight(tradeSignalWeight)}</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Set <code>NHL_SIM_TRADE_SIGNAL_WEIGHT</code> from 0 to 1 in <code>.env.local</code> to tune how much prior trades influence the score model. Default is {formatTradeSignalWeight(DEFAULT_TRADE_SIGNAL_WEIGHT)}.
              </p>
            </div>
          </div>
        </section>
        <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Past transactions</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-900">Approved trade history</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-700">
                This view uses the cached PHO trade log to show who moved, which teams were involved, and an estimated package value using the same score model that powers the rest of the app.
              </p>
            </div>
            <TradeRefreshButton />
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="text-sm text-slate-700">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Search trades</span>
              <input
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search by team, player, pick, comment, or trade ID"
                type="search"
                value={searchValue}
              />
            </label>
            <div className="rounded-[1.25rem] border border-[var(--line)] bg-white/85 px-4 py-3 text-right">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Matching trades</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{filteredTrades.length}</p>
            </div>
          </div>
          <div className="mt-5">
            <TradeHistoryList
              emptyMessage={
                normalizedSearchValue
                  ? "No trades matched the current search."
                  : "No approved PHO trades are available in the current trade cache yet."
              }
              limit={100}
              searchQuery={searchValue}
              trades={filteredTrades}
            />
          </div>
        </section>
      </main>
    </div>
  );
}