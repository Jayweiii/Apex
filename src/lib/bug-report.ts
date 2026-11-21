/**
 * Bug report plumbing: a tiny ring buffer of the last client errors, the
 * context block attached to a report, and the mailto builder. No network, no
 * storage: nothing here reads cookies, localStorage or Supabase session data.
 */

export const BUG_EMAIL = "jwei+apexbug@mail.grokbot.com";
export const MAX_ERRORS = 5;
/** Soft cap for the whole mailto: URL (mail clients truncate long ones). */
export const MAILTO_MAX = 1800;

const ERROR_MAX_CHARS = 200;
const errors: string[] = [];
let installed = false;

/** Drop anything that looks like a credential before it can enter a report. */
export function scrub(text: string): string {
  return text
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}(\.[\w-]*)?/g, "[redacted]")
    .replace(/\b(access_token|refresh_token|token|apikey|api_key|key|secret|password|auth\w*|code)=[^\s&"']+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, ERROR_MAX_CHARS);
}

function push(message: string) {
  errors.push(scrub(message || "unknown error"));
  while (errors.length > MAX_ERRORS) errors.shift();
}

/** Start capturing window errors. Safe to call many times. */
export function installErrorBuffer() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => push(e.message || String(e.error ?? "error")));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    push(`unhandledrejection: ${r instanceof Error ? r.message : String(r)}`);
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
  controls?: string;
  errors: string[];
};

export function collectContext(controls?: string): BugContext {
  const sha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  return {
    route: window.location.pathname,
    build: sha ? sha.slice(0, 7) : "dev",
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: String(window.devicePixelRatio || 1),
    userAgent: navigator.userAgent,
    touch: navigator.maxTouchPoints > 0 || "ontouchstart" in window ? `yes (${navigator.maxTouchPoints} points)` : "no",
    controls,
    errors: recentErrors(),
  };
}

export function formatContext(ctx: BugContext, errorCount = MAX_ERRORS): string {
  const errs = ctx.errors.slice(-errorCount);
  const lines = [
    `Route: ${ctx.route}`,
    `Build: ${ctx.build}`,
    `Viewport: ${ctx.viewport}`,
    `Pixel ratio: ${ctx.dpr}`,
    `User agent: ${ctx.userAgent}`,
    `Touch: ${ctx.touch}`,
  ];
  if (ctx.controls) lines.push(`Controls: ${ctx.controls}`);
  lines.push(errs.length ? `Recent errors (${errs.length}):` : "Recent errors: none", ...errs.map((e) => `- ${e}`));
  return lines.join("\n");
}

export function formatReport(note: string, ctx: BugContext, errorCount = MAX_ERRORS): string {
  return `${note.trim() || "(no description)"}\n\n--- context ---\n${formatContext(ctx, errorCount)}`;
}

/** mailto: link; trims the error log first, then the note, to stay under MAILTO_MAX. */
export function buildMailto(note: string, ctx: BugContext): string {
  const subject = encodeURIComponent(`Apex bug: ${ctx.route}`);
  const make = (n: string, errorCount: number) =>
    `mailto:${BUG_EMAIL}?subject=${subject}&body=${encodeURIComponent(formatReport(n, ctx, errorCount))}`;
  for (let k = Math.min(MAX_ERRORS, ctx.errors.length); k >= 0; k--) {
    const url = make(note, k);
    if (url.length <= MAILTO_MAX) return url;
  }
  let n = note;
  let url = make(n, 0);
  while (url.length > MAILTO_MAX && n.length > 0) {
    n = n.slice(0, Math.max(0, n.length - Math.max(20, url.length - MAILTO_MAX)));
    url = make(n, 0);
  }
  return url;
}

/** Coarse control-mode label for games without an explicit control setting. */
export function pointerControls(): string {
  return window.matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard / mouse";
}
