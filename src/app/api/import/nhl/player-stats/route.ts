import { revalidatePath } from "next/cache";

import { loadDashboardInput, persistLiveDashboardInput } from "@/lib/dashboard-data-source";
import {
  getNhlPlayerStatsImportConfig,
  getNhlPlayerStatsRefreshProgress,
  maybeAutoRefreshPlayerRealSeasonStats,
  readNhlPlayerStatsCacheSummary,
  refreshLivePlayerRealSeasonStats,
} from "@/lib/nhl-player-stats";

const revalidatePlayerValueSurfaces = () => {
  revalidatePath("/");
  revalidatePath("/players");
  revalidatePath("/teams");
  revalidatePath("/trades");
  revalidatePath("/workbench");
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Allow the polled badge to drive auto-refresh forward even between page
  // navigations. Pass `?kick=0` to suppress this side effect (e.g. for the
  // admin /admin/data-status read-only view).
  const shouldKick = searchParams.get("kick") !== "0";

  // Load the live dashboard input so the summary can report tracked-player
  // coverage for the roster-scoped auto-refresh set. loadDashboardInput is
  // itself cached, so polling this every few seconds is cheap.
  let input;
  try {
    const resolved = await loadDashboardInput();
    input = resolved.input;
  } catch {
    input = undefined;
  }

  if (shouldKick && input) {
    // Fire and forget — maybeAutoRefreshPlayerRealSeasonStats is idempotent
    // (it short-circuits when no entries need refresh and coalesces concurrent
    // calls via a module-level promise). This keeps the cache filling toward
    // 100% coverage even when the user isn't navigating between pages.
    void maybeAutoRefreshPlayerRealSeasonStats(input).catch(() => {
      // Errors are surfaced via the progress payload; swallow here.
    });
  }

  const summary = await readNhlPlayerStatsCacheSummary(input);
  return Response.json({
    ok: true,
    importer: "nhl-player-stats",
    config: getNhlPlayerStatsImportConfig(),
    summary,
    progress: getNhlPlayerStatsRefreshProgress(),
  });
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestBody = (await request.json().catch(() => null)) as { playerIds?: unknown } | null;
    const force = searchParams.get("force") === "true";
    const playerId = searchParams.get("playerId")?.trim() || null;
    const bodyPlayerIds = Array.isArray(requestBody?.playerIds)
      ? [...new Set(requestBody.playerIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
      : [];
    const { input } = await loadDashboardInput();
    const requestedPlayerIds = playerId ? [playerId] : bodyPlayerIds.length > 0 ? bodyPlayerIds : undefined;
    const playersById = new Map([...input.roster, ...input.leagueTargets].map((player) => [player.id, player]));
    const targetPlayers = requestedPlayerIds ? requestedPlayerIds.map((id) => playersById.get(id) ?? null) : [];
    const missingPlayerIds = requestedPlayerIds
      ? requestedPlayerIds.filter((id, index) => targetPlayers[index] === null)
      : [];

    if (missingPlayerIds.length > 0) {
      return Response.json(
        {
          ok: false,
          importer: "nhl-player-stats",
          config: getNhlPlayerStatsImportConfig(),
          error:
            missingPlayerIds.length === 1
              ? `Player ${missingPlayerIds[0]} was not found in the current dashboard payload.`
              : `${missingPlayerIds.length} requested players were not found in the current dashboard payload.`,
        },
        { status: 404 },
      );
    }

    const result = await refreshLivePlayerRealSeasonStats(input, {
      force,
      playerIds: requestedPlayerIds,
    });
    const persisted = await persistLiveDashboardInput(result.input);

    revalidatePlayerValueSurfaces();

    return Response.json({
      ok: true,
      importer: "nhl-player-stats",
      config: getNhlPlayerStatsImportConfig(),
      ...result,
      playerId: targetPlayers.length === 1 ? targetPlayers[0]?.id ?? null : null,
      playerName: targetPlayers.length === 1 ? targetPlayers[0]?.name ?? null : null,
      targetPlayerCount: targetPlayers.length,
      liveFilePath: persisted.liveFilePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected NHL player stats refresh failure.";

    return Response.json(
      {
        ok: false,
        importer: "nhl-player-stats",
        config: getNhlPlayerStatsImportConfig(),
        error: message,
      },
      { status: 400 },
    );
  }
}