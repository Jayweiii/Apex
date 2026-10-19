import { SavedComparisonView } from "@/components/SavedComparisonView";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import type { Metadata } from "next";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const title = "Apex comparison";
  const description =
    "Side-by-side lap comparison with GPS map, speed charts, and synced YouTube onboards.";
  const path = `/compare/${id}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: path,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function CompareByIdPage({ params }: Props) {
  const { id } = await params;
  if (!hasSupabaseConfig()) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <p className="text-sm text-zinc-400">
          Supabase is not configured — saved comparisons are unavailable.
        </p>
      </main>
    );
  }
  return <SavedComparisonView id={id} />;
}
