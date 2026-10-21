import {
  parseStartFinishLine,
  serializeStartFinishLine,
} from "@/lib/start-finish-line";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Owner / session-owner: persist a track start/finish gate.
 * Body: { startFinish: { lat, lon, headingDeg?, a?, b? }, resplitSessionId? }
 * When resplitSessionId is set, caller should POST /api/sessions/:id/reparse
 * after this succeeds (keeps this route focused on the track row).
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: trackId } = await context.params;
  if (!trackId?.trim()) {
    return NextResponse.json({ error: "Missing track id" }, { status: 400 });
  }

  let body: { startFinish?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const line = parseStartFinishLine(body.startFinish);
  if (!line) {
    return NextResponse.json(
      { error: "startFinish requires lat/lon or endpoints a/b" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data: track, error: loadError } = await supabase
    .from("tracks")
    .select("id, created_by, start_finish")
    .eq("id", trackId)
    .maybeSingle();
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const payload = serializeStartFinishLine(line);
  const { error: updateError } = await supabase
    .from("tracks")
    .update({
      start_finish: payload,
      lat: line.lat,
      lon: line.lon,
    })
    .eq("id", trackId);

  if (updateError) {
    const denied = /policy|permission|rls/i.test(updateError.message);
    return NextResponse.json(
      {
        error: denied
          ? "You can only edit start/finish on tracks you own (or that have your sessions)."
          : updateError.message,
        code: denied ? "forbidden" : "update_failed",
      },
      { status: denied ? 403 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    trackId,
    startFinish: payload,
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: trackId } = await context.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tracks")
    .select("id, lat, lon, start_finish")
    .eq("id", trackId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  return NextResponse.json({
    trackId: data.id,
    lat: data.lat,
    lon: data.lon,
    startFinish: parseStartFinishLine(data.start_finish) ?? {
      lat: Number(data.lat),
      lon: Number(data.lon),
    },
  });
}
