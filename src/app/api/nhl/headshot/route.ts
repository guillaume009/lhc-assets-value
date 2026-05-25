import { NextResponse } from "next/server";

import { resolveNhlHeadshot } from "@/lib/nhl-headshots";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim() ?? "";

  if (!name) {
    return NextResponse.json({ error: "Missing name query parameter." }, { status: 400 });
  }

  const headshotUrl = await resolveNhlHeadshot(name);

  if (!headshotUrl) {
    return NextResponse.json(
      { headshotUrl: null },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      },
    );
  }

  return NextResponse.json(
    { headshotUrl },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=2592000",
      },
    },
  );
}
