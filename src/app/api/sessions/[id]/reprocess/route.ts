import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { getObjectStorage } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!session.raw_object_key) {
    return NextResponse.json(
      { error: "No raw upload stored for this session" },
      { status: 400 },
    );
  }
  if (session.source_kind === "gopro") {
    return NextResponse.json(
      {
        error:
          "GoPro sessions are parsed in the browser. Re-upload the MP4 to re-process.",
      },
      { status: 400 },
    );
  }

  const storage = getObjectStorage();
  const raw = await storage.getObject(session.raw_object_key);
  if (!raw) {
    return NextResponse.json({ error: "Raw file missing from storage" }, { status: 404 });
  }

  const laps = parseTelemetryCsv(raw.toString("utf8"));
  await supabase.from("laps").delete().eq("session_id", id).eq("user_id", user.id);
  const { error: insertError } = await supabase.from("laps").insert(
    laps.map((lap) => ({
      session_id: id,
      user_id: user.id,
      lap_number: lap.lapNumber,
      lap_time_ms: lap.lapTimeMs,
      telemetry: lap.points,
    })),
  );
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, laps: laps.length });
}
