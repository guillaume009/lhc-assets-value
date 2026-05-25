"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { DashboardNav } from "@/app/dashboard-nav";
import { DraftPickOrderEditor } from "@/app/draft-pick-order-editor";
import { PlayerDirectoryPanel } from "@/app/player-directory-panel";
import { PlayerHeadshot } from "@/app/player-headshot";
import { PlayerLink } from "@/app/player-link";
import { SourceHoverLabel } from "@/app/source-hover-label";
import { TeamLink } from "@/app/team-link";
import type { DraftOrder, DraftPick, DashboardSourceInfo } from "@/lib/domain";
import { formatDraftPickTeamLabel, getDraftPickIssuerTeam, hasTradedDraftPick } from "@/lib/draft-pick-order";
import type { DirectoryPlayer } from "@/lib/player-directory";
import type { DashboardSnapshot, PickScore, RosterScore, TradeTarget } from "@/lib/valuation";
import { tradeRange } from "@/lib/valuation";

type DashboardShellProps = {
  draftOrders: DraftOrder[];
  initialSearchParams: Record<string, string | string[] | undefined>;
  players: DirectoryPlayer[];
  source: DashboardSourceInfo;
  snapshot: DashboardSnapshot;
  teams: string[];
};

type DashboardTab = "overview" | "roster" | "market" | "draft" | "players";
type RosterView = "table" | "cards" | "chart";
type MarketView = "targets" | "needs";
type DraftView = "table" | "chart" | "editor";
type SortDirection = "asc" | "desc";
type RosterSortKey = "name" | "position" | "age" | "capHit" | "score";
type PickSortKey = "team" | "season" | "round" | "projectedSlot" | "score";

const dashboardTabs: DashboardTab[] = ["overview", "roster", "market", "draft", "players"];
const rosterViews: RosterView[] = ["table", "cards", "chart"];
const marketViews: MarketView[] = ["targets", "needs"];
const draftViews: DraftView[] = ["table", "chart", "editor"];
const rosterSortKeys: RosterSortKey[] = ["name", "position", "age", "capHit", "score"];
const pickSortKeys: PickSortKey[] = ["team", "season", "round", "projectedSlot", "score"];
const sortDirections: SortDirection[] = ["asc", "desc"];

const sortArray = <T,>(items: T[], compare: (left: T, right: T) => number, direction: SortDirection) =>
  [...items].sort((left, right) => (direction === "asc" ? compare(left, right) : compare(right, left)));

const compareRoster = (key: RosterSortKey) => (left: RosterScore, right: RosterScore) => {
  switch (key) {
    case "name":
      return left.name.localeCompare(right.name);
    case "position":
      return left.position.localeCompare(right.position);
    case "age":
      return left.age - right.age;
    case "capHit":
      return left.capHit - right.capHit;
    case "score":
      return left.score - right.score;
  }
};

const comparePicks = (key: PickSortKey) => (left: PickScore, right: PickScore) => {
  switch (key) {
    case "team":
      return formatDraftPickTeamLabel(left).localeCompare(formatDraftPickTeamLabel(right));
    case "season":
      return left.season - right.season || left.round - right.round || left.projectedSlot - right.projectedSlot;
    case "round":
      return left.round - right.round;
    case "projectedSlot":
      return left.projectedSlot - right.projectedSlot;
    case "score":
      return left.score - right.score;
  }
};

const parseEnumParam = <T extends string>(
  value: string | null,
  allowedValues: T[],
  fallback: T,
) => (value && allowedValues.includes(value as T) ? (value as T) : fallback);

const ageBucketLabel = (age: number) => {
  if (age <= 20) return "20 and under";
  if (age <= 24) return "21-24";
  if (age <= 28) return "25-28";
  if (age <= 32) return "29-32";
  return "33+";
};

const getInitialParamValue = (
  initialSearchParams: Record<string, string | string[] | undefined>,
  key: string,
) => {
  const value = initialSearchParams[key];

  return Array.isArray(value) ? value[0] ?? null : value ?? null;
};

