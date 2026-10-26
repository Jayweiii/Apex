import { DriveGameLazy } from "@/components/drive/DriveGameLazy";

export default async function DriveTrackPage({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;
  return <DriveGameLazy trackId={trackId} />;
}
