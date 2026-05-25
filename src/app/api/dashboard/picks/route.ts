import { updateLiveDashboardDraftPicks } from "@/lib/dashboard-data-source";
import type { DraftPickOrderUpdate } from "@/lib/draft-pick-order";

type DraftPickUpdate = {
  team: string;
  season: number;
  projectedSlot: number;
};

const isDraftPickUpdate = (value: unknown): value is DraftPickUpdate =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { team?: unknown }).team === "string" &&
  typeof (value as { season?: unknown }).season === "number" &&
  typeof (value as { projectedSlot?: unknown }).projectedSlot === "number" &&
  Number.isFinite((value as { season: number }).season) &&
  Number.isFinite((value as { projectedSlot: number }).projectedSlot) &&
  (value as { projectedSlot: number }).projectedSlot >= 1;

export async function PATCH(request: Request) {
  try {
    const body: unknown = await request.json();

    if (!Array.isArray(body) || !body.every(isDraftPickUpdate)) {
      return Response.json(
        {
          ok: false,
          error: "Expected an array of { team, season, projectedSlot } draft-order updates.",
        },
        { status: 400 },
      );
    }

    const normalizedUpdates: DraftPickOrderUpdate[] = body.map((update) => ({
      team: update.team,
      season: Math.round(update.season),
      projectedSlot: Math.round(update.projectedSlot),
    }));

    const result = await updateLiveDashboardDraftPicks(normalizedUpdates);

    return Response.json({
      ok: true,
      liveFilePath: result.liveFilePath,
      updatedCount: normalizedUpdates.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected draft-pick update failure.";

    return Response.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 },
    );
  }
}