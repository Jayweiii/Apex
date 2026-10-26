/** Lightweight page shell while client data / heavy chunks load. */
export function PageSkeleton({
  label = "Loading…",
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex w-full flex-col gap-3"
    >
      <p className="text-sm text-zinc-500">{label}</p>
      <div className="h-40 animate-pulse rounded-2xl border border-zinc-800/80 bg-zinc-950/50" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-xl border border-zinc-900 bg-zinc-950/40"
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

export function SessionPageSkeleton() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <PageSkeleton label="Loading session…" rows={5} />
    </main>
  );
}

export function ComparePageSkeleton() {
  return (
    <main className="mx-auto w-full max-w-[90rem] px-3 py-4 sm:px-4">
      <PageSkeleton label="Loading compare…" rows={3} />
    </main>
  );
}
