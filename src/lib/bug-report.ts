/**
 * Bug report helpers: a tiny ring buffer of recent client errors plus the
 * text/mailto builders. No network, no storage reads: the report only ever
 * contains what is built here (never auth tokens, cookies or localStorage).
 */

export const BUG_REPORT_EMAIL = "jwei+apexbug@mail.grokbot.com";
export const BUG_REPORT_MAX_ERRORS = 5;
/** Total mailto length budget; the error log is trimmed first. */
export const BUG_REPORT_MAX_MAILTO = 1800;

const MAX_ERROR_CHARS = 160;
const errors: string[] = [];
let installed = false;

/** Drop anything that looks like a credential before it is stored. */
function clean(message: string): string {
  return message
    .replace(/([?&#;\s](?:access_token|refresh_token|token|apikey|key|code|sig|signature)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:eyJ[\w-]{10,}\.[\w-]+\.[\w-]+|sb-[\w-]+)\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_CHARS);
}

function push(message: string) {
  const text = clean(message);
  if (!text) return;
  errors.push(text);
  if (errors.length > BUG_REPORT_MAX_ERRORS) errors.shift();
}

/** Start capturing window.onerror / unhandledrejection (idempotent). */
export function installErrorBuffer() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    push(event.message || (event.error instanceof Error ? event.error.message : "Script error"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    push(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

export function recentErrors(): string[] {
  return [...errors];
}

export type BugContext = {
  route: string;
  build: string;
  viewport: string;
  dpr: string;
  userAgent: string;
  touch: string;
  controlMode?: string;
  errors: string[];
};

/** Snapshot of the automatically attached context (browser only). */
export function collectBugContext(controlMode?: string): BugContext {
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return {
    route: window.location.pathname,
    build: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev",
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: String(window.devicePixelRatio || 1),
    userAgent: navigator.userAgent,
    touch: touch ? `yes (${navigator.maxTouchPoints} points)` : "no",
    controlMode,
    errors: recentErrors(),
  };
}

export function contextLines(ctx: BugContext, errorCount = ctx.errors.length): string[] {
  const lines = [
    `Route: ${ctx.route}`,
    `Build: ${ctx.build}`,
    `Viewport: ${ctx.viewport} @${ctx.dpr}x`,
    `Touch: ${ctx.touch}`,
  ];
  if (ctx.controlMode) lines.push(`Controls: ${ctx.controlMode}`);
  lines.push(`User agent: ${ctx.userAgent}`);
  const shown = errorCount > 0 ? ctx.errors.slice(-errorCount) : [];
  lines.push(shown.length ? `Recent errors:\n${shown.map((e) => `- ${e}`).join("\n")}` : "Recent errors: none");
  return lines;
}

export function reportText(note: string, ctx: BugContext, errorCount = ctx.errors.length): string {
  return `${note.trim() || "(no description)"}\n\n--- Context ---\n${contextLines(ctx, errorCount).join("\n")}`;
}

/** mailto: link under the length budget; trims the error log first, then the note. */
export function buildMailto(note: string, ctx: BugContext): string {
  const subject = encodeURIComponent(`Apex bug: ${ctx.route}`);
  const make = (n: string, errorCount: number) =>
    `mailto:${BUG_REPORT_EMAIL}?subject=${subject}&body=${encodeURIComponent(reportText(n, ctx, errorCount))}`;
  for (let count = ctx.errors.length; count >= 0; count -= 1) {
    const url = make(note, count);
    if (url.length <= BUG_REPORT_MAX_MAILTO) return url;
  }
  let trimmed = note;
  while (trimmed.length > 0) {
    trimmed = trimmed.slice(0, Math.floor(trimmed.length * 0.8));
    const url = make(`${trimmed}…`, 0);
    if (url.length <= BUG_REPORT_MAX_MAILTO) return url;
  }
  return make("", 0);
}
