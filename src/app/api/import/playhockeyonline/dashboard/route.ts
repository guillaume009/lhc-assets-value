import { loadDashboardInput, persistLiveDashboardInput } from "@/lib/dashboard-data-source";
import { getPhoImportConfig, importPhoDashboard } from "@/lib/playhockeyonline";

const isPhoRateLimitError = (message: string) =>
  /too many attempts|status 429/i.test(message);

export async function POST() {
  try {
    const result = await importPhoDashboard();
    const persisted = await persistLiveDashboardInput(result.dashboardInput);

    return Response.json({
      ok: true,
      importer: "playhockeyonline-dashboard",
      config: getPhoImportConfig(),
      authVariant: result.authVariant,
      pageCount: result.pageCount,
      playerCount: result.playerCount,
      rosterCount: result.rosterCount,
      leagueTargetCount: result.leagueTargetCount,
      currentTeamId: result.currentTeamId,
      rawFilePath: result.rawFilePath,
      liveFilePath: persisted.liveFilePath,
      teamName: persisted.input.teamName,
      draftPickCount: persisted.input.draftPicks.length,
      tradeImport: null,
      warning: "Dashboard import no longer auto-refreshes PHO trades in the same request. Refresh trades separately if needed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PHO dashboard import failure.";

    if (isPhoRateLimitError(message)) {
      const cached = await loadDashboardInput();
      const persisted = await persistLiveDashboardInput(cached.input);

      return Response.json({
        ok: true,
        importer: "playhockeyonline-dashboard",
        config: getPhoImportConfig(),
        fallback: true,
        warning: `PHO import was rate-limited, so the app kept the cached live data instead. ${message}`,
        liveFilePath: persisted.liveFilePath,
        teamName: persisted.input.teamName,
        rosterCount: persisted.input.roster.length,
        leagueTargetCount: persisted.input.leagueTargets.length,
        draftPickCount: persisted.input.draftPicks.length,
        source: cached.source,
      });
    }

    return Response.json(
      {
        ok: false,
        importer: "playhockeyonline-dashboard",
        config: getPhoImportConfig(),
        error: message,
      },
      { status: 400 },
    );
  }
}