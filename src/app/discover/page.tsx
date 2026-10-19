import { redirect } from "next/navigation";

/** Legacy path — Discover renamed to Lap Comparisons. */
export default function DiscoverRedirectPage() {
  redirect("/lap-comparisons");
}
