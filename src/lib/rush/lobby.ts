/**
 * Apex Rush online lobbies over Supabase Realtime: one channel per lobby code.
 * Presence is the player list (who is here, their kart, the host's track);
 * broadcast carries the start signal and every racer's kart snapshots.
 * Nothing is stored: a lobby exists while someone is in it.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { PAINTS, sanitizeLook, type KartLook } from "./garage";
import { cleanName, decodeSnapshot, lobbyChannelName, makeLobbyCode, MAX_PLAYERS, pickHost, type LobbyPlayer, type Snapshot } from "./net";

export type GridEntry = { id: string; name: string; look: KartLook };
export type StartMessage = {
  raceId: string;
  levelId: string;
  grid: GridEntry[];
  /** GO time on the host's wall clock (Date.now ms). */
  goAt: number;
  /** Presence key of the host who sent it; receivers ignore anyone else. */
  from: string;
};

/** From the start tap to GO: everyone loads, flies over the track, counts down. */
export const START_LEAD_MS = 7000;

export type LobbyStatus = "connecting" | "open" | "closed" | "error";

export type LobbyHandlers = {
  onPlayers: (players: LobbyPlayer[], hostId: string | null) => void;
  onStart: (start: StartMessage) => void;
  onState: (id: string, snap: Snapshot, receivedAt: number) => void;
  onStatus: (status: LobbyStatus, message?: string) => void;
};

export type Lobby = {
  code: string;
  myId: string;
  /** Change what others see about me (name, look, track pick, racing). */
  update: (patch: Partial<Omit<LobbyPlayer, "id" | "joinedAt">>) => void;
  /** Host only: start a race for everyone now in the lobby. */
  start: (levelId: string) => StartMessage | null;
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

function playersFrom(channel: RealtimeChannel): LobbyPlayer[] {
  const state = channel.presenceState<LobbyPlayer>();
  const out: LobbyPlayer[] = [];
  for (const key of Object.keys(state)) {
    const metas = state[key] ?? [];
    // One entry per player (a reconnect can briefly leave two).
    const m = metas[metas.length - 1];
    if (!m || typeof m.id !== "string") continue;
    out.push({
      id: m.id,
      name: cleanName(String(m.name ?? ""), "Racer"),
      joinedAt: typeof m.joinedAt === "number" ? m.joinedAt : Date.now(),
      look: sanitizeLook(m.look),
      levelId: typeof m.levelId === "string" ? m.levelId : undefined,
      racing: m.racing === true,
    });
  }
  return out.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

/**
 * Open a lobby. `create` picks a fresh code (retrying if it is taken);
 * otherwise `code` is joined, and it is an error if nobody is there or it is full.
 */
export function openLobby(
  opts: { create: true; me: { name: string; look: KartLook; levelId: string } } | { create: false; code: string; me: { name: string; look: KartLook } },
  handlers: LobbyHandlers,
): Lobby {
  const myId = randomId();
  const joinedAt = Date.now();
  let meta: LobbyPlayer = {
    id: myId,
    name: opts.me.name,
    joinedAt,
    look: opts.me.look,
    levelId: opts.create ? opts.me.levelId : undefined,
    racing: false,
  };
  let channel: RealtimeChannel | null = null;
  let code = opts.create ? makeLobbyCode() : opts.code;
  let closed = false;
  let attempts = 0;
  let joinTimer: ReturnType<typeof setTimeout> | undefined;
  let players: LobbyPlayer[] = [];

  const lobby: Lobby = {
    get code() {
      return code;
    },
    myId,
    update: (patch) => {
      meta = { ...meta, ...patch };
      if (channel) void channel.track(meta);
    },
    start: (levelId) => {
      if (!channel) return null;
      const host = pickHost(players);
      if (!host || host.id !== myId) return null;
      const grid: GridEntry[] = players.slice(0, MAX_PLAYERS).map((p) => ({ id: p.id, name: p.name, look: sanitizeLook(p.look) }));
      // Two racers on the same paint (e.g. both on the default look) get told apart.
      const used = new Set<string>();
      for (const g of grid) {
        if (used.has(g.look.paint)) {
          const free = PAINTS.find((c) => !used.has(c));
          if (free) g.look = { ...g.look, paint: free };
        }
        used.add(g.look.paint);
      }
      const msg: StartMessage = { raceId: randomId(), levelId, grid, goAt: Date.now() + START_LEAD_MS, from: myId };
      void channel.send({ type: "broadcast", event: "start", payload: msg });
      return msg;
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
    const ch = supabase().channel(lobbyChannelName(code), {
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
      if (!opts.create && others.length >= MAX_PLAYERS) {
        decided = true;
        shut();
        handlers.onStatus("error", `Lobby ${code} is full (${MAX_PLAYERS} racers).`);
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
      const p = payload as Partial<StartMessage>;
      // Only the current host may start a race.
      if (typeof p.from !== "string" || p.from !== pickHost(players)?.id) return;
      if (typeof p.raceId !== "string" || typeof p.levelId !== "string" || !Array.isArray(p.grid) || typeof p.goAt !== "number") return;
      const grid = p.grid
        .filter((g): g is GridEntry => !!g && typeof g.id === "string")
        .slice(0, MAX_PLAYERS)
        .map((g) => ({ id: g.id, name: cleanName(String(g.name ?? ""), "Racer"), look: sanitizeLook(g.look) }));
      handlers.onStart({ raceId: p.raceId, levelId: p.levelId, grid, goAt: p.goAt, from: p.from });
    });
    ch.on("broadcast", { event: "s" }, ({ payload }) => {
      if (channel !== ch) return;
      const p = payload as { i?: unknown; s?: unknown };
      const snap = decodeSnapshot(p.s);
      if (typeof p.i === "string" && snap) handlers.onState(p.i, snap, performance.now());
    });
    handlers.onStatus("connecting");
    ch.subscribe((status) => {
      if (channel !== ch) return;
      if (status === "SUBSCRIBED") {
        void ch.track(meta);
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

  // Connect after returning, so callers have the lobby in hand before any handler runs.
  queueMicrotask(connect);
  return lobby;
}
