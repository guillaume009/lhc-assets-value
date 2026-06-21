import { NextResponse } from "next/server";

import { resolveNhlHeadshot } from "@/lib/nhl-headshots";

const JSON_CACHE_CONTROL = "public, max-age=86400, s-maxage=2592000";
const EMPTY_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

const buildProxyUrl = (request: Request, name: string) => {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("name", name);
  url.searchParams.set("mode", "image");
  return `${url.pathname}?${url.searchParams.toString()}`;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim() ?? "";
  const mode = searchParams.get("mode");

  if (!name) {
    return NextResponse.json({ error: "Missing name query parameter." }, { status: 400 });
  }

  const headshotUrl = await resolveNhlHeadshot(name);

  if (mode === "image") {
    if (!headshotUrl) {
      return new Response(null, {
        status: 404,
        headers: {
          "Cache-Control": EMPTY_CACHE_CONTROL,
        },
      });
    }

    const upstream = await fetch(headshotUrl, {
      next: { revalidate: 60 * 60 * 24 * 30 },
    }).catch(() => null);

    if (!upstream?.ok || !upstream.body) {
      return new Response(null, {
        status: 404,
        headers: {
          "Cache-Control": EMPTY_CACHE_CONTROL,
        },
      });
    }

    return new Response(upstream.body, {
      headers: {
        "Cache-Control": JSON_CACHE_CONTROL,
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      },
    });
  }

  if (!headshotUrl) {
    return NextResponse.json(
      { headshotUrl: null },
      {
        headers: {
          "Cache-Control": EMPTY_CACHE_CONTROL,
        },
      },
    );
  }

  return NextResponse.json(
    { headshotUrl: buildProxyUrl(request, name) },
    {
      headers: {
        "Cache-Control": JSON_CACHE_CONTROL,
      },
    },
  );
}
