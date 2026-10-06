import { NextResponse } from "next/server";

/** Proxy YouTube oEmbed (public, no API key) to read titles for pasted links. */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  try {
    const target = new URL("https://www.youtube.com/oembed");
    target.searchParams.set("url", url);
    target.searchParams.set("format", "json");
    const res = await fetch(target.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `oEmbed ${res.status}` },
        { status: res.status },
      );
    }
    const json = await res.json();
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "oEmbed failed",
      },
      { status: 502 },
    );
  }
}
