"use client";

import Link from "next/link";
import { useMemo } from "react";

import type { DirectoryTeam } from "@/lib/team-directory";
import { getTeamPath } from "@/lib/team-directory";

type TeamDirectoryPanelProps = {
  teams: DirectoryTeam[];
};

const summaryCardClass =
  "rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]";

const teamCardClass =
  "group relative overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.92))] p-5 shadow-[0_20px_60px_rgba(17,32,49,0.06)] transition hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(239,246,255,0.94))]";

const teamInsetCardClass =
  "rounded-2xl border border-[rgba(16,24,40,0.06)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.92))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]";

export function TeamDirectoryPanel({ teams }: TeamDirectoryPanelProps) {
  const filteredTeams = useMemo(() => teams, [teams]);
  const totalPicks = filteredTeams.reduce((total, team) => total + team.pickCount, 0);
  const averageScore =
    filteredTeams.length === 0
      ? 0
      : Math.round(filteredTeams.reduce((total, team) => total + team.averageScore, 0) / filteredTeams.length);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(225,29,72,0.18),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.55),transparent_50%)]" />
        <div className="relative space-y-5 px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className={summaryCardClass}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Visible teams</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{filteredTeams.length}</p>
            </div>
            <div className={summaryCardClass}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tracked picks</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{totalPicks}</p>
            </div>
            <div className={summaryCardClass}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Avg team score</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{averageScore}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredTeams.map((team) => (
          <Link
            key={team.id}
            className={teamCardClass}
            href={getTeamPath(team.name)}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.12),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(225,29,72,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.18),transparent_48%)]" />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {team.isOwnTeam ? "Current club" : "League club"}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900 transition group-hover:text-[var(--accent)]">
                    {team.name}
                  </h2>
                </div>
                <div className="rounded-full border border-[rgba(16,24,40,0.06)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.93))] px-3 py-1 text-sm font-semibold text-slate-900 shadow-[0_10px_20px_rgba(17,32,49,0.06)]">
                  {team.averageScore}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className={teamInsetCardClass}>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Players</p>
                  <p className="mt-2 font-semibold text-slate-900">{team.playerCount}</p>
                </div>
                <div className={teamInsetCardClass}>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Picks</p>
                  <p className="mt-2 font-semibold text-slate-900">{team.pickCount}</p>
                </div>
                <div className={teamInsetCardClass}>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pick value</p>
                  <p className="mt-2 font-semibold text-slate-900">{team.totalPickValue}</p>
                </div>
                <div className={teamInsetCardClass}>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Projected slot</p>
                  <p className="mt-2 font-semibold text-slate-900">{team.projectedSlot ?? "-"}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                <p>
                  Top player: <span className="font-semibold text-slate-900">{team.topPlayer?.name ?? "No tracked roster"}</span>
                </p>
                <p>
                  {team.weakestBucket
                    ? `Weakest band: ${team.weakestBucket}`
                    : "No bucket scoring available yet."}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                  {team.strongestBucket ? `Best ${team.strongestBucket}` : "No depth map"}
                </span>
                <span className="rounded-full border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                  {team.prospectCount} prospects
                </span>
              </div>
              <p className="mt-5 text-xs uppercase tracking-[0.18em] text-slate-500">Open team page</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}