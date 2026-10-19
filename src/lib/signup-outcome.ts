/** Pure helpers for /login signup responses (auto-confirm vs confirm-email). */

export type SignUpAuthError = {
  message?: string;
  code?: string;
  status?: number;
};

export type SignUpAuthData = {
  session: object | null;
  user: {
    email_confirmed_at?: string | null;
    identities?: unknown[] | null;
  } | null;
};

export type SignUpOutcome =
  | { kind: "signed_in" }
  | { kind: "confirm_email" }
  | { kind: "error"; message: string };

const ALREADY_REGISTERED =
  "An account with this email already exists. Sign in instead.";
const WEAK_PASSWORD =
  "Password is too weak. Use at least 6 characters with a mix of letters and numbers.";

export function mapSignUpError(error: SignUpAuthError): string {
  const message = error.message ?? "";
  const code = (error.code ?? "").toLowerCase();

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    /already\s*(been\s*)?registered|user\s+already\s+exists|email\s+address\s+is\s+already|already\s+been\s+taken/i.test(
      message,
    )
  ) {
    return ALREADY_REGISTERED;
  }

  if (
    code === "weak_password" ||
    /weak\s*password|password.*(too\s*weak|at\s*least|should\s+contain|must\s+contain|is\s+too\s+short)/i.test(
      message,
    )
  ) {
    return WEAK_PASSWORD;
  }

  return message || "Sign up failed";
}

/**
 * Decide what the UI should do after supabase.auth.signUp.
 * With Confirm email OFF, a successful signup returns a session → signed_in.
 * Confirm email message only when session is null and user lacks email_confirmed_at.
 */
export function resolveSignUpOutcome(
  data: SignUpAuthData,
  error?: SignUpAuthError | null,
): SignUpOutcome {
  if (error) {
    return { kind: "error", message: mapSignUpError(error) };
  }

  if (data.session) {
    return { kind: "signed_in" };
  }

  const user = data.user;
  if (user && !user.email_confirmed_at) {
    // Supabase may return an empty identities array for an already-registered
    // email when confirm-email is enabled (no error thrown).
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      return { kind: "error", message: ALREADY_REGISTERED };
    }
    return { kind: "confirm_email" };
  }

  if (user) {
    return { kind: "error", message: ALREADY_REGISTERED };
  }

  return { kind: "error", message: "Sign up failed" };
}
