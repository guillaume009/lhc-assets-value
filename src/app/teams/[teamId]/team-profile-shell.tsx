"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { PlayerHeadshot } from "@/app/player-headshot";
import { PlayerLink } from "@/app/player-link";
import { TeamLink } from "@/app/team-link";
import { TradeHistoryList } from "@/app/trade-history-list";
import type { SourceHoverSummary } from "@/app/source-hover-label";
import type { DashboardSourceInfo } from "@/lib/domain";
import { getDraftPickIssuerTeam, hasTradedDraftPick } from "@/lib/draft-pick-order";
import type { DirectoryPlayer } from "@/lib/player-directory";
import type { TradeRecord } from "@/lib/trade-history";
import type { DirectoryTeam, TeamDirectoryPick } from "@/lib/team-directory";
import type { TeamAssessment } from "@/lib/valuation";
import { StandalonePageHeader } from "../../standalone-page-header";

type TeamProfileShellProps = {
  team: DirectoryTeam;
  players: DirectoryPlayer[];
  picks: TeamDirectoryPick[];
  source: DashboardSourceInfo;
  sourceSummary: SourceHoverSummary;
  teamAssessment: TeamAssessment;
  trades: TradeRecord[];
};

type TeamProfileTab = "overview" | "roster" | "draft" | "trades";

const teamProfileTabs: Array<{ id: TeamProfileTab; label: string; detail: string }> = [
  { id: "overview", label: "Overview", detail: "Front-office summary" },
  { id: "roster", label: "Roster", detail: "Players and depth" },
  { id: "draft", label: "Draft", detail: "Picks and timelines" },
  { id: "trades", label: "Trades", detail: "Past transaction history" },
];

