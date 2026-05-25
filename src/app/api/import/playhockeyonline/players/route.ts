import { getPhoImportConfig, importPhoPlayers } from "@/lib/playhockeyonline";

export async function GET() {
  return Response.json({
    ok: true,
    importer: "playhockeyonline-players",
    config: getPhoImportConfig(),
  });
}

export async function POST() {
  try {
    const result = await importPhoPlayers();

    return Response.json({
      ok: true,
      importer: "playhockeyonline-players",
      config: getPhoImportConfig(),
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PHO import failure.";

    return Response.json(
      {
        ok: false,
        importer: "playhockeyonline-players",
        config: getPhoImportConfig(),
        error: message,
      },
      { status: 400 },
    );
  }
}