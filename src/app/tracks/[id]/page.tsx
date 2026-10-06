import { TrackDetail } from "@/components/TrackDirectory";

export default async function TrackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TrackDetail id={id} />;
}
