import type { DashboardSourceInfo } from "@/lib/domain";

export type SourceHoverSummary = {
  rosterCount: number;
  targetCount: number;
  ownedPickCount: number;
  draftOrderCount: number;
};

const formatModeLabel = (source: DashboardSourceInfo) =>
  source.resolvedMode === "live-file" ? "live cached file" : "demo dataset";

type SourceHoverLabelProps = {
  source: DashboardSourceInfo;
  summary: SourceHoverSummary;
  className?: string;
};

export function SourceHoverLabel({ source, summary, className }: SourceHoverLabelProps) {
  return (
    <div className={className ? `${className} group relative` : "group relative"}>
      <button
        className="inline-flex cursor-pointer items-center rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900 hover:text-white focus:bg-slate-900 focus:text-white"
        type="button"
      >
        Source: {formatModeLabel(source)}
      </button>
      <div className="pointer-events-none absolute left-0 top-full z-50 mt-3 w-[22rem] rounded-[1.5rem] border border-[var(--line)] bg-[rgba(239,242,255,0.96)] p-4 text-sm leading-7 text-slate-700 opacity-0 shadow-[0_24px_50px_rgba(17,32,49,0.18)] transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <p><span className="font-semibold text-slate-900">Mode:</span> {formatModeLabel(source)}</p>
        <p><span className="font-semibold text-slate-900">Live file:</span> {source.liveFilePath ?? "not using a live file"}</p>
        <p><span className="font-semibold text-slate-900">Roster:</span> {summary.rosterCount} players</p>
        <p><span className="font-semibold text-slate-900">Targets:</span> {summary.targetCount} suggested targets</p>
        <p><span className="font-semibold text-slate-900">Owned picks:</span> {summary.ownedPickCount}</p>
        <p><span className="font-semibold text-slate-900">League order entries:</span> {summary.draftOrderCount}</p>
      </div>
    </div>
  );
}