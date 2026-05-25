import type { SourceHoverSummary } from "@/app/source-hover-label";
import { StandalonePageHeader } from "@/app/standalone-page-header";
import { TeamDirectoryPanel } from "@/app/team-directory-panel";
import type { DashboardSourceInfo } from "@/lib/domain";
import type { DirectoryTeam } from "@/lib/team-directory";

type TeamDirectoryShellProps = {
  source: DashboardSourceInfo;
  sourceSummary: SourceHoverSummary;
  teams: DirectoryTeam[];
};

export function TeamDirectoryShell({ source, sourceSummary, teams }: TeamDirectoryShellProps) {
  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <StandalonePageHeader activeTab="teams" source={source} sourceSummary={sourceSummary} />
        <TeamDirectoryPanel teams={teams} />
      </main>
    </div>
  );
}