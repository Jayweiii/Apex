import { DriveGameLazy } from "@/components/drive/DriveGameLazy";

export default async function DriveTrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ trackId: string }>;
  searchParams: Promise<{ car?: string }>;
}) {
  const { trackId } = await params;
  const sp = await searchParams;
  return <DriveGameLazy trackId={trackId} carId={sp.car} />;
}