export function DashboardShell({ draftOrders, initialSearchParams, players, snapshot, source, teams }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isTabPending, startTabTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<DashboardTab>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "tab"), dashboardTabs, "overview"),
  );
  const [pendingTab, setPendingTab] = useState<DashboardTab | null>(null);
  const [rosterView, setRosterView] = useState<RosterView>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "rv"), rosterViews, "table"),
  );
  const [marketView, setMarketView] = useState<MarketView>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "mv"), marketViews, "targets"),
  );
  const [draftView, setDraftView] = useState<DraftView>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "dv"), draftViews, "table"),
  );
  const [rosterQuery, setRosterQuery] = useState(getInitialParamValue(initialSearchParams, "rq") ?? "");
  const [rosterPositionFilter, setRosterPositionFilter] = useState<string>(
    getInitialParamValue(initialSearchParams, "rp") ?? "all",
  );
  const [draftQuery, setDraftQuery] = useState(getInitialParamValue(initialSearchParams, "dq") ?? "");
  const [draftSeasonFilter, setDraftSeasonFilter] = useState<string>(
    getInitialParamValue(initialSearchParams, "ds") ?? "all",
  );
  const [rosterSortKey, setRosterSortKey] = useState<RosterSortKey>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "rs"), rosterSortKeys, "score"),
  );
  const [rosterSortDirection, setRosterSortDirection] = useState<SortDirection>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "rd"), sortDirections, "desc"),
  );
  const [pickSortKey, setPickSortKey] = useState<PickSortKey>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "ps"), pickSortKeys, "season"),
  );
  const [pickSortDirection, setPickSortDirection] = useState<SortDirection>(() =>
    parseEnumParam(getInitialParamValue(initialSearchParams, "pd"), sortDirections, "asc"),
  );

  const prospectWatch =
    [...snapshot.rosterScores]
      .filter((player) => player.contractStatus === "prospect")
      .sort((left, right) => right.score - left.score)[0] ?? null;

  const rosterPositions = [...new Set(snapshot.rosterScores.map((player) => player.position))].sort();
  const draftSeasons = [...new Set(snapshot.picks.map((pick) => pick.season))].sort((left, right) => left - right);

  const filteredRoster = useMemo(() => {
    const normalizedQuery = rosterQuery.trim().toLowerCase();

    return snapshot.rosterScores.filter((player) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        player.name.toLowerCase().includes(normalizedQuery) ||
        player.role.toLowerCase().includes(normalizedQuery);
      const matchesPosition = rosterPositionFilter === "all" || player.position === rosterPositionFilter;

      return matchesQuery && matchesPosition;
    });
  }, [rosterPositionFilter, rosterQuery, snapshot.rosterScores]);

  const sortedRoster = useMemo(
    () => sortArray(filteredRoster, compareRoster(rosterSortKey), rosterSortDirection),
    [filteredRoster, rosterSortDirection, rosterSortKey],
  );

  const filteredPicks = useMemo(() => {
    const normalizedQuery = draftQuery.trim().toLowerCase();

    return snapshot.picks.filter((pick) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        formatDraftPickTeamLabel(pick).toLowerCase().includes(normalizedQuery) ||
        String(pick.round).includes(normalizedQuery) ||
        String(pick.season).includes(normalizedQuery);
      const matchesSeason = draftSeasonFilter === "all" || String(pick.season) === draftSeasonFilter;

      return matchesQuery && matchesSeason;
    });
  }, [draftQuery, draftSeasonFilter, snapshot.picks]);

  const sortedPicks = useMemo(
    () => sortArray(filteredPicks, comparePicks(pickSortKey), pickSortDirection),
    [filteredPicks, pickSortDirection, pickSortKey],
  );

  const toggleRosterSort = (key: RosterSortKey) => {
    if (rosterSortKey === key) {
      setRosterSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setRosterSortKey(key);
    setRosterSortDirection(key === "name" || key === "position" ? "asc" : "desc");
  };

  const togglePickSort = (key: PickSortKey) => {
    if (pickSortKey === key) {
      setPickSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setPickSortKey(key);
    setPickSortDirection(key === "team" || key === "season" ? "asc" : "desc");
  };

  const renderSortLabel = (isActive: boolean, direction: SortDirection) => {
    if (!isActive) {
      return "↕";
    }

    return direction === "asc" ? "↑" : "↓";
  };

  const handleTabChange = (nextTab: DashboardTab) => {
    if (nextTab === activeTab) {
      return;
    }

    setPendingTab(nextTab);
    startTabTransition(() => {
      setActiveTab(nextTab);
    });
  };

  const sourceSummary = {
    rosterCount: snapshot.rosterScores.length,
    targetCount: snapshot.targets.length,
    draftOrderCount: draftOrders.length,
    ownedPickCount: snapshot.picks.length,
  };

  const maxRosterScore = Math.max(...sortedRoster.map((player) => player.score), 1);
  const maxPickScore = Math.max(...sortedPicks.map((pick) => pick.score), 1);

  const rosterPositionSummary = useMemo(
    () =>
      rosterPositions
        .map((position) => {
          const players = sortedRoster.filter((player) => player.position === position);
          const averageScore =
            players.length === 0
              ? 0
              : Math.round(players.reduce((total, player) => total + player.score, 0) / players.length);

          return {
            position,
            count: players.length,
            averageScore,
          };
        })
        .filter((bucket) => bucket.count > 0),
    [rosterPositions, sortedRoster],
  );

  const rosterAgeSummary = useMemo(() => {
    const countsByBucket = new Map<string, number>();

    for (const player of sortedRoster) {
      const bucket = ageBucketLabel(player.age);
      countsByBucket.set(bucket, (countsByBucket.get(bucket) ?? 0) + 1);
    }

    return ["20 and under", "21-24", "25-28", "29-32", "33+"].map((bucket) => ({
      bucket,
      count: countsByBucket.get(bucket) ?? 0,
    }));
  }, [sortedRoster]);

  const pickYearSummary = useMemo(() => {
    const grouped = new Map<number, { season: number; totalValue: number; averageSlot: number; pickCount: number }>();

    for (const pick of sortedPicks) {
      const current = grouped.get(pick.season) ?? {
        season: pick.season,
        totalValue: 0,
        averageSlot: 0,
        pickCount: 0,
      };

      current.totalValue += pick.score;
      current.averageSlot += pick.projectedSlot;
      current.pickCount += 1;
      grouped.set(pick.season, current);
    }

    return [...grouped.values()]
      .map((entry) => ({
        ...entry,
        averageSlot: Math.round(entry.averageSlot / Math.max(entry.pickCount, 1)),
      }))
      .sort((left, right) => left.season - right.season);
  }, [sortedPicks]);

  const pickRoundSummary = useMemo(() => {
    const grouped = new Map<number, { round: number; count: number; averageValue: number }>();

    for (const pick of sortedPicks) {
      const current = grouped.get(pick.round) ?? { round: pick.round, count: 0, averageValue: 0 };
      current.count += 1;
      current.averageValue += pick.score;
      grouped.set(pick.round, current);
    }

    return [...grouped.values()]
      .map((entry) => ({
        ...entry,
        averageValue: Math.round(entry.averageValue / Math.max(entry.count, 1)),
      }))
      .sort((left, right) => left.round - right.round);
  }, [sortedPicks]);

  const maxPositionAverage = Math.max(...rosterPositionSummary.map((bucket) => bucket.averageScore), 1);
  const maxAgeBucketCount = Math.max(...rosterAgeSummary.map((bucket) => bucket.count), 1);
  const maxPickYearValue = Math.max(...pickYearSummary.map((entry) => entry.totalValue), 1);
  const maxPickRoundValue = Math.max(...pickRoundSummary.map((entry) => entry.averageValue), 1);

  useEffect(() => {
    const nextParams = new URLSearchParams();

    if (activeTab !== "overview") nextParams.set("tab", activeTab);
    if (rosterView !== "table") nextParams.set("rv", rosterView);
    if (marketView !== "targets") nextParams.set("mv", marketView);
    if (draftView !== "table") nextParams.set("dv", draftView);
    if (rosterQuery) nextParams.set("rq", rosterQuery);
    if (rosterPositionFilter !== "all") nextParams.set("rp", rosterPositionFilter);
    if (draftQuery) nextParams.set("dq", draftQuery);
    if (draftSeasonFilter !== "all") nextParams.set("ds", draftSeasonFilter);
    if (rosterSortKey !== "score") nextParams.set("rs", rosterSortKey);
    if (rosterSortDirection !== "desc") nextParams.set("rd", rosterSortDirection);
    if (pickSortKey !== "season") nextParams.set("ps", pickSortKey);
    if (pickSortDirection !== "asc") nextParams.set("pd", pickSortDirection);

    const nextQuery = nextParams.toString();
    const currentQuery = typeof window === "undefined" ? "" : window.location.search.slice(1);

    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [
    activeTab,
    draftQuery,
    draftSeasonFilter,
    draftView,
    marketView,
    pathname,
    pickSortDirection,
    pickSortKey,
    rosterPositionFilter,
    rosterQuery,
    rosterSortDirection,
    rosterSortKey,
    rosterView,
    router,
  ]);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <section className="relative z-20 overflow-visible rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)] backdrop-blur">
          <div className="px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-start gap-2">
                <DashboardNav activeTab={activeTab} onSelectTab={handleTabChange} />
                <SourceHoverLabel className="ml-auto" source={source} summary={sourceSummary} />
              </div>
              {activeTab === "overview" ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Rostered assets</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900">{snapshot.rosterScores.length}</p>
                    <p className="mt-2 text-sm text-slate-600">Current-team players loaded</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Team score</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900">{snapshot.team.overall}</p>
                    <p className="mt-2 text-sm text-slate-600">Overall valuation signal</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trade targets</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900">{snapshot.targets.length}</p>
                    <p className="mt-2 text-sm text-slate-600">Current best fits</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Owned picks</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900">{snapshot.picks.length}</p>
                    <p className="mt-2 text-sm text-slate-600">Across future draft years</p>
                  </div>
                </div>
              ) : null}
              {source.detail ? (
                <p className="max-w-2xl rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  {source.detail}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {activeTab === "overview" ? (
          <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-6">
              <section className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Team score</p>
                  <p className="mt-3 text-4xl font-semibold text-slate-900">{snapshot.team.overall}</p>
                  <p className="mt-2 text-sm text-slate-600">Strongest group: {snapshot.team.strongest.bucket}</p>
                </div>
                <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Urgent need</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-900">{snapshot.team.weakest.bucket}</p>
                  <p className="mt-2 text-sm text-slate-600">Depth score {snapshot.team.weakest.score}</p>
                </div>
                <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Prospect watch</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-900">{snapshot.team.prospectCount}</p>
                  <p className="mt-2 text-sm text-slate-600">Tracked prospects</p>
                </div>
              </section>
              <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Team fit snapshot</p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">What the roster needs next</h2>
                  </div>
                  <button
                    className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                    onClick={() => setActiveTab("market")}
                    type="button"
                  >
                    Open market tab
                  </button>
                </div>
                <div className="mt-5 space-y-3">
                  {snapshot.team.bucketScores.map((bucket) => (
                    <div key={bucket.bucket} className="rounded-3xl bg-white/75 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-semibold capitalize text-slate-900">{bucket.bucket}</p>
                        <p className="font-mono text-sm text-slate-600">score {bucket.score}</p>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${bucket.score}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Prospect signal</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Pipeline player to watch most closely</h2>
              <div className="mt-5 grid gap-4 rounded-[1.75rem] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(225,29,72,0.1))] p-5 shadow-[0_18px_40px_rgba(37,99,235,0.08)] sm:grid-cols-[0.8fr_1.2fr]">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent-strong)]">Highest upside</p>
                  {prospectWatch ? (
                    <div className="mt-3 flex items-center gap-4">
                      <PlayerHeadshot
                        alt={prospectWatch.name}
                        className="h-20 w-20 rounded-[1.25rem] object-cover"
                        fallbackClassName="grid h-20 w-20 place-items-center rounded-[1.25rem] bg-[linear-gradient(135deg,rgba(37,99,235,0.95),rgba(225,29,72,0.9))] text-2xl font-semibold text-white"
                        name={prospectWatch.name}
                      />
                      <h3 className="text-3xl font-semibold text-slate-900">
                        <PlayerLink className="underline-offset-4" playerId={prospectWatch.id}>{prospectWatch.name}</PlayerLink>
                      </h3>
                    </div>
                  ) : (
                    <h3 className="mt-3 text-3xl font-semibold text-slate-900">No prospect loaded</h3>
                  )}
                  <p className="mt-2 text-sm text-slate-700">
                    {prospectWatch?.role ?? "Needs prospect data."}
                  </p>
                  <p className="mt-5 font-mono text-sm text-slate-600">
                    {prospectWatch
                      ? `${prospectWatch.position} / age ${prospectWatch.age} / score ${prospectWatch.score}`
                      : "Prospect metrics load here."}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/70 bg-white/65 p-4 text-sm leading-6 text-slate-700 backdrop-blur">
                  <p>
                    {prospectWatch
                      ? `${prospectWatch.name} is carrying the strongest upside signal in the current pipeline.`
                      : "This panel highlights the top prospect."}
                  </p>
                </div>
              </div>
            </section>
          </section>
        ) : null}

        {activeTab === "roster" ? (
          <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Roster valuation</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                  <TeamLink className="underline-offset-4 hover:underline" team={snapshot.teamName}>
                    {snapshot.teamName}
                  </TeamLink>{" "}
                  assets by role and market value
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${rosterView === "table" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                  onClick={() => setRosterView("table")}
                  type="button"
                >
                  Table view
                </button>
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${rosterView === "cards" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                  onClick={() => setRosterView("cards")}
                  type="button"
                >
                  Card view
                </button>
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${rosterView === "chart" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                  onClick={() => setRosterView("chart")}
                  type="button"
                >
                  Chart view
                </button>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-end gap-3 rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4">
              <label className="min-w-[14rem] flex-1 text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Search roster</span>
                <input
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                  placeholder="Player or role"
                  type="search"
                  value={rosterQuery}
                  onChange={(event) => setRosterQuery(event.target.value)}
                />
              </label>
              <label className="w-full max-w-[12rem] text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Position</span>
                <select
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                  value={rosterPositionFilter}
                  onChange={(event) => setRosterPositionFilter(event.target.value)}
                >
                  <option value="all">All positions</option>
                  {rosterPositions.map((position) => (
                    <option key={position} value={position}>{position}</option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-slate-600">Showing {sortedRoster.length} of {snapshot.rosterScores.length} players</p>
            </div>
            {rosterView === "table" ? (
              <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-white/75 shadow-[0_18px_40px_rgba(37,99,235,0.08)]">
                <table className="min-w-full border-collapse text-left">
                  <thead className="bg-[linear-gradient(90deg,rgba(37,99,235,0.96),rgba(225,29,72,0.9))] text-sm uppercase tracking-[0.18em] text-white">
                    <tr>
                      {([
                        ["name", "Player"],
                        ["position", "Pos"],
                        ["age", "Age"],
                        ["capHit", "Cap hit"],
                        ["score", "Score"],
                      ] as const).map(([key, label]) => (
                        <th key={key} className="px-4 py-3 font-medium">
                          <button className="flex items-center gap-2" onClick={() => toggleRosterSort(key)} type="button">
                            <span>{label}</span>
                            <span className="text-[10px] text-white/70">
                              {renderSortLabel(rosterSortKey === key, rosterSortDirection)}
                            </span>
                          </button>
                        </th>
                      ))}
                      <th className="px-4 py-3 font-medium">Trade value</th>
                      <th className="px-4 py-3 font-medium">Extension</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRoster.map((player, index) => (
                      <tr key={player.id} className={`${index % 2 === 0 ? "bg-white/88" : "bg-[rgba(239,242,255,0.82)]"} border-t border-[var(--line)] transition hover:bg-[rgba(219,234,254,0.7)]`}>
                        <td className="px-4 py-4 align-top">
                          <div className="flex items-start gap-3">
                            <PlayerHeadshot
                              alt={player.name}
                              className="h-11 w-11 rounded-2xl object-cover"
                              fallbackClassName="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(37,99,235,0.95),rgba(225,29,72,0.82))] text-sm font-semibold text-white"
                              name={player.name}
                            />
                            <div>
                              <PlayerLink className="font-semibold text-slate-900 underline-offset-4" playerId={player.id}>{player.name}</PlayerLink>
                              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{player.role}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-slate-700">{player.position}</td>
                        <td className="px-4 py-4 align-top text-sm text-slate-700">{player.age}</td>
                        <td className="px-4 py-4 align-top text-sm text-slate-700">${player.capHit.toFixed(1)}M</td>
                        <td className="px-4 py-4 align-top">
                          <div className="flex items-center gap-3">
                            <div className="rounded-full bg-[rgba(37,99,235,0.1)] px-3 py-1 text-lg font-semibold text-[var(--accent)]">{player.score}</div>
                            <p className="text-sm text-slate-600">{player.market}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-sm leading-6 text-slate-700">{tradeRange(player.score)}</td>
                        <td className="px-4 py-4 align-top text-sm leading-6 text-slate-700">
                          <span className="font-semibold text-slate-900">{player.extension.label}</span>
                          <br />
                          {player.extension.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {rosterView === "cards" ? (
              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sortedRoster.map((player) => (
                  <article key={player.id} className="rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <PlayerHeadshot
                          alt={player.name}
                          className="h-14 w-14 rounded-[1.15rem] object-cover"
                          fallbackClassName="grid h-14 w-14 place-items-center rounded-[1.15rem] bg-[linear-gradient(135deg,rgba(15,118,110,0.95),rgba(180,83,9,0.82))] text-base font-semibold text-white"
                          name={player.name}
                        />
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">{player.name}</h3>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{player.position} / age {player.age}</p>
                        </div>
                      </div>
                      <p className="rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white">{player.score}</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{player.role}</p>
                    <p className="mt-3 text-sm text-slate-600">Cap hit ${player.capHit.toFixed(1)}M</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{player.extension.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{player.extension.detail}</p>
                    <div className="mt-4">
                      <Link className="text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline" href={`/players/${encodeURIComponent(player.id)}`}>Open full profile</Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            {rosterView === "chart" ? (
              <div className="mt-6 space-y-4 rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">Average score by position</p>
                    <div className="mt-4 space-y-3">
                      {rosterPositionSummary.map((bucket) => (
                        <div key={bucket.position}>
                          <div className="flex items-center justify-between text-sm text-slate-700">
                            <span>{bucket.position} <span className="text-slate-500">({bucket.count})</span></span>
                            <span>{bucket.averageScore}</span>
                          </div>
                          <div className="mt-2 h-3 rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-[var(--accent)]"
                              style={{ width: `${(bucket.averageScore / maxPositionAverage) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">Age bucket distribution</p>
                    <div className="mt-4 space-y-3">
                      {rosterAgeSummary.map((bucket) => (
                        <div key={bucket.bucket}>
                          <div className="flex items-center justify-between text-sm text-slate-700">
                            <span>{bucket.bucket}</span>
                            <span>{bucket.count}</span>
                          </div>
                          <div className="mt-2 h-3 rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-[var(--accent-strong)]"
                              style={{ width: `${(bucket.count / maxAgeBucketCount) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">Player score bars</p>
                  <div className="mt-4 space-y-3">
                    {sortedRoster.map((player) => (
                      <div key={player.id}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <PlayerHeadshot
                              alt={player.name}
                              className="h-10 w-10 rounded-xl object-cover"
                              fallbackClassName="grid h-10 w-10 place-items-center rounded-xl bg-[linear-gradient(135deg,rgba(15,118,110,0.95),rgba(180,83,9,0.82))] text-xs font-semibold text-white"
                              name={player.name}
                            />
                            <div>
                              <PlayerLink className="font-semibold text-slate-900 underline-offset-4" playerId={player.id}>{player.name}</PlayerLink>
                              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{player.position} / {player.role}</p>
                            </div>
                          </div>
                          <p className="text-lg font-semibold text-slate-900">{player.score}</p>
                        </div>
                        <div className="mt-3 h-3 rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-[var(--accent)]"
                            style={{ width: `${(player.score / maxRosterScore) * 100}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                          <span>{player.market}</span>
                          <span>${player.capHit.toFixed(1)}M</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "market" ? (
          <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Market view</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Switch between needs and targets</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${marketView === "targets" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                    onClick={() => setMarketView("targets")}
                    type="button"
                  >
                    Targets
                  </button>
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${marketView === "needs" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                    onClick={() => setMarketView("needs")}
                    type="button"
                  >
                    Needs map
                  </button>
                </div>
              </div>
              {marketView === "targets" ? (
                <div className="mt-5 space-y-3">
                  {snapshot.targets.map((player: TradeTarget) => (
                    <article key={player.id} className="rounded-3xl border border-[var(--line)] bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(225,29,72,0.06))] p-4 shadow-[0_18px_40px_rgba(37,99,235,0.08)]">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <PlayerHeadshot
                            alt={player.name}
                            className="h-14 w-14 rounded-[1.15rem] object-cover"
                            fallbackClassName="grid h-14 w-14 place-items-center rounded-[1.15rem] bg-[linear-gradient(135deg,rgba(37,99,235,0.95),rgba(225,29,72,0.9))] text-base font-semibold text-white"
                            name={player.name}
                          />
                          <div>
                            <PlayerLink className="text-lg font-semibold text-slate-900 underline-offset-4" playerId={player.id}>{player.name}</PlayerLink>
                            <p className="mt-1 text-sm text-slate-600">
                              <TeamLink className="underline-offset-4 hover:underline" team={player.team}>
                                {player.team}
                              </TeamLink>{" "}
                              / {player.position} / {player.role}
                            </p>
                          </div>
                        </div>
                        <p className="rounded-full bg-white/80 px-3 py-1 font-mono text-sm text-slate-700 shadow-[0_10px_20px_rgba(17,32,49,0.06)]">fit {player.fitScore}</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{tradeRange(player.score)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {snapshot.team.bucketScores.map((bucket) => (
                    <div key={bucket.bucket} className="rounded-3xl bg-white/75 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-semibold capitalize text-slate-900">{bucket.bucket}</p>
                        <p className="font-mono text-sm text-slate-600">score {bucket.score}</p>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${bucket.score}%` }} />
                      </div>
                      <p className="mt-3 text-sm text-slate-600">{bucket.count} current roster spots in this bucket.</p>
                    </div>
                  ))}
                </div>
              )}
            </article>
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Action framing</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">What this view means</h2>
              <div className="mt-5 space-y-4 text-sm leading-7 text-slate-700">
                <p>
                  Use the market tab when you want a decision surface instead of a raw list. The target view narrows to the best current calls; the needs map shows why those calls matter.
                </p>
                <p>
                  The current weakest band is <span className="font-semibold capitalize text-slate-900">{snapshot.team.weakest.bucket}</span>, while the strongest is <span className="font-semibold capitalize text-slate-900">{snapshot.team.strongest.bucket}</span>.
                </p>
                <p>
                  Click back to the roster tab if you want to sort by score, cap hit, or age before deciding what to move.
                </p>
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === "draft" ? (
          <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Draft capital</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Owned picks with live value</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${draftView === "table" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                    onClick={() => setDraftView("table")}
                    type="button"
                  >
                    Pick table
                  </button>
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${draftView === "chart" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                    onClick={() => setDraftView("chart")}
                    type="button"
                  >
                    Chart view
                  </button>
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${draftView === "editor" ? "bg-slate-900 text-white" : "border border-[var(--line)] bg-white text-slate-700"}`}
                    onClick={() => setDraftView("editor")}
                    type="button"
                  >
                    Order editor
                  </button>
                </div>
              </div>
                <div className="mt-6 flex flex-wrap items-end gap-3 rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4">
                  <label className="min-w-[14rem] flex-1 text-sm text-slate-700">
                    <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Search picks</span>
                    <input
                      className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                      placeholder="Team, year, or round"
                      type="search"
                      value={draftQuery}
                      onChange={(event) => setDraftQuery(event.target.value)}
                    />
                  </label>
                  <label className="w-full max-w-[12rem] text-sm text-slate-700">
                    <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Season</span>
                    <select
                      className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                      value={draftSeasonFilter}
                      onChange={(event) => setDraftSeasonFilter(event.target.value)}
                    >
                      <option value="all">All years</option>
                      {draftSeasons.map((season) => (
                        <option key={season} value={String(season)}>{season}</option>
                      ))}
                    </select>
                  </label>
                  <p className="text-sm text-slate-600">Showing {sortedPicks.length} of {snapshot.picks.length} owned picks</p>
                </div>
                {draftView === "table" ? (
                <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-white/75 shadow-[0_18px_40px_rgba(37,99,235,0.08)]">
                  <table className="min-w-full border-collapse text-left">
                    <thead className="bg-[linear-gradient(90deg,rgba(37,99,235,0.96),rgba(225,29,72,0.9))] text-sm uppercase tracking-[0.18em] text-white">
                      <tr>
                        {([
                          ["team", "Team"],
                          ["season", "Year"],
                          ["round", "Round"],
                          ["projectedSlot", "Slot"],
                          ["score", "Value"],
                        ] as const).map(([key, label]) => (
                          <th key={key} className="px-4 py-3 font-medium">
                            <button className="flex items-center gap-2" onClick={() => togglePickSort(key)} type="button">
                              <span>{label}</span>
                              <span className="text-[10px] text-white/70">
                                {renderSortLabel(pickSortKey === key, pickSortDirection)}
                              </span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPicks.map((pick, index) => (
                        <tr key={pick.id} className={`${index % 2 === 0 ? "bg-white/88" : "bg-[rgba(239,242,255,0.82)]"} border-t border-[var(--line)] transition hover:bg-[rgba(219,234,254,0.7)]`}>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                            <TeamLink className="underline-offset-4 hover:underline" team={pick.team}>
                              {pick.team}
                            </TeamLink>
                            {hasTradedDraftPick(pick) ? <span className="text-slate-600"> ({getDraftPickIssuerTeam(pick)})</span> : null}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-700">{pick.season}</td>
                          <td className="px-4 py-4 text-sm text-slate-700">{pick.round}</td>
                          <td className="px-4 py-4 text-sm text-slate-700">{pick.projectedSlot}</td>
                          <td className="px-4 py-4 text-slate-900"><span className="rounded-full bg-[rgba(225,29,72,0.1)] px-3 py-1 text-lg font-semibold text-[var(--accent-strong)]">{pick.score}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {draftView === "chart" ? (
                <div className="mt-6 space-y-4 rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">Total pick value by year</p>
                      <div className="mt-4 space-y-3">
                        {pickYearSummary.map((entry) => (
                          <div key={entry.season}>
                            <div className="flex items-center justify-between text-sm text-slate-700">
                              <span>{entry.season} <span className="text-slate-500">({entry.pickCount})</span></span>
                              <span>{entry.totalValue}</span>
                            </div>
                            <div className="mt-2 h-3 rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-[var(--accent)]"
                                style={{ width: `${(entry.totalValue / maxPickYearValue) * 100}%` }}
                              />
                            </div>
                            <p className="mt-1 text-xs text-slate-500">Average slot {entry.averageSlot}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">Average value by round</p>
                      <div className="mt-4 space-y-3">
                        {pickRoundSummary.map((entry) => (
                          <div key={entry.round}>
                            <div className="flex items-center justify-between text-sm text-slate-700">
                              <span>Round {entry.round} <span className="text-slate-500">({entry.count})</span></span>
                              <span>{entry.averageValue}</span>
                            </div>
                            <div className="mt-2 h-3 rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-[var(--accent-strong)]"
                                style={{ width: `${(entry.averageValue / maxPickRoundValue) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">Owned pick value bars</p>
                    <div className="mt-4 space-y-3">
                      {sortedPicks.map((pick) => (
                        <div key={pick.id}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-900">
                                {pick.season}{" "}
                                <TeamLink className="underline-offset-4 hover:underline" team={pick.team}>
                                  {pick.team}
                                </TeamLink>
                                {hasTradedDraftPick(pick) ? (
                                  <>
                                    {" "}(
                                    <TeamLink className="underline-offset-4 hover:underline" team={getDraftPickIssuerTeam(pick)}>
                                      {getDraftPickIssuerTeam(pick)}
                                    </TeamLink>
                                    )
                                  </>
                                ) : null}{" "}
                                round {pick.round}
                              </p>
                              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Projected slot {pick.projectedSlot}</p>
                            </div>
                            <p className="text-lg font-semibold text-slate-900">{pick.score}</p>
                          </div>
                          <div className="mt-3 h-3 rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-[var(--accent-strong)]"
                              style={{ width: `${(pick.score / maxPickScore) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              {draftView === "editor" ? (
                <div className="mt-6">
                  <DraftPickOrderEditor draftOrders={draftOrders} picks={snapshot.picks as DraftPick[]} teamName={snapshot.teamName} />
                </div>
              ) : null}
            </article>
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Interpretation</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">How the draft view reacts</h2>
              <div className="mt-5 space-y-4 text-sm leading-7 text-slate-700">
                <p>
                  The pick table is sortable by team, year, round, projected slot, and current value. Switch to the order editor when you want to change league order and immediately inspect how owned pick values move.
                </p>
                <p>
                  Future-year slots default from the same team&apos;s current-year slot until you override them, so the board stays usable without full manual entry.
                </p>
                <p>
                  This matters most when you hold another team&apos;s pick. A 2027 second from San Jose now follows San Jose&apos;s 2027 projected finish instead of your own team record.
                </p>
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === "players" ? <PlayerDirectoryPanel players={players} teams={teams} /> : null}

        {isTabPending && pendingTab === "players" ? (
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[rgba(243,244,248,0.74)] backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-white/92 px-5 py-3 text-sm font-semibold text-slate-700 shadow-[0_18px_40px_rgba(17,32,49,0.12)]">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[var(--accent)]" />
              Loading player directory
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}