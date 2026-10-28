import type { SupabaseClient } from "@supabase/supabase-js";

export type FriendshipStatus = "pending" | "accepted" | "blocked";

export type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
};

export async function listMyFriendships(
  client: SupabaseClient,
  userId: string,
): Promise<FriendshipRow[]> {
  const { data, error } = await client
    .from("friendships")
    .select("id, requester_id, addressee_id, status, created_at, updated_at")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FriendshipRow[];
}

export async function requestFriendByEmail(
  client: SupabaseClient,
  email: string,
): Promise<string> {
  const { data, error } = await client.rpc("request_friend_by_email", {
    target_email: email.trim(),
  });
  if (error) throw error;
  return data as string;
}

export async function acceptFriendship(
  client: SupabaseClient,
  friendshipId: string,
): Promise<void> {
  const { error } = await client
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", friendshipId);
  if (error) throw error;
}

export async function removeFriendship(
  client: SupabaseClient,
  friendshipId: string,
): Promise<void> {
  const { error } = await client.from("friendships").delete().eq("id", friendshipId);
  if (error) throw error;
}
