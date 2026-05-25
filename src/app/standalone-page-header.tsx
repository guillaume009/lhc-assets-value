import { DashboardNav, type DashboardNavTab } from "@/app/dashboard-nav";
import { SourceHoverLabel, type SourceHoverSummary } from "@/app/source-hover-label";
import type { DashboardSourceInfo } from "@/lib/domain";

type StandalonePageHeaderProps = {
  activeTab: DashboardNavTab;
  source?: DashboardSourceInfo;
  sourceSummary?: SourceHoverSummary;
};

export function StandalonePageHeader({ activeTab, source, sourceSummary }: StandalonePageHeaderProps) {
  return (
    <section className="relative z-20 overflow-visible rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)] backdrop-blur">
      <div className="px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex w-full flex-wrap items-center gap-2">
          <div className="mr-auto">
            <DashboardNav activeTab={activeTab} />
          </div>
          {source && sourceSummary ? <SourceHoverLabel source={source} summary={sourceSummary} /> : null}
        </div>
      </div>
    </section>
  );
}