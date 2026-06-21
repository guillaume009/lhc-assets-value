import { revalidatePath, revalidateTag } from "next/cache";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DashboardInput,
  DraftOrder,
  DashboardSourceInfo,
  DashboardSourceMode,
  DraftPick,
  NormalizedDashboardInput,
  Player,
  Position,
  RealSeasonHistoryEntry,
  RealSeasonStatsLine,
  RealSeasonStats,
  ResolvedDashboardInput,
  SimulationStat,
  TeamFinances,
} from "@/lib/domain";
import {
  applyDraftOrdersToPicks,
  buildNormalizedDraftOrders,
  getDraftPickOrderKey,
  type DraftPickOrderUpdate,
} from "@/lib/draft-pick-order";
import { getNhlPlayerStatsCachePath, maybeAutoRefreshPlayerRealSeasonStats } from "@/lib/nhl-player-stats";
import { hydratePhoPlayerContracts, hydratePhoPlayerSimulationStats } from "@/lib/playhockeyonline";
import { demoDashboardInput } from "@/lib/sample-data";
import { loadTradeHistory } from "@/lib/trade-history";
import { getDashboardSnapshot, type DashboardSnapshot } from "@/lib/valuation";

const DEFAULT_LIVE_DATA_PATH = path.join(process.cwd(), "data", "live-dashboard.json");

const validPositions: Position[] = ["C", "LW", "RW", "LD", "RD", "G"];
const validContractStatuses = ["signed", "rfa", "ufa", "prospect"];
const LIVE_DASHBOARD_CACHE_TTL_MS = 300_000;
const RESOLVED_INPUT_CACHE_TTL_MS = 300_000;
const SLOW_DASHBOARD_READ_THRESHOLD_MS = 1_000;
const SLOW_DASHBOARD_RESOLVE_THRESHOLD_MS = 1_000;

let liveDashboardInputCache:
  | {
      filePath: string;
      input: NormalizedDashboardInput;
      mtimeMs: number;
      size: number;
      expiresAt: number;
    }
  | null = null;

let resolvedDashboardInputCache:
  | {
      filePath: string;
      mtimeMs: number;
      size: number;
      statsMtimeMs: number;
      expiresAt: number;
      resolved: ResolvedDashboardInput;
    }
  | null = null;

let pendingResolvedDashboardInput: Promise<ResolvedDashboardInput> | null = null;

