import {
  getConfiguredSourceMode,
  loadDashboardSnapshot,
  persistLiveDashboardInput,
} from "@/lib/dashboard-data-source";

export async function GET() {
  const payload = await loadDashboardSnapshot();

  return Response.json(payload);
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const { input, liveFilePath, configuredMode } = await persistLiveDashboardInput(body);

    return Response.json({
      ok: true,
      saved: {
        teamName: input.teamName,
        rosterCount: input.roster.length,
        leagueTargetCount: input.leagueTargets.length,
        draftPickCount: input.draftPicks.length,
      },
      liveFilePath,
      configuredMode,
      warning:
        configuredMode === "live-file"
          ? null
          : "Live data was saved, but NHL_SIM_DATA_SOURCE is still set to demo so the app will continue using demo data until you switch modes.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected import failure.";

    return Response.json(
      {
        ok: false,
        error: message,
        configuredMode: getConfiguredSourceMode(),
      },
      { status: 400 },
    );
  }
}