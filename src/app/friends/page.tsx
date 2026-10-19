import { redirect } from "next/navigation";

/** Friends tab folded into Lap Comparisons → Friends & public filter. */
export default function FriendsRedirectPage() {
  redirect("/lap-comparisons?tab=sessions");
}
