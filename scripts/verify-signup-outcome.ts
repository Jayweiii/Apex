import {
  mapSignUpError,
  resolveSignUpOutcome,
} from "../src/lib/signup-outcome";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Auto-confirm (Confirm email OFF): session present → signed in
{
  const outcome = resolveSignUpOutcome({
    session: { access_token: "tok" },
    user: { email_confirmed_at: "2026-01-01T00:00:00Z" },
  });
  assert(outcome.kind === "signed_in", "auto-confirm → signed_in");
}

// Confirm email ON: no session, unconfirmed user → check email
{
  const outcome = resolveSignUpOutcome({
    session: null,
    user: { email_confirmed_at: null, identities: [{ id: "1" }] },
  });
  assert(outcome.kind === "confirm_email", "unconfirmed → confirm_email");
}

// Do NOT show confirm email when session is present even if confirmed_at odd
{
  const outcome = resolveSignUpOutcome({
    session: { access_token: "tok" },
    user: { email_confirmed_at: null },
  });
  assert(outcome.kind === "signed_in", "session wins over missing confirmed_at");
}

// Already registered (API error)
{
  const outcome = resolveSignUpOutcome(
    { session: null, user: null },
    { message: "User already registered", code: "user_already_exists" },
  );
  assert(outcome.kind === "error", "already registered is error");
  assert(
    outcome.kind === "error" &&
      /already exists/i.test(outcome.message) &&
      /sign in/i.test(outcome.message),
    "clear already-registered message",
  );
}

// Already registered obfuscated (empty identities, no session)
{
  const outcome = resolveSignUpOutcome({
    session: null,
    user: { email_confirmed_at: null, identities: [] },
  });
  assert(outcome.kind === "error", "empty identities → already registered");
  assert(
    outcome.kind === "error" && /already exists/i.test(outcome.message),
    "empty identities message",
  );
}

// Confirmed user but no session → treat as already registered
{
  const outcome = resolveSignUpOutcome({
    session: null,
    user: { email_confirmed_at: "2026-01-01T00:00:00Z" },
  });
  assert(outcome.kind === "error", "confirmed without session → error");
}

// Weak password
{
  const msg = mapSignUpError({
    message: "Password should contain at least one character of each...",
    code: "weak_password",
  });
  assert(/too weak/i.test(msg), "weak password mapped");
}

{
  const outcome = resolveSignUpOutcome(
    { session: null, user: null },
    { message: "Password is known to be weak and easy to guess", code: "weak_password" },
  );
  assert(outcome.kind === "error", "weak password outcome");
  assert(
    outcome.kind === "error" && /too weak/i.test(outcome.message),
    "weak password clear message",
  );
}

// Missing user+session without error
{
  const outcome = resolveSignUpOutcome({ session: null, user: null });
  assert(outcome.kind === "error", "empty data → error");
}

console.log("verify-signup-outcome ok");
