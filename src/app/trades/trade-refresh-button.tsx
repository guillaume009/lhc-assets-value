"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type RefreshState = {
  tone: "neutral" | "success" | "warning" | "error";
  message: string;
} | null;

type RefreshResponse = {
  ok?: boolean;
  fallback?: boolean;
  warning?: string;
  error?: string;
  cachedTradeCount?: number;
  tradeCount?: number;
};

const stateToneClassName: Record<NonNullable<RefreshState>["tone"], string> = {
  neutral: "border-[var(--line)] bg-white/85 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
};

export function TradeRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshState, setRefreshState] = useState<RefreshState>(null);

  const handleRefresh = () => {
    startTransition(async () => {
      setRefreshState({ tone: "neutral", message: "Refreshing PHO trade cache..." });

      try {
        const response = await fetch("/api/import/playhockeyonline/trades", {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        });

        const payload = (await response.json().catch(() => ({}))) as RefreshResponse;

        if (!response.ok || payload.ok === false) {
          setRefreshState({
            tone: "error",
            message: payload.error ?? "Trade refresh failed.",
          });
          return;
        }

        if (payload.fallback) {
          setRefreshState({
            tone: "warning",
            message:
              payload.warning ??
              `PHO rate-limited the refresh. Kept ${payload.cachedTradeCount ?? 0} cached trades.`,
          });
          router.refresh();
          return;
        }

        setRefreshState({
          tone: "success",
          message: `Trade cache refreshed. Loaded ${payload.tradeCount ?? payload.cachedTradeCount ?? 0} trades.`,
        });
        router.refresh();
      } catch (error) {
        setRefreshState({
          tone: "error",
          message: error instanceof Error ? error.message : "Trade refresh failed.",
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:items-end">
      <button
        className="inline-flex min-w-[12rem] items-center justify-center rounded-full border border-[var(--line)] bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        onClick={handleRefresh}
        type="button"
      >
        {isPending ? "Refreshing..." : "Refresh PHO trades"}
      </button>
      {refreshState ? (
        <p className={`rounded-[1.25rem] border px-4 py-3 text-sm leading-6 ${stateToneClassName[refreshState.tone]}`}>
          {refreshState.message}
        </p>
      ) : null}
    </div>
  );
}