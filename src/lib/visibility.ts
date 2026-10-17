export type SessionVisibility = "private" | "friends" | "public";

export const VISIBILITY_OPTIONS: Array<{
  value: SessionVisibility;
  label: string;
  hint: string;
}> = [
  {
    value: "private",
    label: "Private",
    hint: "Only you",
  },
  {
    value: "friends",
    label: "Friends",
    hint: "Signed-in Apex drivers",
  },
  {
    value: "public",
    label: "Public link",
    hint: "Anyone with the link",
  },
];

export const DEFAULT_VISIBILITY: SessionVisibility = "friends";

export function isSessionVisibility(value: unknown): value is SessionVisibility {
  return value === "private" || value === "friends" || value === "public";
}

export function normalizeVisibility(value: unknown): SessionVisibility {
  return isSessionVisibility(value) ? value : DEFAULT_VISIBILITY;
}

/** UUID v4-ish ids used for cloud sessions (not catalog/demo/local). */
export function isCloudSessionId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}
