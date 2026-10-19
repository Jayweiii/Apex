/**
 * Compare session.user_id to the signed-in auth user id.
 * Trims + lowercases so UUID casing / whitespace never hide owner UI.
 */
export function isSessionOwner(
  sessionUserId: string | null | undefined,
  authUserId: string | null | undefined,
): boolean {
  if (!sessionUserId || !authUserId) return false;
  return (
    sessionUserId.trim().toLowerCase() === authUserId.trim().toLowerCase()
  );
}
