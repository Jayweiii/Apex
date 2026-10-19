import { redirect } from "next/navigation";

/** Short share entrypoint that deep-links into a session or comparison. */
export default async function ShareRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ lap?: string; ref?: string; other?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  if (query.lap) {
    redirect(`/sessions/${sessionId}?lap=${encodeURIComponent(query.lap)}`);
  }
  if (query.ref && query.other) {
    redirect(
      `/sessions/${sessionId}/compare?ref=${encodeURIComponent(query.ref)}&other=${encodeURIComponent(query.other)}`,
    );
  }
  redirect(`/sessions/${sessionId}`);
}
