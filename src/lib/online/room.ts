/**
 * Online rooms over Supabase Realtime, shared by Apex Rush and Apex Sim: one
 * channel per 4-letter code. Presence is the player list (the presence key is
 * the player id, which the server vouches for); broadcast carries the host's
 * start message and every player's car snapshots. Nothing is stored: a room
 * exists while someone is in it.
 *
 * Each game supplies what its players look like, how to check a start message
 * and how to read a snapshot; this file owns joining, code collisions, the
 * "no such lobby" and "full" answers, and leaving.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { CREATOR_PREFIX, dedupeNames, JOINER_PREFIX, makeLobbyCode, pickHost } from "@/lib/rush/net";

export type RoomStatus = "connecting" | "open" | "closed" | "error";

export type RoomHandlers<P, S, X> = {
  onPlayers: (players: P[], hostId: string | null) => void;
  onStart: (start: S) => void;
  onState: (id: string, snap: X, receivedAt: number) => void;
  onStatus: (status: RoomStatus, message?: string) => void;
};

export type RoomSpec<P extends { id: string; name: string }, S, X> = {
  /** Realtime channel for a code, e.g. `rush:lobby:K7MX`. */
  channel: (code: string) => string;
  maxPlayers: number;
  /** What the players are called in messages ("racers", "drivers"). */
  noun: string;
  /** A player from a presence payload, sanitised. `id` is the presence key. */
  readPlayer: (raw: Record<string, unknown>, id: string) => P;
  /** A start message if it is well formed and from the current host; else null. */
  acceptStart: (payload: unknown, players: P[]) => S | null;
  /** A snapshot from the wire, validated; else null. */
  decodeState: (raw: unknown) => X | null;
};

export type Room<P> = {
  readonly code: string;
  myId: string;
  /** The players as last seen (sorted by id, duplicate names numbered). */
  players: () => P[];
  /** Change what others see about me. */
  update: (patch: Partial<Omit<P, "id">>) => void;
  /** True if I am the host right now. */
  isHost: () => boolean;
  /** Host only: broadcast a start message (the caller builds and checks it). */
  sendStart: (msg: object) => void;
  sendState: (snap: number[]) => void;
  leave: () => void;
};

export function onlineAvailable(): boolean {
  return hasSupabaseConfig();
}

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!client) client = createClient();
  return client;
}

export function randomId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

/**
 * Open a room. `create` picks a fresh code (retrying if it is taken);
 * otherwise `code` is joined, and it is an error if nobody is there or it is full.
 */
export function openRoom<P extends { id: string; name: string }, S, X>(
  spec: RoomSpec<P, S, X>,
  opts: { create: true; me: Omit<P, "id"> } | { create: false; code: string; me: Omit<P, "id"> },
  handlers: RoomHandlers<P, S, X>,
): Room<P> {
  // The creator's id sorts first, so the creator hosts (pickHost: lowest id).
  const myId = (opts.create ? CREATOR_PREFIX : JOINER_PREFIX) + randomId().slice(1);
  let meta = { ...opts.me, id: myId } as P;
  let channel: RealtimeChannel | null = null;
  let code = opts.create ? makeLobbyCode() : opts.code;
  let closed = false;
  let attempts = 0;
  let joinTimer: ReturnType<typeof setTimeout> | undefined;
  let players: P[] = [];

  const playersFrom = (ch: RealtimeChannel): P[] => {
    const state = ch.presenceState<Record<string, unknown>>();
    const out: P[] = [];
    for (const key of Object.keys(state)) {
      const metas = state[key] ?? [];
      // One entry per player (a reconnect can briefly leave two).
      const m = metas[metas.length - 1];
      if (!m) continue;
      // The presence key is vouched for by the server; the id inside the payload is not.
      out.push(spec.readPlayer(m as Record<string, unknown>, key));
    }
    return dedupeNames(out).sort((a, b) => (a.id < b.id ? -1 : 1));
  };

  const room: Room<P> = {
    get code() {
      return code;
    },
    myId,
    players: () => players,
    update: (patch) => {
      meta = { ...meta, ...patch, id: myId };
      if (channel) void channel.track(meta as unknown as Record<string, unknown>);
    },
    isHost: () => pickHost(players)?.id === myId,
    sendStart: (msg) => {
      if (channel) void channel.send({ type: "broadcast", event: "start", payload: { ...msg, from: myId } });
    },
    sendState: (snap) => {
      if (channel) void channel.send({ type: "broadcast", event: "s", payload: { i: myId, s: snap } });
    },
    leave: () => {
      shut();
      handlers.onStatus("closed");
    },
  };

  /** Disconnect without reporting (an error was already reported). */
  function shut() {
    closed = true;
    clearTimeout(joinTimer);
    if (channel) {
      const ch = channel;
      channel = null;
      void ch.untrack().finally(() => void supabase().removeChannel(ch));
    }
  }

  const connect = () => {
    if (closed) return;
    attempts += 1;
    const ch = supabase().channel(spec.channel(code), {
      config: { broadcast: { self: false }, presence: { key: myId } },
    });
    channel = ch;
    let decided = false;
    const decide = () => {
      if (decided || closed || channel !== ch) return;
      const others = players.filter((p) => p.id !== myId);
      if (opts.create && others.length > 0 && attempts < 5) {
        // Someone is already using this code: try another.
        decided = true;
        channel = null;
        void ch.untrack().finally(() => void supabase().removeChannel(ch));
        code = makeLobbyCode();
        connect();
        return;
      }
      if (!opts.create && others.length === 0) {
        decided = true;
        shut();
        handlers.onStatus("error", `No lobby with code ${code}. Check the code, or ask the host to create one.`);
        return;
      }
      if (!opts.create && others.length >= spec.maxPlayers) {
        decided = true;
        shut();
        handlers.onStatus("error", `Lobby ${code} is full (${spec.maxPlayers} ${spec.noun}).`);
        return;
      }
      decided = true;
      handlers.onStatus("open");
      handlers.onPlayers(players, pickHost(players)?.id ?? null);
    };

    ch.on("presence", { event: "sync" }, () => {
      if (channel !== ch) return;
      players = playersFrom(ch);
      if (decided) handlers.onPlayers(players, pickHost(players)?.id ?? null);
      // Joining: as soon as anyone else shows up, the lobby is real.
      else if (!opts.create && players.some((p) => p.id !== myId)) decide();
    });
    ch.on("broadcast", { event: "start" }, ({ payload }) => {
      if (channel !== ch || !decided) return;
      // Only the current host may start a race.
      const msg = spec.acceptStart(payload, players);
      if (msg) handlers.onStart(msg);
    });
    ch.on("broadcast", { event: "s" }, ({ payload }) => {
      if (channel !== ch) return;
      const p = payload as { i?: unknown; s?: unknown };
      const snap = spec.decodeState(p.s);
      if (typeof p.i === "string" && snap) handlers.onState(p.i, snap, performance.now());
    });
    handlers.onStatus("connecting");
    ch.subscribe((status) => {
      if (channel !== ch) return;
      if (status === "SUBSCRIBED") {
        void ch.track(meta as unknown as Record<string, unknown>);
        // Creating: give presence a moment to show anyone already on this code.
        // Joining: wait a little for the host's presence before giving up.
        clearTimeout(joinTimer);
        joinTimer = setTimeout(decide, opts.create ? 900 : 4000);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!decided) {
          decided = true;
          shut();
          handlers.onStatus("error", "Could not reach the online service. Check your connection and try again.");
        }
      }
    });
  };

  // Connect after returning, so callers have the room in hand before any handler runs.
  queueMicrotask(connect);
  return room;
}
