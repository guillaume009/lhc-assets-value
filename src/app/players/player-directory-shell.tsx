"use client";

import { PlayerDirectoryPanel } from "@/app/player-directory-panel";
import { StandalonePageHeader } from "@/app/standalone-page-header";
import type { SourceHoverSummary } from "@/app/source-hover-label";
import type { DashboardSourceInfo } from "@/lib/domain";
import type { DirectoryPlayer } from "@/lib/player-directory";

type PlayerDirectoryShellProps = {
  players: DirectoryPlayer[];
  source: DashboardSourceInfo;
  sourceSummary: SourceHoverSummary;
  teams: string[];
};

export function PlayerDirectoryShell({ players, source, sourceSummary, teams }: PlayerDirectoryShellProps) {
  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <StandalonePageHeader activeTab="players" source={source} sourceSummary={sourceSummary} />
        <PlayerDirectoryPanel players={players} teams={teams} nhlStatsRefreshEnabled={source.resolvedMode === "live-file"} />
      </main>
    </div>
  );
}