export function TeamProfileShell({ team, players, picks, source, sourceSummary, teamAssessment, trades }: TeamProfileShellProps) {
  const [activeTab, setActiveTab] = useState<TeamProfileTab>("overview");
  const sortedPlayers = useMemo(
    () => [...players].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)),
    [players],
  );
  const highestUpsidePlayer = useMemo(
    () =>
      [...players].sort((left, right) => right.upside - left.upside || right.score - left.score || left.name.localeCompare(right.name))[0] ?? null,
    [players],
  );
  const averageCapHit =
    players.length === 0 ? 0 : Number((players.reduce((total, player) => total + player.capHit, 0) / players.length).toFixed(1));
  const maxBucketScore = Math.max(...teamAssessment.bucketScores.map((bucket) => bucket.score), 1);
  const maxPlayerScore = Math.max(...sortedPlayers.map((player) => player.score), 1);
  const pickYearSummary = useMemo(
    () =>
      picks
        .reduce<Array<{ season: number; totalValue: number; pickCount: number }>>((summary, pick) => {
          const existing = summary.find((entry) => entry.season === pick.season);

          if (existing) {
            existing.totalValue += pick.score;
            existing.pickCount += 1;
            return summary;
          }

          summary.push({ season: pick.season, totalValue: pick.score, pickCount: 1 });
          return summary;
        }, [])
        .sort((left, right) => left.season - right.season),
    [picks],
  );
  const maxPickYearValue = Math.max(...pickYearSummary.map((entry) => entry.totalValue), 1);
  const contractSummary = useMemo(
    () =>
      (["signed", "rfa", "ufa", "prospect"] as const).map((status) => ({
        status,
        count: players.filter((player) => player.contractStatus === status).length,
      })),
    [players],
  );

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <StandalonePageHeader activeTab="teams" source={source} sourceSummary={sourceSummary} />

        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(225,29,72,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(17,32,49,0.08),transparent_36%)]" />
          <div className="relative space-y-6 px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link
                  className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white hover:text-slate-900"
                  href="/teams"
                >
                  Back to team directory
                </Link>
                <h1 className="mt-3 text-5xl font-semibold tracking-[-0.05em] text-slate-900 sm:text-6xl">{team.name}</h1>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-700 sm:text-base">
                  This team page combines roster value and the draft picks associated with this club in the current dataset.
                </p>
                <div className="mt-5 flex flex-wrap gap-3 rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-3 backdrop-blur">
                  {teamProfileTabs.map((tab) => {
                    const isActive = activeTab === tab.id;

                    return (
                      <button
                        key={tab.id}
                        className={`rounded-2xl px-4 py-3 text-left transition ${isActive ? "bg-slate-900 text-slate-50" : "bg-transparent text-slate-700 hover:bg-white"}`}
                        onClick={() => setActiveTab(tab.id)}
                        type="button"
                      >
                        <span className="block text-sm font-semibold">{tab.label}</span>
                        <span className={`mt-1 block text-xs ${isActive ? "text-slate-300" : "text-slate-500"}`}>{tab.detail}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {team.strongestBucket ? (
                  <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Best {team.strongestBucket}
                  </span>
                ) : null}
                {team.weakestBucket ? (
                  <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    Needs {team.weakestBucket}
                  </span>
                ) : null}
                <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                  {team.prospectCount} prospects
                </span>
              </div>
            </div>

            {activeTab === "overview" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Roster count</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{team.playerCount}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Average score</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{team.averageScore}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tracked picks</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{team.pickCount}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pick value</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-900">{team.totalPickValue}</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {activeTab === "overview" ? (
          <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Front-office view</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">One-page team readout</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Top player</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{team.topPlayer?.name ?? "No tracked player"}</p>
                  <p className="mt-1 text-sm text-slate-600">{team.topPlayer ? `${team.topPlayer.position} / ${team.topPlayer.market}` : "Awaiting roster data."}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cap average</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">${averageCapHit.toFixed(1)}M</p>
                  <p className="mt-1 text-sm text-slate-600">Per tracked player in this view.</p>
                </div>
              </div>
              <div className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(225,29,72,0.1))] p-5 shadow-[0_18px_40px_rgba(37,99,235,0.08)]">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Executive summary</p>
                <p className="mt-3 text-xl font-semibold text-slate-900">
                  {team.weakestBucket && team.strongestBucket
                    ? `${team.name} is strongest on ${team.strongestBucket} and most exposed on ${team.weakestBucket}.`
                    : `${team.name} is currently tracked with partial roster or pick coverage.`}
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-700">
                  Use the roster tab to scan individual player value and depth balance, then switch to draft to see how much future capital is tied to this club.
                </p>
              </div>
            </article>

            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Bucket balance</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Strength by position group</h2>
              <div className="mt-5 space-y-4">
                {teamAssessment.bucketScores.map((bucket) => (
                  <div key={bucket.bucket} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold capitalize text-slate-900">{bucket.bucket}</p>
                      <p className="font-mono text-sm text-slate-600">score {bucket.score}</p>
                    </div>
                    <div className="mt-3 h-3 rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(bucket.score / maxBucketScore) * 100}%` }} />
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{bucket.count} tracked players in this bucket.</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === "roster" ? (
          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Roster assets</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Players tied to this club</h2>
                </div>
                <Link className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline" href="/players">
                  Open player directory
                </Link>
              </div>
              {sortedPlayers.length === 0 ? (
                <p className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 text-sm text-slate-700">
                  No tracked players are attached to this team in the current data source.
                </p>
              ) : (
                <div className="mt-5 space-y-4">
                  {sortedPlayers.map((player) => (
                    <article key={player.id} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 shadow-[0_18px_40px_rgba(37,99,235,0.08)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <PlayerHeadshot
                            alt={player.name}
                            className="h-14 w-14 rounded-[1.15rem] object-cover shadow-[0_16px_24px_rgba(15,118,110,0.18)]"
                            fallbackClassName="grid h-14 w-14 place-items-center rounded-[1.15rem] bg-[linear-gradient(135deg,rgba(37,99,235,0.95),rgba(225,29,72,0.82))] text-base font-semibold text-white shadow-[0_16px_24px_rgba(37,99,235,0.18)]"
                            name={player.name}
                          />
                          <div>
                            <PlayerLink className="text-lg font-semibold text-slate-900 underline-offset-4" playerId={player.id}>{player.name}</PlayerLink>
                            <p className="mt-1 text-sm text-slate-600">{player.position} / age {player.age} / ${player.capHit.toFixed(1)}M</p>
                          </div>
                        </div>
                        <p className="rounded-full bg-[rgba(37,99,235,0.1)] px-3 py-1 text-sm font-semibold text-[var(--accent)]">{player.score}</p>
                      </div>
                      <div className="mt-4 h-2 rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(player.score / maxPlayerScore) * 100}%` }} />
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{player.role}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[var(--line)] bg-white/85 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                          {player.market}
                        </span>
                        <span className="rounded-full border border-[var(--line)] bg-white/85 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                          {player.tradeRange}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Depth read</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Contract mix and upside</h2>
              <div className="mt-5 space-y-4">
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(225,29,72,0.1))] p-5 shadow-[0_18px_40px_rgba(37,99,235,0.08)]">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-strong)]">Highest upside</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-900">{highestUpsidePlayer?.name ?? "No tracked player"}</p>
                  <p className="mt-2 text-sm text-slate-700">
                    {highestUpsidePlayer
                      ? `${highestUpsidePlayer.position} / upside ${highestUpsidePlayer.upside} / score ${highestUpsidePlayer.score}`
                      : "This appears when roster data is available."}
                  </p>
                </div>
                {contractSummary.map((entry) => (
                  <div key={entry.status} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold capitalize text-slate-900">{entry.status}</p>
                      <p className="font-mono text-sm text-slate-600">{entry.count}</p>
                    </div>
                    <div className="mt-3 h-3 rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-[var(--accent-strong)]" style={{ width: `${players.length === 0 ? 0 : (entry.count / players.length) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === "draft" ? (
          <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Draft assets</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Picks associated with this club</h2>
              {picks.length === 0 ? (
                <p className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 text-sm text-slate-700">
                  No tracked picks are currently attached to this team.
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {picks.map((pick) => (
                    <div key={pick.id} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 shadow-[0_18px_40px_rgba(225,29,72,0.08)]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                            {pick.season} draft
                            {hasTradedDraftPick(pick) ? (
                              <>
                                {" "}(
                                <TeamLink className="underline-offset-4 hover:underline" team={getDraftPickIssuerTeam(pick)}>
                                  {getDraftPickIssuerTeam(pick)}
                                </TeamLink>
                                )
                              </>
                            ) : null}
                          </p>
                          <p className="mt-2 text-lg font-semibold text-slate-900">Round {pick.round} / projected slot {pick.projectedSlot}</p>
                        </div>
                        <p className="rounded-full bg-[rgba(225,29,72,0.1)] px-3 py-1 text-sm font-semibold text-[var(--accent-strong)]">{pick.score}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Draft timeline</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Value by year</h2>
              {pickYearSummary.length === 0 ? (
                <p className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 text-sm text-slate-700">
                  No year-by-year draft outlook is available because there are no tracked picks for this team.
                </p>
              ) : (
                <div className="mt-5 space-y-4">
                  {pickYearSummary.map((entry) => (
                    <div key={entry.season} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-slate-900">{entry.season}</p>
                        <p className="font-mono text-sm text-slate-600">{entry.totalValue}</p>
                      </div>
                      <div className="mt-3 h-3 rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[var(--accent-strong)]" style={{ width: `${(entry.totalValue / maxPickYearValue) * 100}%` }} />
                      </div>
                      <p className="mt-3 text-sm text-slate-600">{entry.pickCount} tracked pick{entry.pickCount === 1 ? "" : "s"} in this class.</p>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        ) : null}

        {activeTab === "trades" ? (
          <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trade history</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Past deals involving {team.name}</h2>
            <div className="mt-5">
              <TradeHistoryList
                emptyMessage="No approved PHO trades involving this team were found in the current trade cache."
                highlightTeamName={team.name}
                trades={trades}
              />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}