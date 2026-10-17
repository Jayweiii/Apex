import {
  assertContentLengthWithinLimits,
  hashIp,
  MAX_UPLOADS_PER_IP_PER_HOUR,
  MAX_UPLOADS_PER_USER_PER_HOUR,
} from "@/lib/abuse-limits";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Pre-upload abuse check: file size + per-user / per-IP hourly caps.
 * Records an upload_events row when the rate-limit table exists.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      bytes?: number;
      kind?: "raw" | "video" | "session";
    };
    const kind = body.kind === "video" ? "video" : "raw";
    assertContentLengthWithinLimits(body.bytes, kind);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: userCount } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if ((userCount ?? 0) >= MAX_UPLOADS_PER_USER_PER_HOUR) {
      return NextResponse.json(
        {
          error: `Upload rate limit: max ${MAX_UPLOADS_PER_USER_PER_HOUR} sessions per hour.`,
        },
        { status: 429 },
      );
    }

    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0]?.trim() || "unknown";
    const ipHash = await hashIp(ip);

    const { count: ipCount } = await supabase
      .from("upload_events")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);

    // If table missing, ignore IP check.
    if (ipCount != null && ipCount >= MAX_UPLOADS_PER_IP_PER_HOUR) {
      return NextResponse.json(
        {
          error: `Upload rate limit: too many uploads from this network. Try again later.`,
        },
        { status: 429 },
      );
    }

    await supabase.from("upload_events").insert({
      user_id: user.id,
      ip_hash: ipHash,
      kind: body.kind === "session" ? "session" : kind,
      bytes: body.bytes ?? 0,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Check failed" },
      { status: 400 },
    );
  }
}
