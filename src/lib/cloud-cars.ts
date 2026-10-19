/**
 * Shared community cars — readable by everyone; created by signed-in users.
 * Mirrors shared tracks so the upload car picker is never an empty dead-end.
 */

export type CloudCarRow = {
  id: string;
  name: string;
  created_by?: string | null;
  created_at?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export function normalizeCarName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function carKey(value: string) {
  return normalizeCarName(value).toLowerCase();
}

/** Distinct car names from the shared cars table (empty if not migrated). */
export async function fetchSharedCars(client: SupabaseLike): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("cars")
      .select("id, name")
      .order("name", { ascending: true });
    if (error) {
      if (/cars|relation|schema/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    const names = new Set<string>();
    for (const row of (data ?? []) as CloudCarRow[]) {
      const name = normalizeCarName(row.name);
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  } catch (err) {
    if (err instanceof Error && /cars|relation|schema/i.test(err.message)) {
      return [];
    }
    throw err;
  }
}

/**
 * Also pull car names from sessions the caller can read (own / friends / public)
 * so the picker stays useful before anyone has inserted into `cars`.
 */
export async function fetchCarsFromSessions(
  client: SupabaseLike,
): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("sessions")
      .select("car")
      .not("car", "is", null)
      .limit(200);
    if (error) return [];
    const names = new Set<string>();
    for (const row of data ?? []) {
      const name = normalizeCarName(String(row.car ?? ""));
      if (name) names.add(name);
    }
    return [...names];
  } catch {
    return [];
  }
}

/** Find or create a shared car by name. No-op soft path when table missing. */
export async function ensureSharedCar(
  client: SupabaseLike,
  name: string,
): Promise<string> {
  const trimmed = normalizeCarName(name);
  if (!trimmed) throw new Error("Enter the car");

  const existing = await fetchSharedCars(client);
  const hit = existing.find((item) => carKey(item) === carKey(trimmed));
  if (hit) return hit;

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Sign in to create a shared car");

  const { data, error } = await client
    .from("cars")
    .insert({ name: trimmed, created_by: user.id })
    .select("id, name")
    .single();

  if (error) {
    if (/duplicate|unique|cars_name/i.test(error.message)) {
      const again = await fetchSharedCars(client);
      const match = again.find((item) => carKey(item) === carKey(trimmed));
      if (match) return match;
    }
    if (/cars|relation|schema|permission/i.test(error.message)) {
      throw new Error(
        "Shared cars need migration supabase/migrations/20261019_shared_cars.sql — run it in the Supabase SQL editor, then retry.",
      );
    }
    throw new Error(error.message);
  }

  return normalizeCarName((data as CloudCarRow).name);
}
