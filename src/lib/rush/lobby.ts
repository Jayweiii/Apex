/**
 * Apex Rush online lobbies over Supabase Realtime: one channel per lobby code.
 * Presence is the player list (who is here, their kart, the host's track);
 * broadcast carries the start signal and every racer's kart snapshots.
 * Nothing is stored: a lobby exists while someone is in it. The connection
 * itself (joining, codes, presence) is the shared room in `@/lib/online/room`.
 */
import { onlineAvailable, openRoom, randomId, type RoomHandlers, type RoomStatus } from "@/lib/online/room";
import { sanitizeLook, type KartLook } from "./garage";
import {
  acceptStart,
  cleanName,
  decodeSnapshot,
  distinctPaints,
  lobbyChannelName,
  MAX_PLAYERS,
  pickHost,
  type GridEntry,
  type LobbyPlayer,
  type Snapshot,
  type StartMessage,
} from "./net";

export type { GridEntry, StartMessage };
export { onlineAvailable };

/** From the start tap to GO: everyone loads, flies over the track, counts down. */
export const START_LEAD_MS = 7000;

export type LobbyStatus = RoomStatus;
export type LobbyHandlers = RoomHandlers<LobbyPlayer, StartMessage, Snapshot>;

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

const RUSH_ROOM = {
  channel: lobbyChannelName,
  maxPlayers: MAX_PLAYERS,
  noun: "racers",
  readPlayer: (m: Record<string, unknown>, id: string): LobbyPlayer => ({
    id,
    name: cleanName(String(m.name ?? ""), "Racer"),
    joinedAt: typeof m.joinedAt === "number" ? m.joinedAt : Date.now(),
    look: sanitizeLook(m.look),
    levelId: typeof m.levelId === "string" ? m.levelId : undefined,
    racing: m.racing === true,
  }),
  acceptStart: (payload: unknown, players: LobbyPlayer[]) => acceptStart(payload, players, sanitizeLook),
  decodeState: decodeSnapshot,
};

/**
 * Open a lobby. `create` picks a fresh code (retrying if it is taken);
 * otherwise `code` is joined, and it is an error if nobody is there or it is full.
 */
export function openLobby(
  opts: { create: true; me: { name: string; look: KartLook; levelId: string } } | { create: false; code: string; me: { name: string; look: KartLook } },
  handlers: LobbyHandlers,
): Lobby {
  const me: Omit<LobbyPlayer, "id"> = {
    name: opts.me.name,
    joinedAt: Date.now(),
    look: opts.me.look,
    levelId: opts.create ? opts.me.levelId : undefined,
    racing: false,
  };
  const room = openRoom(RUSH_ROOM, opts.create ? { create: true, me } : { create: false, code: opts.code, me }, handlers);
  return {
    get code() {
      return room.code;
    },
    myId: room.myId,
    update: (patch) => room.update(patch),
    start: (levelId) => {
      const players = room.players();
      const host = pickHost(players);
      if (!host || host.id !== room.myId) return null;
      // Two racers on the same (or a very similar) paint, e.g. both on the default look, get told apart.
      const grid: GridEntry[] = distinctPaints(players.slice(0, MAX_PLAYERS).map((p) => ({ id: p.id, name: p.name, look: p.look })));
      const msg: StartMessage = { raceId: randomId(), levelId, grid, startInMs: START_LEAD_MS, from: room.myId };
      room.sendStart(msg);
      return msg;
    },
    sendState: (snap) => room.sendState(snap),
    leave: () => room.leave(),
  };
}
