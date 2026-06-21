"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PlayerHeadshot } from "@/app/player-headshot";
import { StandalonePageHeader } from "@/app/standalone-page-header";
import type { SourceHoverSummary } from "@/app/source-hover-label";
import { TradeHistoryList } from "@/app/trade-history-list";
import type { DashboardSourceInfo, RealSeasonHistoryEntry, RealSeasonStatsLine } from "@/lib/domain";
import { TeamLink } from "@/app/team-link";
import type { DirectoryPlayer } from "@/lib/player-directory";
import type { TradeRecord } from "@/lib/trade-history";

type PlayerProfileShellProps = {
  player: DirectoryPlayer;
  source: DashboardSourceInfo;
  sourceSummary: SourceHoverSummary;
  trades: TradeRecord[];
};

type DisplaySeasonHistoryEntry = RealSeasonHistoryEntry & {
  isCurrentSeasonPlaceholder?: boolean;
};

type ProfileTab = "overview" | "breakdown" | "real-world" | "trades";

type RefreshState = {
  tone: "neutral" | "success" | "error";
  message: string;
} | null;

const PHO_PLAYER_ID_PREFIX = "pho-";

const refreshStateToneClassName: Record<NonNullable<RefreshState>["tone"], string> = {
  neutral: "border-[var(--line)] bg-white/85 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
};

const metricBars = (player: DirectoryPlayer) => [
  { label: "Performance", value: player.performance, tone: "var(--accent)" },
  { label: "Play driving", value: player.playDriving, tone: "#0f766e" },
  { label: "Defense", value: player.defense, tone: "#1d4ed8" },
  { label: "Special teams", value: player.specialTeams, tone: "#b45309" },
  { label: "Chemistry", value: player.chemistryFit, tone: "#9333ea" },
  { label: "Upside", value: player.adjustedUpside, tone: "#e11d48" },
];

const ringStyle = (value: number, tone = "var(--accent)") => ({
  background: `conic-gradient(${tone} ${value}%, rgba(15,118,110,0.12) ${value}% 100%)`,
});

const formatSimulationStatLabel = (key: string) =>
  key
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const formatSeasonId = (seasonId: number) => {
  const season = String(seasonId);

  if (season.length !== 8) {
    return season;
  }

  return `${season.slice(0, 4)}-${season.slice(-2)}`;
};

const getCurrentNhlSeasonId = (now: Date = new Date()) => {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 6 ? year : year - 1;
  return startYear * 10000 + (startYear + 1);
};

const formatSignedStat = (value: number | undefined) => {
  if (value === undefined) {
    return "--";
  }

  return value > 0 ? `+${value}` : String(value);
};

const formatPercentStat = (value: number | undefined, multiplier = 100, digits = 1) => {
  if (value === undefined) {
    return "--";
  }

  return `${(value * multiplier).toFixed(digits)}%`;
};

const formatDecimalStat = (value: number | undefined, digits = 2) => {
  if (value === undefined) {
    return "--";
  }

  return value.toFixed(digits);
};

const buildFallbackSeasonHistory = (player: DirectoryPlayer): RealSeasonHistoryEntry[] => {
  if (!player.realSeasonStats) {
    return [];
  }

  const summary: RealSeasonStatsLine = {
    gamesPlayed: player.realSeasonStats.gamesPlayed,
    pim: player.realSeasonStats.pim,
    goals: player.realSeasonStats.goals,
    assists: player.realSeasonStats.assists,
    points: player.realSeasonStats.points,
    plusMinus: player.realSeasonStats.plusMinus,
    powerPlayPoints: player.realSeasonStats.powerPlayPoints,
    shots: player.realSeasonStats.shots,
    shootingPctg: player.realSeasonStats.shootingPctg,
    wins: player.realSeasonStats.wins,
    savePctg: player.realSeasonStats.savePctg,
    goalsAgainstAvg: player.realSeasonStats.goalsAgainstAvg,
    shutouts: player.realSeasonStats.shutouts,
  };

  return [
    {
      seasonId: player.realSeasonStats.seasonId,
      teamName: player.team,
      leagueAbbrev: "NHL",
      regularSeason: summary,
    },
  ];
};

