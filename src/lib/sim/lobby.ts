/**
 * Apex Sim online lobbies: the shared room (`@/lib/online/room`) with Sim
 * players (name, paint, the host's lap count) and Sim race starts.
 */
import { openRoom, randomId, type RoomHandlers, type RoomStatus } from "@/lib/online/room";
import { pickHost } from "@/lib/rush/net";
import {
  acceptSimStart,
  decodeSimSnapshot,
  distinctSimPaints,
  MAX_DRIVERS,
  readSimPlayer,
  simChannelName,
  START_LEAD_MS,
  type SimPlayer,
  type SimSnapshot,
  type SimStart,
} from "./online";

export { onlineAvailable } from "@/lib/online/room";
export type SimLobbyStatus = RoomStatus;
export type SimLobbyHandlers = RoomHandlers<SimPlayer, SimStart, SimSnapshot>;

export type SimLobby = {
  code: string;
  myId: string;
  /** Change what others see about me (name, paint, lap pick, racing). */
  update: (patch: Partial<Omit<SimPlayer, "id">>) => void;
  /** Host only: start a race for everyone now in the lobby. */
  start: (laps: number) => SimStart | null;
  sendState: (snap: number[]) => void;
  leave: () => void;
};

const SIM_ROOM = {
  channel: simChannelName,
  maxPlayers: MAX_DRIVERS,
  noun: "drivers",
  readPlayer: readSimPlayer,
  acceptStart: acceptSimStart,
  decodeState: decodeSimSnapshot,
};

export function openSimLobby(
  opts: { create: true; me: { name: string; paint: string; laps: number } } | { create: false; code: string; me: { name: string; paint: string } },
  handlers: SimLobbyHandlers,
): SimLobby {
  const me: Omit<SimPlayer, "id"> = { name: opts.me.name, paint: opts.me.paint, laps: opts.create ? opts.me.laps : 0, racing: false };
  const room = openRoom(SIM_ROOM, opts.create ? { create: true, me } : { create: false, code: opts.code, me }, handlers);
  return {
    get code() {
      return room.code;
    },
    myId: room.myId,
    update: (patch) => room.update(patch),
    start: (laps) => {
      const players = room.players();
      if (pickHost(players)?.id !== room.myId) return null;
      const grid = distinctSimPaints(players.slice(0, MAX_DRIVERS).map((p) => ({ id: p.id, name: p.name, paint: p.paint })));
      const msg: SimStart = { raceId: randomId(), laps, grid, startInMs: START_LEAD_MS, from: room.myId };
      room.sendStart(msg);
      return msg;
    },
    sendState: (snap) => room.sendState(snap),
    leave: () => room.leave(),
  };
}
