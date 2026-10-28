import { redirect } from "next/navigation";

/** Friends management lives under Account → Friends. */
export default function FriendsRedirectPage() {
  redirect("/account");
}
