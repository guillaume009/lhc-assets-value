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
  ResolvedDashboardInput,
  SimulationStat,
} from "@/lib/domain";
import {
  applyDraftOrdersToPicks,
  buildNormalizedDraftOrders,
  getDraftPickOrderKey,
  type DraftPickOrderUpdate,
} from "@/lib/draft-pick-order";
import { hydratePhoPlayerContracts, hydratePhoPlayerSimulationStats } from "@/lib/playhockeyonline";
import { demoDashboardInput } from "@/lib/sample-data";
import { loadTradeHistory } from "@/lib/trade-history";
import { getDashboardSnapshot, type DashboardSnapshot } from "@/lib/valuation";

const DEFAULT_LIVE_DATA_PATH = path.join(process.cwd(), "data", "live-dashboard.json");

const validPositions: Position[] = ["C", "LW", "RW", "LD", "RD", "G"];
const validContractStatuses = ["signed", "rfa", "ufa", "prospect"];
const LIVE_DASHBOARD_CACHE_TTL_MS = 300_000;
const SLOW_DASHBOARD_READ_THRESHOLD_MS = 1_000;

let liveDashboardInputCache:
  | {
      filePath: string;
      input: NormalizedDashboardInput;
      mtimeMs: number;
      size: number;
      expiresAt: number;
    }
  | null = null;

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
    isNumber(value.performance) &&
    isNumber(value.playDriving) &&
    isNumber(value.defense) &&
    isNumber(value.specialTeams) &&
    isNumber(value.chemistryFit) &&
    isNumber(value.upside) &&
    (value.simulationStats === undefined ||
      (Array.isArray(value.simulationStats) && value.simulationStats.every(isSimulationStat)))
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
      (Array.isArray(value.draftOrders) && value.draftOrders.every(isDraftOrder)))
  );
};

const parseSourceMode = (value: string | undefined): DashboardSourceMode =>
  value === "live-file" ? "live-file" : "demo";

export const getConfiguredSourceMode = (): DashboardSourceMode =>
  parseSourceMode(process.env.NHL_SIM_DATA_SOURCE);

export const getConfiguredLiveFilePath = () =>
  process.env.NHL_SIM_LIVE_DATA_PATH?.trim() || DEFAULT_LIVE_DATA_PATH;

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

export const loadDashboardInput = async (): Promise<ResolvedDashboardInput> => {
  const configuredMode = getConfiguredSourceMode();

  if (configuredMode === "demo") {
    return {
      input: demoDashboardInput,
      source: getDemoSourceInfo("demo"),
    };
  }

  const liveFilePath = getConfiguredLiveFilePath();

  try {
    const input = await readLiveDashboardInput(liveFilePath);
    const contractHydratedRoster = await hydratePhoPlayerContracts(input.roster, undefined, {
      fetchMissing: false,
    });
    const contractHydratedLeagueTargets = await hydratePhoPlayerContracts(input.leagueTargets, undefined, {
      fetchMissing: false,
    });
    const hydratedRoster = await hydratePhoPlayerSimulationStats(contractHydratedRoster);
    const hydratedLeagueTargets = await hydratePhoPlayerSimulationStats(contractHydratedLeagueTargets);
    const hydratedDraftPicks = input.draftPicks;
    const resolvedInput = hydratedRoster === input.roster && hydratedLeagueTargets === input.leagueTargets && hydratedDraftPicks === input.draftPicks
      ? input
      : {
          ...input,
          roster: hydratedRoster,
          leagueTargets: hydratedLeagueTargets,
          draftPicks: applyDraftOrdersToPicks(hydratedDraftPicks, input.draftOrders),
        };

    return {
      input: resolvedInput,
      source: {
        configuredMode,
        resolvedMode: "live-file",
        fallback: false,
        liveFilePath,
      },
    };
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
    };
  }
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

export const persistLiveDashboardInput = async (value: unknown) => {
  const input = parseDashboardInput(value);
  const liveFilePath = getConfiguredLiveFilePath();
  const serializedInput = `${JSON.stringify(input, null, 2)}\n`;

  await mkdir(path.dirname(liveFilePath), { recursive: true });
  await writeFile(liveFilePath, serializedInput, "utf8");

  liveDashboardInputCache = {
    filePath: liveFilePath,
    input,
    mtimeMs: Date.now(),
    size: Buffer.byteLength(serializedInput, "utf8"),
    expiresAt: Date.now() + LIVE_DASHBOARD_CACHE_TTL_MS,
  };

  revalidateTag("dashboard-input", "max");
  revalidatePath("/");

  return {
    input,
    liveFilePath,
    configuredMode: getConfiguredSourceMode(),
  };
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