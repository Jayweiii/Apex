import type { User } from "@supabase/supabase-js";

/** Minimal shape; accepts the real Supabase browser client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export function isAnonymousUser(user: User | null | undefined): boolean {
  if (!user) return false;
  return Boolean(
    user.is_anonymous ||
      (user.app_metadata as { provider?: string } | undefined)?.provider ===
        "anonymous",
  );
}

/**
 * Return the current user, or silently create an anonymous session.
 * Requires Anonymous sign-ins enabled in Supabase Auth → Providers.
 */
export async function ensureAuthenticatedUser(
  client: SupabaseLike,
): Promise<User> {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error) throw new Error(error.message);
  if (user) return user;

  const { data, error: anonError } = await client.auth.signInAnonymously();
  if (anonError) {
    const message = anonError.message ?? "Anonymous sign-in failed";
    if (/anonymous|disabled|not enabled|unsupported/i.test(message)) {
      throw new Error(
        "Guest uploads need Anonymous sign-ins enabled in Supabase (Authentication → Providers → Anonymous). Enable it, then retry.",
      );
    }
    throw new Error(message);
  }
  if (!data.user) {
    throw new Error("Anonymous sign-in did not return a user");
  }
  return data.user;
}

/** Link an email (+ optional password) to the current anonymous user. */
export async function claimAnonymousAccount(
  client: SupabaseLike,
  input: { email: string; password?: string },
): Promise<void> {
  const user = await ensureAuthenticatedUser(client);
  if (!isAnonymousUser(user)) {
    throw new Error("Already signed in with an email account");
  }
  const { error } = await client.auth.updateUser({
    email: input.email.trim(),
    ...(input.password ? { password: input.password } : {}),
  });
  if (error) throw new Error(error.message);
}
