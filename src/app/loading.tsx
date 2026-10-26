import { PageSkeleton } from "@/components/PageSkeleton";

export default function RootLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageSkeleton label="Loading…" rows={3} />
    </main>
  );
}
