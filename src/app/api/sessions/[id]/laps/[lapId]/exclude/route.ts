import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Owner-only: set laps.excluded (+ optional exclude_reason).
 * Clear error when 20261019_exclude_bad_laps.sql is not applied yet.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; lapId: string }> },
) {
  const { id: sessionId, lapId } = await context.params;
  let body: { excluded?: unknown; exclude_reason?: unknown };
  try {
    body = (await request.json()) as {
      excluded?: unknown;
      exclude_reason?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.excluded !== "boolean") {
    return NextResponse.json(
      { error: "excluded must be a boolean" },
      { status: 400 },
    );
  }

  let excludeReason: string | null = null;
  if (body.excluded) {
    if (typeof body.exclude_reason === "string") {
      excludeReason = body.exclude_reason.trim().slice(0, 200) || null;
    } else if (body.exclude_reason == null) {
      excludeReason = "manual";
    } else {
      return NextResponse.json(
        { error: "exclude_reason must be a string or null" },
        { status: 400 },
      );
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("laps")
    .update({
      excluded: body.excluded,
      exclude_reason: body.excluded ? excludeReason : null,
    })
    .eq("id", lapId)
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .select("id, excluded, exclude_reason")
    .maybeSingle();

  if (error) {
    const missingColumn = /excluded|exclude_reason/i.test(error.message);
    return NextResponse.json(
      {
        error: missingColumn
          ? "Run supabase/migrations/20261019_exclude_bad_laps.sql in the Supabase SQL editor, then retry."
          : error.message,
        code: missingColumn ? "missing_exclude_columns" : "update_failed",
      },
      { status: missingColumn ? 503 : 400 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Lap not found or you are not the owner" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    id: data.id,
    excluded: Boolean(data.excluded),
    exclude_reason: (data.exclude_reason as string | null) ?? null,
  });
}
