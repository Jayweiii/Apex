import { createClient } from "@/lib/supabase/server";
import {
  isSessionVisibility,
  type SessionVisibility,
} from "@/lib/visibility";
import { NextResponse } from "next/server";

/**
 * Persist session visibility for the signed-in owner.
 * Returns a clear error when the visibility column / RLS migration is missing.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: { visibility?: unknown };
  try {
    body = (await request.json()) as { visibility?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isSessionVisibility(body.visibility)) {
    return NextResponse.json(
      { error: "visibility must be private, friends, or public" },
      { status: 400 },
    );
  }
  const visibility: SessionVisibility = body.visibility;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("sessions")
    .update({ visibility })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, visibility")
    .maybeSingle();

  if (error) {
    const missingColumn = /visibility/i.test(error.message);
    return NextResponse.json(
      {
        error: missingColumn
          ? "Run supabase/migrations/20261017_session_visibility.sql in the Supabase SQL editor, then retry."
          : error.message,
        code: missingColumn ? "missing_visibility_column" : "update_failed",
      },
      { status: missingColumn ? 503 : 400 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Session not found or you are not the owner" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    id: data.id,
    visibility: data.visibility as SessionVisibility,
  });
}
