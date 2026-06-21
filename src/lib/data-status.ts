import { stat } from "node:fs/promises";

import { getPhoImportConfig } from "@/lib/playhockeyonline";
import {
  getConfiguredLiveFilePath,
  getConfiguredSourceMode,
  getLiveDashboardCacheStatus,
  loadDashboardInput,
} from "@/lib/dashboard-data-source";
import {
  getNhlPlayerStatsImportConfig,
  readNhlPlayerStatsCacheSummary,
} from "@/lib/nhl-player-stats";
import {
  getPhoTradeImportConfig,
  getTradeHistoryCacheStatus,
  loadTradeHistory,
} from "@/lib/trade-history";

type HealthState = "healthy" | "warning" | "info";

export type FileTimestampStatus = {
  path: string;
  exists: boolean;
  modifiedAt: string | null;
  sizeBytes: number | null;
  error: string | null;
};

export type AdminDataSection = {
  title: string;
  health: HealthState;
  summary: string;
  warnings: string[];
};

export type AdminDataStatus = {
  generatedAt: string;
  warnings: string[];
  dashboard: AdminDataSection & {
    configuredMode: string;
    resolvedMode: string;
    fallback: boolean;
    liveFile: FileTimestampStatus;
    inMemoryCache: ReturnType<typeof getLiveDashboardCacheStatus>;
    rosterCount: number;
    targetCount: number;
    draftPickCount: number;
    draftOrderCount: number;
  };
  phoPlayers: AdminDataSection & {
    rawFile: FileTimestampStatus;
    contractFile: FileTimestampStatus;
    hasBearerToken: boolean;
    hasCookie: boolean;
    hasXsrfToken: boolean;
    authorizationVariants: string[];
    pageFetchConcurrency: number;
    contractFetchConcurrency: number;
    maxMissingContractFetches: number;
  };
  trades: AdminDataSection & {
    rawFile: FileTimestampStatus;
    inMemoryCache: ReturnType<typeof getTradeHistoryCacheStatus>;
    tradeCount: number;
    hasBearerToken: boolean;
    hasCookie: boolean;
    hasXsrfToken: boolean;
    authorizationVariants: string[];
  };
  nhlStats: AdminDataSection & {
    cacheFile: FileTimestampStatus;
    importedAt: string;
    refreshIntervalHours: number;
    entryCount: number;
    matchedCount: number;
    notFoundCount: number;
    staleCount: number;
    trackedPlayerCount: number | null;
    missingTrackedEntryCount: number | null;
    staleTrackedEntryCount: number | null;
    sourceMode: string;
  };
};

const getFileTimestampStatus = async (filePath: string): Promise<FileTimestampStatus> => {
  try {
    const fileStats = await stat(filePath);

    return {
      path: filePath,
      exists: true,
      modifiedAt: new Date(fileStats.mtimeMs).toISOString(),
      sizeBytes: fileStats.size,
      error: null,
    };
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      modifiedAt: null,
      sizeBytes: null,
      error: error instanceof Error ? error.message : "Unknown file-status error.",
    };
  }
};

const getHealthState = (warnings: string[], infoOnly = false): HealthState => {
  if (warnings.length > 0) {
    return infoOnly ? "info" : "warning";
  }

  return infoOnly ? "info" : "healthy";
};

