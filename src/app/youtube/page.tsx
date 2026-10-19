import { redirect } from "next/navigation";

/** Personal YouTube catalog removed from nav; per-session paste remains. */
export default function YoutubeRedirectPage() {
  redirect("/");
}
