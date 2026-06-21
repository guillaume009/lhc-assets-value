"use client";

import { useEffect, useState } from "react";

type RefreshProgress = {
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  total: number;
  processed: number;
  matched: number;
  notFound: number;
  failed: number;
  inFlight: boolean;
  trigger: "auto-background" | "auto-foreground" | "manual";
  lastError: string | null;
};

type CacheSummary = {
  trackedPlayerCount: number | null;
  missingTrackedEntryCount: number | null;
  staleTrackedEntryCount: number | null;
  matchedCount: number;
  notFoundCount: number;
  entryCount: number;
};

type ApiResponse = {
  ok: boolean;
  progress: RefreshProgress | null;
  summary: CacheSummary;
};

const POLL_INTERVAL_MS = 4_000;
const HEALTHY_BADGE_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedHealthyBadgePayload: ApiResponse | null = null;
let cachedHealthyBadgeAt = 0;

const hasPendingRosterStatsWork = (payload: ApiResponse) => {
  const inFlight = payload.progress?.inFlight ?? false;
  const missing = payload.summary.missingTrackedEntryCount ?? 0;
  const stale = payload.summary.staleTrackedEntryCount ?? 0;

  return inFlight || missing + stale > 0;
};

const getCachedHealthyBadgePayload = () => {
  if (!cachedHealthyBadgePayload) {
    return null;
  }

  if (Date.now() - cachedHealthyBadgeAt > HEALTHY_BADGE_CACHE_TTL_MS) {
    cachedHealthyBadgePayload = null;
    cachedHealthyBadgeAt = 0;
    return null;
  }

  return cachedHealthyBadgePayload;
};

type StatsBadgeProps = {
  badgeClassName: string;
  dotClassName: string;
  label: string;
  details: string[];
};

function StatsBadge({ badgeClassName, dotClassName, label, details }: StatsBadgeProps) {
  return (
    <div className="group relative">
      <button className={badgeClassName} type="button">
        <span className={dotClassName} aria-hidden />
        {label}
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-3 w-[22rem] rounded-[1.5rem] border border-[var(--line)] bg-[rgba(239,242,255,0.96)] p-4 text-left text-sm leading-7 text-slate-700 opacity-0 shadow-[0_24px_50px_rgba(17,32,49,0.18)] transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        {details.map((detail) => (
          <p key={detail}>{detail}</p>
        ))}
      </div>
    </div>
  );
}

export function NhlStatsRefreshBadge() {
  const [data, setData] = useState<ApiResponse | null>(() => getCachedHealthyBadgePayload());

  useEffect(() => {
    if (getCachedHealthyBadgePayload()) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      let shouldContinuePolling = true;

      try {
        const response = await fetch("/api/import/nhl/player-stats", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as ApiResponse;
        if (!cancelled) {
          setData(payload);
        }

        if (!hasPendingRosterStatsWork(payload)) {
          cachedHealthyBadgePayload = payload;
          cachedHealthyBadgeAt = Date.now();
          shouldContinuePolling = false;
        } else {
          cachedHealthyBadgePayload = null;
          cachedHealthyBadgeAt = 0;
        }
      } catch {
        // ignore; will retry on next tick
      } finally {
        if (!cancelled && shouldContinuePolling) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  if (!data) {
    return null;
  }

  const { progress, summary } = data;
  const inFlight = progress?.inFlight ?? false;
  const tracked = summary.trackedPlayerCount;
  const matched = summary.matchedCount;
  const missing = summary.missingTrackedEntryCount ?? 0;
  const stale = summary.staleTrackedEntryCount ?? 0;
  const pending = missing + stale;
  // Coverage = matched tracked players / total tracked players. We expose this
  // as a percentage so the badge reflects "how filled is the NHL stats cache
  // for the players the user can actually see".
  const trackedMatched = tracked === null ? null : Math.max(tracked - pending, 0);
  const coveragePct =
    tracked && tracked > 0 && trackedMatched !== null
      ? Math.min(100, Math.round((trackedMatched / tracked) * 100))
      : null;

  if (!inFlight && pending === 0 && tracked !== null && tracked > 0) {
    return (
      <StatsBadge
        badgeClassName="inline-flex cursor-pointer items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800"
        dotClassName="h-1.5 w-1.5 rounded-full bg-emerald-500"
        label={`Roster NHL stats 100% (${tracked})`}
        details={[
          `All ${tracked} roster players have NHL stats.`,
          `Cache size ${summary.entryCount}.`,
          `${matched} matched.`,
          `${summary.notFoundCount} not-found.`,
        ]}
      />
    );
  }

  if (inFlight && progress) {
    const total = progress.total || 1;
    const batchPercent = Math.min(100, Math.round((progress.processed / total) * 100));
    const triggerLabel =
      progress.trigger === "manual"
        ? "Manual refresh"
        : progress.trigger === "auto-background"
          ? "Background refresh"
          : "Refresh";
    const details = [
      `${triggerLabel}: ${progress.processed}/${progress.total} processed.`,
      `${progress.matched} matched.`,
      `${progress.notFound} not found.`,
      `${progress.failed} failed.`,
    ];

    if (tracked !== null && trackedMatched !== null) {
      details.push(`Coverage ${trackedMatched}/${tracked}${coveragePct !== null ? ` (${coveragePct}%)` : ""}.`);
    }

    if (progress.lastError) {
      details.push(`Last error: ${progress.lastError}`);
    }

    return (
      <StatsBadge
        badgeClassName="inline-flex cursor-pointer items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-800"
        dotClassName="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500"
        label={`Refreshing roster NHL stats ${progress.processed}/${progress.total} (${batchPercent}%)`}
        details={details}
      />
    );
  }

  // Incomplete coverage but no refresh in flight. The polling itself will
  // kick the next auto-refresh on the server, so the user just needs to see
  // the gap shrinking on the next tick.
  const coverageText =
    tracked !== null && trackedMatched !== null
      ? `${trackedMatched}/${tracked}${coveragePct !== null ? ` (${coveragePct}%)` : ""}`
      : `${pending} pending`;

  return (
    <StatsBadge
      badgeClassName="inline-flex cursor-pointer items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800"
      dotClassName="h-1.5 w-1.5 rounded-full bg-amber-500"
      label={`Roster NHL stats ${coverageText}`}
      details={[
        `${missing} roster players are missing NHL stats.`,
        `${stale} roster players have stale NHL stats.`,
        "Auto-refresh only covers the current roster. Open a player page to refresh an individual non-roster player on demand.",
      ]}
    />
  );
}
