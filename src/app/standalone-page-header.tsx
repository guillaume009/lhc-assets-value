import { DashboardNav, type DashboardNavTab } from "@/app/dashboard-nav";
import { NhlStatsRefreshBadge } from "@/app/nhl-stats-refresh-badge";
import { SourceHoverLabel, type SourceHoverSummary } from "@/app/source-hover-label";
import type { DashboardSourceInfo } from "@/lib/domain";

type DashboardButtonTab = "overview" | "roster" | "market" | "draft" | "players";

type StandalonePageHeaderProps = {
  activeTab: DashboardNavTab;
  source?: DashboardSourceInfo;
  sourceSummary?: SourceHoverSummary;
  onSelectTab?: (tab: DashboardButtonTab) => void;
  children?: React.ReactNode;
};

export function StandalonePageHeader({ activeTab, source, sourceSummary, onSelectTab, children }: StandalonePageHeaderProps) {
  return (
    <section className="relative z-20 overflow-visible rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)] backdrop-blur">
      <div className="px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex w-full flex-col items-start gap-3">
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <DashboardNav activeTab={activeTab} onSelectTab={onSelectTab} />
            <div className="flex flex-col items-end gap-2">
              <NhlStatsRefreshBadge />
              {source && sourceSummary ? <SourceHoverLabel source={source} summary={sourceSummary} /> : null}
            </div>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}