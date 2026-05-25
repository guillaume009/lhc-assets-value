import { revalidatePath } from "next/cache";

import { getPhoTradeImportConfig, loadTradeHistory, refreshPhoTradeCache } from "@/lib/trade-history";

const isPhoRateLimitError = (message: string) => /too many attempts|status 429/i.test(message);

const revalidateTradeSurfaces = () => {
  revalidatePath("/");
  revalidatePath("/players");
  revalidatePath("/teams");
  revalidatePath("/trades");
};

export async function GET() {
  return Response.json({
    ok: true,
    importer: "playhockeyonline-trades",
    config: getPhoTradeImportConfig(),
  });
}

export async function POST() {
  try {
    const result = await refreshPhoTradeCache();
    const tradeHistory = await loadTradeHistory();

    revalidateTradeSurfaces();

    return Response.json({
      ok: true,
      importer: "playhockeyonline-trades",
      config: getPhoTradeImportConfig(),
      ...result,
      cachedTradeCount: tradeHistory.trades.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PHO trades import failure.";

    if (isPhoRateLimitError(message)) {
      const cachedTradeHistory = await loadTradeHistory();

      revalidateTradeSurfaces();

      return Response.json({
        ok: true,
        importer: "playhockeyonline-trades",
        config: getPhoTradeImportConfig(),
        fallback: true,
        warning: `PHO trade refresh was rate-limited, so the app kept the cached trade data instead. ${message}`,
        rawFilePath: getPhoTradeImportConfig().rawFilePath,
        cachedTradeCount: cachedTradeHistory.trades.length,
      });
    }

    return Response.json(
      {
        ok: false,
        importer: "playhockeyonline-trades",
        config: getPhoTradeImportConfig(),
        error: message,
      },
      { status: 400 },
    );
  }
}