export const getAdminDataStatus = async (): Promise<AdminDataStatus> => {
  const configuredMode = getConfiguredSourceMode();
  const dashboardFilePath = getConfiguredLiveFilePath();
  const phoConfig = getPhoImportConfig();
  const tradeConfig = getPhoTradeImportConfig();
  const nhlConfig = getNhlPlayerStatsImportConfig();

  const [resolvedDashboard, tradeHistory, dashboardLiveFile, phoRawFile, phoContractFile, tradeRawFile] =
    await Promise.all([
      loadDashboardInput(),
      loadTradeHistory(),
      getFileTimestampStatus(dashboardFilePath),
      getFileTimestampStatus(phoConfig.rawFilePath),
      getFileTimestampStatus(phoConfig.contractCachePath),
      getFileTimestampStatus(tradeConfig.rawFilePath),
    ]);

  const nhlCacheSummary = await readNhlPlayerStatsCacheSummary(resolvedDashboard.input);
  const nhlCacheFile = await getFileTimestampStatus(nhlConfig.cachePath);
  const dashboardWarnings = [
    ...(resolvedDashboard.source.fallback && resolvedDashboard.source.detail ? [resolvedDashboard.source.detail] : []),
    ...(configuredMode === "live-file" && !dashboardLiveFile.exists
      ? [`Configured live dashboard file is missing: ${dashboardFilePath}`]
      : []),
  ];
  const phoWarnings = [
    ...(!phoConfig.hasBearerToken && !phoConfig.hasCookie
      ? ["No PHO auth token or cookie is configured, so manual player/dashboard refreshes will fail."]
      : []),
    ...(!phoRawFile.exists ? [`PHO player raw cache file is missing: ${phoRawFile.path}`] : []),
    ...(!phoContractFile.exists ? [`PHO contract cache file is missing: ${phoContractFile.path}`] : []),
  ];
  const tradeCacheStatus = getTradeHistoryCacheStatus();
  const tradeWarnings = [
    ...(tradeCacheStatus.lastLoadFailure ? [tradeCacheStatus.lastLoadFailure.message] : []),
    ...(!tradeConfig.hasBearerToken && !tradeConfig.hasCookie
      ? ["No PHO auth token or cookie is configured, so manual trade refreshes will fail."]
      : []),
    ...(!tradeRawFile.exists ? [`Trade cache file is missing: ${tradeRawFile.path}`] : []),
    ...(tradeHistory.trades.length === 0 ? ["Trade history currently resolves to an empty fallback set."] : []),
  ];
  const nhlWarnings = [
    ...(nhlConfig.sourceMode !== "live-file"
      ? ["NHL real-world stats auto-refresh only runs when NHL_SIM_DATA_SOURCE=live-file."]
      : []),
    ...(!nhlCacheFile.exists ? [`NHL stats cache file is missing: ${nhlCacheFile.path}`] : []),
    ...((nhlCacheSummary.missingTrackedEntryCount ?? 0) > 0
      ? [`${nhlCacheSummary.missingTrackedEntryCount} tracked players do not have an NHL stats cache entry yet.`]
      : []),
    ...((nhlCacheSummary.staleTrackedEntryCount ?? 0) > 0
      ? [`${nhlCacheSummary.staleTrackedEntryCount} tracked players have stale NHL stats cache entries.`]
      : []),
  ];
  const warnings = [...dashboardWarnings, ...phoWarnings, ...tradeWarnings, ...nhlWarnings];

  return {
    generatedAt: new Date().toISOString(),
    warnings,
    dashboard: {
      title: "Dashboard source",
      health: getHealthState(dashboardWarnings, configuredMode === "demo"),
      summary:
        resolvedDashboard.source.resolvedMode === "live-file"
          ? "App routes are currently reading the live dashboard file."
          : configuredMode === "demo"
            ? "App routes are intentionally running on the bundled demo dataset."
            : "Configured live mode has fallen back to demo data.",
      warnings: dashboardWarnings,
      configuredMode,
      resolvedMode: resolvedDashboard.source.resolvedMode,
      fallback: resolvedDashboard.source.fallback,
      liveFile: dashboardLiveFile,
      inMemoryCache: getLiveDashboardCacheStatus(),
      rosterCount: resolvedDashboard.input.roster.length,
      targetCount: resolvedDashboard.input.leagueTargets.length,
      draftPickCount: resolvedDashboard.input.draftPicks.length,
      draftOrderCount: resolvedDashboard.input.draftOrders.length,
    },
    phoPlayers: {
      title: "PHO player import caches",
      health: getHealthState(phoWarnings),
      summary: "Tracks the raw PHO player payload and the locally cached contract snapshots used during dashboard hydration.",
      warnings: phoWarnings,
      rawFile: phoRawFile,
      contractFile: phoContractFile,
      hasBearerToken: phoConfig.hasBearerToken,
      hasCookie: phoConfig.hasCookie,
      hasXsrfToken: phoConfig.hasXsrfToken,
      authorizationVariants: phoConfig.authorizationVariants,
      pageFetchConcurrency: phoConfig.pageFetchConcurrency,
      contractFetchConcurrency: phoConfig.contractFetchConcurrency,
      maxMissingContractFetches: phoConfig.maxMissingContractFetches,
    },
    trades: {
      title: "PHO trade history",
      health: getHealthState(tradeWarnings),
      summary: "Past trades power trade-history pages and the valuation signal blend.",
      warnings: tradeWarnings,
      rawFile: tradeRawFile,
      inMemoryCache: tradeCacheStatus,
      tradeCount: tradeHistory.trades.length,
      hasBearerToken: tradeConfig.hasBearerToken,
      hasCookie: tradeConfig.hasCookie,
      hasXsrfToken: tradeConfig.hasXsrfToken,
      authorizationVariants: tradeConfig.authorizationVariants,
    },
    nhlStats: {
      title: "NHL real-world stats cache",
      health: getHealthState(nhlWarnings, nhlConfig.sourceMode !== "live-file"),
      summary: "Daily NHL stat refreshes cache player-season snapshots and hydrate tracked players in live-file mode.",
      warnings: nhlWarnings,
      cacheFile: nhlCacheFile,
      importedAt: nhlCacheSummary.importedAt,
      refreshIntervalHours: nhlCacheSummary.refreshIntervalHours,
      entryCount: nhlCacheSummary.entryCount,
      matchedCount: nhlCacheSummary.matchedCount,
      notFoundCount: nhlCacheSummary.notFoundCount,
      staleCount: nhlCacheSummary.staleCount,
      trackedPlayerCount: nhlCacheSummary.trackedPlayerCount,
      missingTrackedEntryCount: nhlCacheSummary.missingTrackedEntryCount,
      staleTrackedEntryCount: nhlCacheSummary.staleTrackedEntryCount,
      sourceMode: nhlConfig.sourceMode,
    },
  };
};