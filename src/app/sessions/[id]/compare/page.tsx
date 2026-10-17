import { CloudCompareView } from "@/components/CloudCompareView";
import { LocalCompare } from "@/components/LocalGarage";
import { shouldUseLocalSession } from "@/lib/session-route";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ref?: string; other?: string; otherSession?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  if (shouldUseLocalSession(id)) {
    return (
      <LocalCompare
        id={id}
        initialRef={query.ref}
        initialOther={query.other}
        initialOtherSession={query.otherSession}
      />
    );
  }

  return (
    <CloudCompareView
      id={id}
      initialRef={query.ref}
      initialOther={query.other}
      initialOtherSession={query.otherSession}
    />
  );
}