const buildDisplayedSeasonHistory = (player: DirectoryPlayer): DisplaySeasonHistoryEntry[] => {
  if (!player.realSeasonStats) {
    return [];
  }

  const currentSeasonId = getCurrentNhlSeasonId();
  const baseHistory = player.realSeasonStats.seasonHistory?.length
    ? player.realSeasonStats.seasonHistory
    : buildFallbackSeasonHistory(player);

  if (baseHistory.some((season) => season.seasonId === currentSeasonId)) {
    return baseHistory;
  }

  return [
    {
      seasonId: currentSeasonId,
      teamName: "",
      leagueAbbrev: "",
      isCurrentSeasonPlaceholder: true,
    },
    ...baseHistory,
  ];
};

function PlayerNhlStatsRefreshButton({ playerId, playerName }: { playerId: string; playerName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshState, setRefreshState] = useState<RefreshState>(null);

  const handleRefresh = () => {
    startTransition(async () => {
      setRefreshState({ tone: "neutral", message: `Refreshing NHL stats for ${playerName}...` });

      try {
        const response = await fetch(`/api/import/nhl/player-stats?playerId=${encodeURIComponent(playerId)}&force=true`, {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          refreshedPlayerCount?: number;
        };

        if (!response.ok || payload.ok === false) {
          setRefreshState({
            tone: "error",
            message: payload.error ?? `NHL stats refresh failed for ${playerName}.`,
          });
          return;
        }

        setRefreshState({
          tone: "success",
          message: `NHL stats refreshed for ${playerName}. Updated ${payload.refreshedPlayerCount ?? 0} player.`,
        });
        router.refresh();
      } catch (error) {
        setRefreshState({
          tone: "error",
          message: error instanceof Error ? error.message : `NHL stats refresh failed for ${playerName}.`,
        });
      }
    });
  };

  return (
    <div className="ml-auto flex flex-col items-end gap-3">
      <button
        className="inline-flex min-w-[13rem] items-center justify-center rounded-full border border-[var(--line)] bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        onClick={handleRefresh}
        type="button"
      >
        {isPending ? "Refreshing..." : "Refresh this player's NHL stats"}
      </button>
      {refreshState ? (
        <p
          className={`max-w-md rounded-[1.25rem] border px-4 py-3 text-sm leading-6 ${refreshStateToneClassName[refreshState.tone]}`}
        >
          {refreshState.message}
        </p>
      ) : null}
    </div>
  );
}

const formatCellStat = (value: number | undefined) => (value === undefined ? "--" : String(value));

const getPhoPlayerUrl = (playerId: string) => {
  if (!playerId.startsWith(PHO_PLAYER_ID_PREFIX)) {
    return null;
  }

  const numericId = Number(playerId.slice(PHO_PLAYER_ID_PREFIX.length));

  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  return `https://app.playhockeyonline.com/players/${numericId}`;
};

export function PlayerProfileShell({ player, source, sourceSummary, trades }: PlayerProfileShellProps) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [isHeaderTeamLinkActive, setIsHeaderTeamLinkActive] = useState(false);
  const [isCardTeamLinkActive, setIsCardTeamLinkActive] = useState(false);
  const phoPlayerUrl = getPhoPlayerUrl(player.id);
  const profileTabs: Array<{ id: ProfileTab; label: string; detail: string }> = [
    { id: "overview", label: "Overview", detail: "Top-line profile" },
    { id: "breakdown", label: "Breakdown", detail: "Model components" },
    { id: "real-world", label: "Real-world", detail: "Current NHL season" },
    { id: "trades", label: `Trades (${trades.length})`, detail: "Past deal history" },
  ];

  const breakdownMetrics = metricBars(player);
  const simulationStats = useMemo(
    () => [...(player.simulationStats ?? [])].sort((left, right) => right.value - left.value || left.key.localeCompare(right.key)),
    [player.simulationStats],
  );
  const simulationOverall = simulationStats.find((stat) => stat.key === "overall")?.value;
  const simulationBreakdownStats = useMemo(
    () => simulationStats.filter((stat) => stat.key !== "overall"),
    [simulationStats],
  );
  const spotlightMetrics = useMemo(
    () => [
      {
        label: "Sim overall",
        displayLabel: "Sim\noverall",
        value: simulationOverall ?? 0,
        displayValue: simulationOverall ?? "--",
        tone: "var(--accent)",
        detail: "Raw sim rating",
      },
      { label: "Value score", value: player.score, tone: "#0f766e", detail: player.market },
      {
        label: "Upside",
        value: player.adjustedUpside,
        tone: "#e11d48",
        detail:
          player.realUpsideProfile?.adjustment
            ? `Long-term projection (${formatSignedStat(player.realUpsideProfile.adjustment)} IRL)`
            : "Long-term projection",
      },
      { label: "Defense", value: player.defense, tone: "#1d4ed8", detail: "Two-way stability" },
    ],
    [player.adjustedUpside, player.defense, player.market, player.realUpsideProfile, player.score, simulationOverall],
  );
  const realSeasonStats = player.realSeasonStats;
  const isGoalieStats = player.position === "G";
  const displayedSeasonHistory = buildDisplayedSeasonHistory(player);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <StandalonePageHeader activeTab="players" source={source} sourceSummary={sourceSummary} />
        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_32%),radial-gradient(circle_at_top_right,rgba(225,29,72,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(17,32,49,0.08),transparent_36%)]" />
          <div className="relative grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-8">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-3">
                <Link
                  className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white hover:text-slate-900"
                  href="/?tab=players"
                >
                  Back to player tab
                </Link>
                {phoPlayerUrl ? (
                  <a
                    className="inline-flex items-center rounded-full border border-[color:rgba(37,99,235,0.2)] bg-[rgba(37,99,235,0.08)] px-4 py-2 text-sm font-semibold text-[var(--accent-strong)] transition hover:bg-[rgba(37,99,235,0.14)]"
                    href={phoPlayerUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View on PHO
                  </a>
                ) : null}
              </div>
              <div className="flex items-start gap-5">
                <PlayerHeadshot
                  alt={player.name}
                  className="h-28 w-28 shrink-0 rounded-[2rem] object-cover shadow-[0_26px_40px_rgba(15,118,110,0.24)]"
                  fallbackClassName="grid h-28 w-28 shrink-0 place-items-center rounded-[2rem] bg-[linear-gradient(135deg,rgba(37,99,235,0.95),rgba(225,29,72,0.92))] text-3xl font-semibold text-white shadow-[0_26px_40px_rgba(37,99,235,0.24)]"
                  name={player.name}
                />
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    <TeamLink
                      className="inline-flex cursor-pointer rounded-lg px-2 py-1 -mx-2 -my-1 font-semibold text-slate-900 transition"
                      onBlur={() => setIsHeaderTeamLinkActive(false)}
                      onFocus={() => setIsHeaderTeamLinkActive(true)}
                      onMouseEnter={() => setIsHeaderTeamLinkActive(true)}
                      onMouseLeave={() => setIsHeaderTeamLinkActive(false)}
                      style={
                        isHeaderTeamLinkActive
                          ? {
                              backgroundColor: "rgba(37, 99, 235, 0.12)",
                              color: "var(--accent)",
                              textDecorationLine: "underline",
                              textDecorationThickness: "2px",
                              textUnderlineOffset: "4px",
                            }
                          : undefined
                      }
                      team={player.team}
                    >
                      {player.team}
                    </TeamLink>{" "}
                    / {player.position}
                  </p>
                  <h1 className="mt-3 text-5xl font-semibold tracking-[-0.05em] text-slate-900 sm:text-6xl">{player.name}</h1>
                  <p className="mt-4 max-w-xl text-sm leading-6 text-slate-700 sm:text-base">
                    {player.role}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-3 backdrop-blur">
                {profileTabs.map((tab) => {
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      className={`cursor-pointer rounded-2xl px-4 py-3 text-left transition ${isActive ? "bg-slate-900 text-slate-50" : "bg-transparent text-slate-700 hover:bg-white"}`}
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
            <aside className="rounded-[1.75rem] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(225,29,72,0.1))] p-5 shadow-[0_24px_60px_rgba(37,99,235,0.1)]">
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--accent-strong)]">Headline metrics</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {spotlightMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-[1.5rem] border border-white/70 bg-white/72 p-4 backdrop-blur">
                    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full p-[7px]" style={ringStyle(metric.value, metric.tone)}>
                      <div className="grid h-full w-full place-items-center rounded-full bg-white text-center">
                        <div>
                          <p className="text-2xl font-semibold text-slate-900">{metric.displayValue ?? metric.value}</p>
                          <p className="whitespace-pre-line text-[10px] uppercase leading-tight tracking-[0.18em] text-slate-500">
                            {metric.displayLabel ?? metric.label}
                          </p>
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-center text-sm text-slate-700">{metric.detail}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/70 bg-white/72 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cap hit</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">${player.capHit.toFixed(1)}M</p>
                </div>
                <div className="rounded-3xl border border-white/70 bg-white/72 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Years left</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{player.yearsRemaining}</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {activeTab === "overview" ? (
          <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Profile card</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Identity, usage, and market context</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Team</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    <TeamLink
                      className="inline-flex cursor-pointer rounded-lg px-2 py-1 -mx-2 -my-1 font-semibold text-slate-900 transition"
                      onBlur={() => setIsCardTeamLinkActive(false)}
                      onFocus={() => setIsCardTeamLinkActive(true)}
                      onMouseEnter={() => setIsCardTeamLinkActive(true)}
                      onMouseLeave={() => setIsCardTeamLinkActive(false)}
                      style={
                        isCardTeamLinkActive
                          ? {
                              backgroundColor: "rgba(37, 99, 235, 0.12)",
                              color: "var(--accent)",
                              textDecorationLine: "underline",
                              textDecorationThickness: "2px",
                              textUnderlineOffset: "4px",
                            }
                          : undefined
                      }
                      team={player.team}
                    >
                      {player.team}
                    </TeamLink>
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Contract status</p>
                  <p className="mt-2 text-lg font-semibold capitalize text-slate-900">{player.contractStatus}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Role</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{player.role}</p>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Age / position</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{player.age} / {player.position}</p>
                </div>
              </div>
              <div className="mt-5 rounded-[1.5rem] bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(180,83,9,0.12))] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trade framing</p>
                <p className="mt-3 text-xl font-semibold text-slate-900">{player.tradeRange}</p>
                <p className="mt-3 text-sm leading-7 text-slate-700">This richer panel is meant to feel more like a front-office readout than a plain stats list, with one clear headline on how the market should think about the player.</p>
              </div>
            </article>
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Score signal</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Model pillars with stronger visual rhythm</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {breakdownMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-semibold text-slate-900">{metric.label}</p>
                      <p className="font-mono text-sm text-slate-600">{metric.value}</p>
                    </div>
                    <div className="mt-4 h-3 rounded-full bg-slate-200">
                      <div className="h-full rounded-full" style={{ width: `${metric.value}%`, backgroundColor: metric.tone }} />
                    </div>
                    <p className="mt-3 text-sm text-slate-600">
                      {metric.value >= 75
                        ? "A clear positive driver in the current model."
                        : metric.value >= 60
                          ? "Solid support signal with room to improve."
                          : "Currently a weaker part of the profile."}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === "breakdown" ? (
          <section className="grid gap-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
              <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Simulation stats</p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">Raw ratings from the sim API</h2>
                  </div>
                  {simulationOverall !== undefined ? (
                    <div className="ml-auto grid h-20 w-20 shrink-0 place-items-center rounded-[1.25rem] border border-[color:rgba(37,99,235,0.18)] bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(15,23,42,0.02))] p-2 text-center">
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Overall</p>
                        <p className="mt-1 text-2xl font-semibold text-slate-900">{simulationOverall}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
                {simulationBreakdownStats.length === 0 ? (
                  <p className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 text-sm leading-7 text-slate-700">
                    No simulation stats are available for this player in the current data source.
                  </p>
                ) : (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {simulationBreakdownStats.map((stat) => (
                      <div key={stat.key} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{formatSimulationStatLabel(stat.key)}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">{stat.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
              <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Snapshot stats</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Current normalized inputs</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {breakdownMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{metric.label}</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-900">{metric.value}</p>
                        </div>
                        <div className="h-10 w-10 rounded-full" style={ringStyle(metric.value, metric.tone)} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>
        ) : null}

        {activeTab === "real-world" ? (
          <section className="grid gap-6">
            <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                {source.resolvedMode === "live-file" ? (
                  <PlayerNhlStatsRefreshButton playerId={player.id} playerName={player.name} />
                ) : null}
              </div>

              {!realSeasonStats ? (
                <p className="mt-5 rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 text-sm leading-7 text-slate-700">
                  No NHL real-world stats are cached for this player yet. Background refreshes only cover your current roster, so use the button above to fetch this player on demand.
                </p>
              ) : (
                <>
                  <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-white/80">
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse text-left">
                        <thead className="bg-slate-900 text-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]" rowSpan={2}>Season</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]" rowSpan={2}>Team</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]" rowSpan={2}>Lge</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-center" colSpan={isGoalieStats ? 5 : 6}>Regular Season</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-center" colSpan={isGoalieStats ? 5 : 5}>Playoffs</th>
                            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]" rowSpan={2}>Signal</th>
                          </tr>
                          <tr>
                            {isGoalieStats ? (
                              <>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">GP</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">W</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">SV%</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">GAA</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">SO</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">GP</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">W</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">SV%</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">GAA</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">SO</th>
                              </>
                            ) : (
                              <>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">GP</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">G</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">A</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Pts</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">PIM</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">+/-</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">GP</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">G</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">A</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">Pts</th>
                                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em]">PIM</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {displayedSeasonHistory.map((season, index) => {
                            const regularSeason = season.regularSeason;
                            const playoffs = season.playoffs;
                            const isPlaceholder = season.isCurrentSeasonPlaceholder === true;
                            const seasonSignal =
                              season.seasonId === realSeasonStats.seasonId && !isPlaceholder
                                ? realSeasonStats.valueSignal
                                : "";

                            return (
                              <tr
                                key={`${season.seasonId}:${season.teamName}:${season.leagueAbbrev}`}
                                className={`border-t border-[var(--line)] text-slate-800 ${index === 0 ? "bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(15,23,42,0.02))]" : "bg-white/60"}`}
                              >
                                <td className="px-4 py-4 text-sm font-semibold">{formatSeasonId(season.seasonId)}</td>
                                <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : season.teamName}</td>
                                <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : season.leagueAbbrev}</td>
                                {isGoalieStats ? (
                                  <>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.gamesPlayed)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.wins)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatPercentStat(regularSeason?.savePctg, 100, 1)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatDecimalStat(regularSeason?.goalsAgainstAvg, 2)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.shutouts)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.gamesPlayed)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.wins)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatPercentStat(playoffs?.savePctg, 100, 1)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatDecimalStat(playoffs?.goalsAgainstAvg, 2)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.shutouts)}</td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.gamesPlayed)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.goals)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.assists)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.points)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(regularSeason?.pim)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatSignedStat(regularSeason?.plusMinus)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.gamesPlayed)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.goals)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.assists)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.points)}</td>
                                    <td className="px-4 py-4 text-sm font-medium">{isPlaceholder ? "" : formatCellStat(playoffs?.pim)}</td>
                                  </>
                                )}
                                <td className="px-4 py-4 text-sm font-semibold text-[var(--accent-strong)]">{seasonSignal}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                    <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-5">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Refresh metadata</p>
                      <dl className="mt-4 space-y-3 text-sm text-slate-700">
                        <div className="flex items-center justify-between gap-4">
                          <dt>Source</dt>
                          <dd className="font-semibold uppercase text-slate-900">NHL API</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt>NHL player ID</dt>
                          <dd className="font-semibold text-slate-900">{realSeasonStats.nhlPlayerId}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt>Last refreshed</dt>
                          <dd className="font-semibold text-slate-900">{new Date(realSeasonStats.refreshedAt).toLocaleString()}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-5">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">How it is used</p>
                      <p className="mt-4 text-sm leading-7 text-slate-700">
                        The live NHL season numbers are converted into a separate value signal, then blended into the base model with a limited weight that ramps up as the player builds a larger game sample. That keeps the rating responsive without letting short-term variance overpower the simulation profile.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </article>
          </section>
        ) : null}

        {activeTab === "trades" ? (
          <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trade history</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Past deals involving {player.name}</h2>
            <div className="mt-5">
              <TradeHistoryList
                emptyMessage="No approved PHO trades involving this player were found in the current trade cache."
                highlightPlayerId={player.id}
                trades={trades}
              />
            </div>
          </section>
        ) : null}

      </main>
    </div>
  );
}