export type LiveDashboardCacheStatus = {
  filePath: string;
  ttlMs: number;
  cachedAt: string | null;
  expiresAt: string | null;
  remainingMs: number | null;
  mtimeMs: number | null;
  size: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const logDashboardActivity = (event: string, details: Record<string, unknown>) => {
  console.info(`[dashboard-data] ${event}`, details);
};

const logDashboardFailure = (event: string, error: unknown, details: Record<string, unknown>) => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[dashboard-data] ${event}`, {
    ...details,
    error: message,
  });
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isSimulationStat = (value: unknown): value is SimulationStat =>
  isRecord(value) && typeof value.key === "string" && isNumber(value.value);

const isRealSeasonStatsLine = (value: unknown): value is RealSeasonStatsLine => {
  if (!isRecord(value) || typeof value.gamesPlayed !== "number") {
    return false;
  }

  return (
    (value.pim === undefined || typeof value.pim === "number") &&
    (value.goals === undefined || typeof value.goals === "number") &&
    (value.assists === undefined || typeof value.assists === "number") &&
    (value.points === undefined || typeof value.points === "number") &&
    (value.plusMinus === undefined || typeof value.plusMinus === "number") &&
    (value.powerPlayPoints === undefined || typeof value.powerPlayPoints === "number") &&
    (value.shots === undefined || typeof value.shots === "number") &&
    (value.shootingPctg === undefined || typeof value.shootingPctg === "number") &&
    (value.wins === undefined || typeof value.wins === "number") &&
    (value.savePctg === undefined || typeof value.savePctg === "number") &&
    (value.goalsAgainstAvg === undefined || typeof value.goalsAgainstAvg === "number") &&
    (value.shutouts === undefined || typeof value.shutouts === "number")
  );
};

const isRealSeasonHistoryEntry = (value: unknown): value is RealSeasonHistoryEntry => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.seasonId === "number" &&
    typeof value.teamName === "string" &&
    typeof value.leagueAbbrev === "string" &&
    (value.regularSeason === undefined || isRealSeasonStatsLine(value.regularSeason)) &&
    (value.playoffs === undefined || isRealSeasonStatsLine(value.playoffs))
  );
};

const isRealSeasonStats = (value: unknown): value is RealSeasonStats => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.source === "nhl" &&
    typeof value.refreshedAt === "string" &&
    typeof value.seasonId === "number" &&
    typeof value.gamesPlayed === "number" &&
    typeof value.valueSignal === "number" &&
    typeof value.nhlPlayerId === "number" &&
    (value.goals === undefined || typeof value.goals === "number") &&
    (value.assists === undefined || typeof value.assists === "number") &&
    (value.points === undefined || typeof value.points === "number") &&
    (value.plusMinus === undefined || typeof value.plusMinus === "number") &&
    (value.powerPlayPoints === undefined || typeof value.powerPlayPoints === "number") &&
    (value.shots === undefined || typeof value.shots === "number") &&
    (value.shootingPctg === undefined || typeof value.shootingPctg === "number") &&
    (value.wins === undefined || typeof value.wins === "number") &&
    (value.savePctg === undefined || typeof value.savePctg === "number") &&
    (value.goalsAgainstAvg === undefined || typeof value.goalsAgainstAvg === "number") &&
    (value.shutouts === undefined || typeof value.shutouts === "number") &&
    (value.seasonHistory === undefined ||
      (Array.isArray(value.seasonHistory) && value.seasonHistory.every(isRealSeasonHistoryEntry)))
  );
};

const isPlayer = (value: unknown): value is Player => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.team === "string" &&
    typeof value.role === "string" &&
    typeof value.position === "string" &&
    validPositions.includes(value.position as Position) &&
    isNumber(value.age) &&
    isNumber(value.capHit) &&
    isNumber(value.yearsRemaining) &&
    typeof value.contractStatus === "string" &&
    validContractStatuses.includes(value.contractStatus) &&
    (value.inMinors === undefined || typeof value.inMinors === "boolean") &&
    isNumber(value.performance) &&
    isNumber(value.playDriving) &&
    isNumber(value.defense) &&
    isNumber(value.specialTeams) &&
    isNumber(value.chemistryFit) &&
    isNumber(value.upside) &&
    (value.simulationStats === undefined ||
      (Array.isArray(value.simulationStats) && value.simulationStats.every(isSimulationStat))) &&
    (value.realSeasonStats === undefined || isRealSeasonStats(value.realSeasonStats))
  );
};

const isDraftPick = (value: unknown): value is DraftPick => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.team === "string" &&
    (value.issuerTeam === undefined || typeof value.issuerTeam === "string") &&
    isNumber(value.season) &&
    isNumber(value.round) &&
    isNumber(value.projectedSlot)
  );
};

const normalizeDraftPick = (pick: DraftPick): DraftPick => ({
  ...pick,
  issuerTeam: pick.issuerTeam?.trim() || pick.team,
});

const isDraftOrder = (value: unknown): value is DraftOrder => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.team === "string" &&
    isNumber(value.season) &&
    isNumber(value.projectedSlot)
  );
};

const isTeamFinances = (value: unknown): value is TeamFinances => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.contractPenalties === undefined || isNumber(value.contractPenalties)) &&
    (value.injuredRelief === undefined || isNumber(value.injuredRelief))
  );
};

const isDashboardInput = (value: unknown): value is DashboardInput => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.teamName === "string" &&
    Array.isArray(value.roster) &&
    value.roster.every(isPlayer) &&
    Array.isArray(value.leagueTargets) &&
    value.leagueTargets.every(isPlayer) &&
    Array.isArray(value.draftPicks) &&
    value.draftPicks.every(isDraftPick) &&
    (value.draftOrders === undefined ||
      (Array.isArray(value.draftOrders) && value.draftOrders.every(isDraftOrder))) &&
    (value.finances === undefined || isTeamFinances(value.finances))
  );
};

const parseSourceMode = (value: string | undefined): DashboardSourceMode =>
  value === "live-file" ? "live-file" : "demo";

export const getConfiguredSourceMode = (): DashboardSourceMode =>
  parseSourceMode(process.env.NHL_SIM_DATA_SOURCE);

export const getConfiguredLiveFilePath = () =>
  process.env.NHL_SIM_LIVE_DATA_PATH?.trim() || DEFAULT_LIVE_DATA_PATH;

export const getLiveDashboardCacheStatus = (): LiveDashboardCacheStatus => {
  const cachedInput = liveDashboardInputCache;

  if (!cachedInput) {
    return {
      filePath: getConfiguredLiveFilePath(),
      ttlMs: LIVE_DASHBOARD_CACHE_TTL_MS,
      cachedAt: null,
      expiresAt: null,
      remainingMs: null,
      mtimeMs: null,
      size: null,
    };
  }

  const cachedAtMs = cachedInput.expiresAt - LIVE_DASHBOARD_CACHE_TTL_MS;

  return {
    filePath: cachedInput.filePath,
    ttlMs: LIVE_DASHBOARD_CACHE_TTL_MS,
    cachedAt: new Date(cachedAtMs).toISOString(),
    expiresAt: new Date(cachedInput.expiresAt).toISOString(),
    remainingMs: Math.max(cachedInput.expiresAt - Date.now(), 0),
    mtimeMs: cachedInput.mtimeMs,
    size: cachedInput.size,
  };
};

const readLiveDashboardInput = async (filePath: string) => {
  const startedAt = Date.now();
  const fileStats = await stat(filePath);
  const cachedInput = liveDashboardInputCache;

  if (
    cachedInput &&
    cachedInput.filePath === filePath &&
    cachedInput.mtimeMs === fileStats.mtimeMs &&
    cachedInput.size === fileStats.size &&
    cachedInput.expiresAt > Date.now()
  ) {
    const durationMs = Date.now() - startedAt;

    if (durationMs >= SLOW_DASHBOARD_READ_THRESHOLD_MS) {
      logDashboardActivity("live-read:cache-hit", {
        durationMs,
        filePath,
        size: fileStats.size,
      });
    }

    return cachedInput.input;
  }

  const raw = await readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const input = parseDashboardInput(parsed);

  liveDashboardInputCache = {
    filePath,
    input,
    mtimeMs: fileStats.mtimeMs,
    size: fileStats.size,
    expiresAt: Date.now() + LIVE_DASHBOARD_CACHE_TTL_MS,
  };

  const durationMs = Date.now() - startedAt;

  if (durationMs >= SLOW_DASHBOARD_READ_THRESHOLD_MS) {
    logDashboardActivity("live-read:slow", {
      durationMs,
      filePath,
      size: fileStats.size,
    });
  }

  return input;
};

const getDemoSourceInfo = (
  configuredMode: DashboardSourceMode,
  detail?: string,
  liveFilePath?: string,
): DashboardSourceInfo => ({
  configuredMode,
  resolvedMode: "demo",
  fallback: configuredMode !== "demo",
  detail,
  liveFilePath,
});

const resolveLiveDashboardInput = async (
  configuredMode: DashboardSourceMode,
  liveFilePath: string,
): Promise<ResolvedDashboardInput> => {
  const startedAt = Date.now();
  const fileStats = await stat(liveFilePath);
  // Include the NHL stats cache mtime in the cache key so that when the
  // background refresh writes new entries to disk, the next resolve picks
  // them up immediately instead of waiting for the 5 min TTL to expire.
  const statsMtimeMs = await stat(getNhlPlayerStatsCachePath())
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  const cachedResolved = resolvedDashboardInputCache;

  if (
    cachedResolved &&
    cachedResolved.filePath === liveFilePath &&
    cachedResolved.mtimeMs === fileStats.mtimeMs &&
    cachedResolved.size === fileStats.size &&
    cachedResolved.statsMtimeMs === statsMtimeMs &&
    cachedResolved.expiresAt > Date.now()
  ) {
    return cachedResolved.resolved;
  }

  const input = await readLiveDashboardInput(liveFilePath);
  const autoRefresh = await maybeAutoRefreshPlayerRealSeasonStats(input);
  if (autoRefresh.autoRefreshed) {
    await persistLiveDashboardInputDuringRender(autoRefresh.input);
  }
  const liveInput = autoRefresh.input;
  const contractHydratedRoster = await hydratePhoPlayerContracts(liveInput.roster, undefined, {
    fetchMissing: false,
  });
  const contractHydratedLeagueTargets = await hydratePhoPlayerContracts(liveInput.leagueTargets, undefined, {
    fetchMissing: false,
  });
  const hydratedRoster = await hydratePhoPlayerSimulationStats(contractHydratedRoster);
  const hydratedLeagueTargets = await hydratePhoPlayerSimulationStats(contractHydratedLeagueTargets);
  const hydratedDraftPicks = liveInput.draftPicks;
  const resolvedInput =
    hydratedRoster === liveInput.roster &&
    hydratedLeagueTargets === liveInput.leagueTargets &&
    hydratedDraftPicks === liveInput.draftPicks
      ? liveInput
      : {
          ...liveInput,
          roster: hydratedRoster,
          leagueTargets: hydratedLeagueTargets,
          draftPicks: applyDraftOrdersToPicks(hydratedDraftPicks, liveInput.draftOrders),
        };

  const resolved: ResolvedDashboardInput = {
    input: resolvedInput,
    source: {
      configuredMode,
      resolvedMode: "live-file",
      fallback: false,
      liveFilePath,
    },
  };

  // The auto-refresh may have rewritten the live file. Re-stat so the cache key
  // matches the on-disk file going forward.
  const finalStats = autoRefresh.autoRefreshed ? await stat(liveFilePath).catch(() => fileStats) : fileStats;
  const finalStatsMtimeMs = await stat(getNhlPlayerStatsCachePath())
    .then((value) => value.mtimeMs)
    .catch(() => statsMtimeMs);

  resolvedDashboardInputCache = {
    filePath: liveFilePath,
    mtimeMs: finalStats.mtimeMs,
    size: finalStats.size,
    statsMtimeMs: finalStatsMtimeMs,
    expiresAt: Date.now() + RESOLVED_INPUT_CACHE_TTL_MS,
    resolved,
  };

  const durationMs = Date.now() - startedAt;
  if (durationMs >= SLOW_DASHBOARD_RESOLVE_THRESHOLD_MS) {
    logDashboardActivity("resolve:slow", {
      durationMs,
      filePath: liveFilePath,
      size: finalStats.size,
      autoRefreshed: autoRefresh.autoRefreshed,
    });
  }

  return resolved;
};

export const loadDashboardInput = async (): Promise<ResolvedDashboardInput> => {
  const configuredMode = getConfiguredSourceMode();

  if (configuredMode === "demo") {
    return {
      input: demoDashboardInput,
      source: getDemoSourceInfo("demo"),
    };
  }

  const liveFilePath = getConfiguredLiveFilePath();

  if (pendingResolvedDashboardInput) {
    return pendingResolvedDashboardInput;
  }

  const pending = (async () => {
    try {
      return await resolveLiveDashboardInput(configuredMode, liveFilePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown live data loading failure.";
      logDashboardFailure("live-load:fallback", error, {
        configuredMode,
        liveFilePath,
      });

      return {
        input: demoDashboardInput,
        source: getDemoSourceInfo(
          configuredMode,
          `${detail} Falling back to demo data. Create ${liveFilePath} or set NHL_SIM_LIVE_DATA_PATH.`,
          liveFilePath,
        ),
      } satisfies ResolvedDashboardInput;
    }
  })().finally(() => {
    pendingResolvedDashboardInput = null;
  });

  pendingResolvedDashboardInput = pending;
  return pending;
};

export const loadDashboardSnapshot = async (): Promise<{
  snapshot: DashboardSnapshot;
  source: DashboardSourceInfo;
}> => {
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);

  return {
    snapshot: getDashboardSnapshot(input, tradeHistory.valueSignals),
    source,
  };
};

export const parseDashboardInput = (value: unknown): NormalizedDashboardInput => {
  if (!isDashboardInput(value)) {
    throw new Error(
      "Dashboard payload is invalid. Expected { teamName, roster, leagueTargets, draftPicks } with normalized player and pick fields.",
    );
  }

  const normalizedDraftPicks = value.draftPicks.map(normalizeDraftPick);
  const normalizedInput: DashboardInput = {
    ...value,
    draftPicks: normalizedDraftPicks,
  };
  const draftOrders = buildNormalizedDraftOrders(normalizedInput);

  return {
    ...normalizedInput,
    draftOrders,
    draftPicks: applyDraftOrdersToPicks(normalizedDraftPicks, draftOrders),
  };
};

const writeLiveDashboardInput = async (
  input: NormalizedDashboardInput,
  options?: {
    revalidate?: boolean;
  },
) => {
  const liveFilePath = getConfiguredLiveFilePath();
  const serializedInput = `${JSON.stringify(input, null, 2)}\n`;

  await mkdir(path.dirname(liveFilePath), { recursive: true });
  await writeFile(liveFilePath, serializedInput, "utf8");

  const writtenStats = await stat(liveFilePath).catch(() => null);
  const mtimeMs = writtenStats?.mtimeMs ?? Date.now();
  const size = writtenStats?.size ?? Buffer.byteLength(serializedInput, "utf8");

  liveDashboardInputCache = {
    filePath: liveFilePath,
    input,
    mtimeMs,
    size,
    expiresAt: Date.now() + LIVE_DASHBOARD_CACHE_TTL_MS,
  };

  // Drop the resolved cache so the next load re-runs hydration against the new
  // file contents. The hydration result depends on the live-file payload itself.
  resolvedDashboardInputCache = null;

  if (options?.revalidate ?? true) {
    revalidateTag("dashboard-input", "max");
    revalidatePath("/");
  }

  return {
    input,
    liveFilePath,
    configuredMode: getConfiguredSourceMode(),
  };
};

export const persistLiveDashboardInput = async (value: unknown) => {
  const input = parseDashboardInput(value);
  return writeLiveDashboardInput(input, { revalidate: true });
};

export const persistLiveDashboardInputDuringRender = async (value: unknown) => {
  const input = parseDashboardInput(value);
  return writeLiveDashboardInput(input, { revalidate: false });
};

export const updateLiveDashboardDraftPicks = async (updates: DraftPickOrderUpdate[]) => {
  if (updates.length === 0) {
    throw new Error("No draft-pick updates were provided.");
  }

  const liveFilePath = getConfiguredLiveFilePath();
  const raw = await readFile(liveFilePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const input = parseDashboardInput(parsed);
  const updatesByKey = new Map(
    updates.map((update) => [
      getDraftPickOrderKey(update.team, update.season),
      {
        team: update.team,
        season: update.season,
        projectedSlot: Math.max(1, Math.round(update.projectedSlot)),
      },
    ]),
  );

  const mergedDraftOrders = [
    ...input.draftOrders.filter(
      (draftOrder) => !updatesByKey.has(getDraftPickOrderKey(draftOrder.team, draftOrder.season)),
    ),
    ...updatesByKey.values(),
  ];

  return persistLiveDashboardInput({
    ...input,
    draftOrders: mergedDraftOrders,
  });
};