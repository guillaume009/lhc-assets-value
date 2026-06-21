import type { Metadata } from "next";

import { StandalonePageHeader } from "@/app/standalone-page-header";
import { getAdminDataStatus, type AdminDataSection, type FileTimestampStatus } from "@/lib/data-status";

export const metadata: Metadata = {
  title: "Data Status | Northstar GM",
  description: "Inspect refresh health, cache timestamps, and fallback warnings for dashboard, PHO, and NHL data sources.",
};

const healthTone = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
} as const;

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return "Not available";
  }

  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return "Not available";
  }

  return parsed.toLocaleString();
};

const formatBytes = (value: number | null) => {
  if (value === null) {
    return "Not available";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDuration = (value: number | null) => {
  if (value === null) {
    return "Not cached in memory";
  }

  if (value < 1000) {
    return `${value} ms remaining`;
  }

  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s remaining`;
  }

  return `${minutes}m ${seconds}s remaining`;
};

function FileStatusCard({ label, file }: { label: string; file: FileTimestampStatus }) {
  return (
    <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-5 shadow-[0_16px_40px_rgba(17,32,49,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 break-all text-sm font-medium text-slate-900">{file.path}</p>
        </div>
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
            file.exists ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {file.exists ? "Present" : "Missing"}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Modified</dt>
          <dd className="mt-1 font-medium text-slate-900">{formatTimestamp(file.modifiedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Size</dt>
          <dd className="mt-1 font-medium text-slate-900">{formatBytes(file.sizeBytes)}</dd>
        </div>
      </dl>
      {file.error ? <p className="mt-4 text-sm leading-6 text-amber-700">{file.error}</p> : null}
    </div>
  );
}

function SectionShell({
  section,
  children,
}: {
  section: AdminDataSection;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_24px_60px_rgba(17,32,49,0.08)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{section.title}</p>
          <p className="mt-3 text-base leading-7 text-slate-700">{section.summary}</p>
        </div>
        <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${healthTone[section.health]}`}>
          {section.health}
        </span>
      </div>
      {section.warnings.length > 0 ? (
        <div className="mt-5 rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Fallback warnings</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900">
            {section.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default async function DataStatusPage() {
  const status = await getAdminDataStatus();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(224,231,255,0.9),rgba(248,250,252,0.96)_42%,rgba(255,255,255,1)_78%)] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <StandalonePageHeader activeTab="admin" />

        <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_24px_60px_rgba(17,32,49,0.08)] sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Admin</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Data status</h1>
              <p className="mt-4 text-base leading-7 text-slate-700">
                This page shows which datasets are serving the app right now, when each cache file last changed, and where the app is falling back to safer defaults.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 px-5 py-4 text-sm text-slate-700">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Generated</p>
              <p className="mt-2 font-semibold text-slate-900">{formatTimestamp(status.generatedAt)}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Warnings</p>
              <p className="mt-3 text-3xl font-semibold text-slate-950">{status.warnings.length}</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Dashboard mode</p>
              <p className="mt-3 text-lg font-semibold text-slate-950">{status.dashboard.resolvedMode}</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trade cache</p>
              <p className="mt-3 text-lg font-semibold text-slate-950">{status.trades.tradeCount} trades</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tracked NHL players</p>
              <p className="mt-3 text-lg font-semibold text-slate-950">{status.nhlStats.trackedPlayerCount ?? 0}</p>
            </div>
          </div>
        </section>

        <SectionShell section={status.dashboard}>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <FileStatusCard label="Live dashboard file" file={status.dashboard.liveFile} />
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-5 shadow-[0_16px_40px_rgba(17,32,49,0.08)]">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Refresh health</p>
              <dl className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Configured mode</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.dashboard.configuredMode}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Resolved mode</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.dashboard.resolvedMode}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Memory cache expiry</dt>
                  <dd className="mt-1 font-medium text-slate-900">{formatTimestamp(status.dashboard.inMemoryCache.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Memory cache TTL</dt>
                  <dd className="mt-1 font-medium text-slate-900">{formatDuration(status.dashboard.inMemoryCache.remainingMs)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Roster / targets</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.dashboard.rosterCount} / {status.dashboard.targetCount}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Picks / order rows</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.dashboard.draftPickCount} / {status.dashboard.draftOrderCount}</dd>
                </div>
              </dl>
            </div>
          </div>
        </SectionShell>

        <SectionShell section={status.phoPlayers}>
          <div className="grid gap-4 xl:grid-cols-2">
            <FileStatusCard label="PHO player raw cache" file={status.phoPlayers.rawFile} />
            <FileStatusCard label="PHO contract cache" file={status.phoPlayers.contractFile} />
          </div>
          <div className="mt-4 rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-5 shadow-[0_16px_40px_rgba(17,32,49,0.08)]">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Import posture</p>
            <dl className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Authorization variants</dt>
                <dd className="mt-1 font-medium text-slate-900">{status.phoPlayers.authorizationVariants.join(", ")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Bearer token</dt>
                <dd className="mt-1 font-medium text-slate-900">{status.phoPlayers.hasBearerToken ? "Configured" : "Missing"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Cookie / XSRF</dt>
                <dd className="mt-1 font-medium text-slate-900">{status.phoPlayers.hasCookie ? "Cookie set" : "No cookie"} / {status.phoPlayers.hasXsrfToken ? "XSRF set" : "No XSRF"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Page fetch concurrency</dt>
                <dd className="mt-1 font-medium text-slate-900">{status.phoPlayers.pageFetchConcurrency}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Contract fetch concurrency</dt>
                <dd className="mt-1 font-medium text-slate-900">{status.phoPlayers.contractFetchConcurrency}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Missing-contract cap</dt>
                <dd className="mt-1 font-medium text-slate-900">{status.phoPlayers.maxMissingContractFetches}</dd>
              </div>
            </dl>
          </div>
        </SectionShell>

        <SectionShell section={status.trades}>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <FileStatusCard label="Trade raw cache" file={status.trades.rawFile} />
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-5 shadow-[0_16px_40px_rgba(17,32,49,0.08)]">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Refresh health</p>
              <dl className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Loaded trades</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.trades.tradeCount}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Memory cache expiry</dt>
                  <dd className="mt-1 font-medium text-slate-900">{formatTimestamp(status.trades.inMemoryCache.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Memory cache TTL</dt>
                  <dd className="mt-1 font-medium text-slate-900">{formatDuration(status.trades.inMemoryCache.remainingMs)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Bearer token / cookie</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.trades.hasBearerToken ? "Configured" : "Missing"} / {status.trades.hasCookie ? "Configured" : "Missing"}</dd>
                </div>
              </dl>
            </div>
          </div>
        </SectionShell>

        <SectionShell section={status.nhlStats}>
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <FileStatusCard label="NHL stats cache" file={status.nhlStats.cacheFile} />
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-5 shadow-[0_16px_40px_rgba(17,32,49,0.08)]">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Refresh health</p>
              <dl className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Imported at</dt>
                  <dd className="mt-1 font-medium text-slate-900">{formatTimestamp(status.nhlStats.importedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Refresh interval</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.nhlStats.refreshIntervalHours} hours</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Entries matched / not found</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.nhlStats.matchedCount} / {status.nhlStats.notFoundCount}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Stale entries</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.nhlStats.staleCount}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Tracked players</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.nhlStats.trackedPlayerCount ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Missing / stale tracked</dt>
                  <dd className="mt-1 font-medium text-slate-900">{status.nhlStats.missingTrackedEntryCount ?? 0} / {status.nhlStats.staleTrackedEntryCount ?? 0}</dd>
                </div>
              </dl>
            </div>
          </div>
        </SectionShell>
      </div>
    </main>
  );
}