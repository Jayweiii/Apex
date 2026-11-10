/**
 * Apex Rush levels: the site's real circuits, baked with real elevation
 * (see scripts/bake-rush-tracks.mjs), each with its own look.
 */
import buttonwillow from "./data/buttonwillow-13cw.json";
import streets from "./data/streets-of-willow-cw.json";
import east from "./data/thunderhill-east.json";
import west from "./data/thunderhill-west.json";
import type { RushTrackData } from "./track";

export type RushTheme = {
  id: string;
  skyTop: string;
  skyBottom: string;
  sun: string;
  fog: string;
  grassA: string;
  grassB: string;
  dirt: string;
  rock: string;
  mountain: string;
  mountainFar: string;
  tree: "oak" | "pine" | "joshua";
  treeLeaf: string;
  treeLeafDark: string;
  trunk: string;
  light: string;
  ambient: string;
};

export const THEMES: Record<string, RushTheme> = {
  golden: {
    id: "golden",
    skyTop: "#3a8fd9",
    skyBottom: "#bfe6ff",
    sun: "#fff3b0",
    fog: "#cfe9f7",
    grassA: "#d9b95c",
    grassB: "#c4a148",
    dirt: "#b08a4a",
    rock: "#8d8674",
    mountain: "#b9a05a",
    mountainFar: "#9fb3c8",
    tree: "oak",
    treeLeaf: "#4f8a3a",
    treeLeafDark: "#356b2b",
    trunk: "#5b4026",
    light: "#fff6dd",
    ambient: "#8fa8c9",
  },
  meadow: {
    id: "meadow",
    skyTop: "#2f7fd6",
    skyBottom: "#c9f0ff",
    sun: "#ffffff",
    fog: "#d5f1fb",
    grassA: "#6cc04a",
    grassB: "#58a83d",
    dirt: "#a9844f",
    rock: "#8b8f97",
    mountain: "#4e9a59",
    mountainFar: "#8fb7d6",
    tree: "pine",
    treeLeaf: "#2f7d4f",
    treeLeafDark: "#1f5f3c",
    trunk: "#5a3d28",
    light: "#fffbea",
    ambient: "#90b4d8",
  },
  dusk: {
    id: "dusk",
    skyTop: "#2b2a6b",
    skyBottom: "#ff9e6b",
    sun: "#ffd27a",
    fog: "#f0a987",
    grassA: "#9a8f4f",
    grassB: "#857a43",
    dirt: "#9c6f45",
    rock: "#7d6a66",
    mountain: "#6a4a6e",
    mountainFar: "#a5668a",
    tree: "oak",
    treeLeaf: "#5d7a3a",
    treeLeafDark: "#3f5a2c",
    trunk: "#4a3324",
    light: "#ffd9a8",
    ambient: "#8a7fb5",
  },
  mojave: {
    id: "mojave",
    skyTop: "#1f6fc9",
    skyBottom: "#ffe2b8",
    sun: "#fff1c1",
    fog: "#f5dcb8",
    grassA: "#dcb47a",
    grassB: "#c99e66",
    dirt: "#b98352",
    rock: "#a0775a",
    mountain: "#b5704f",
    mountainFar: "#c9a29a",
    tree: "joshua",
    treeLeaf: "#7a9a4a",
    treeLeafDark: "#5c7a38",
    trunk: "#6b5236",
    light: "#fff2d6",
    ambient: "#a9a0b8",
  },
};

export type RushLevel = {
  id: string;
  data: RushTrackData;
  theme: RushTheme;
  tagline: string;
  /** 1 (easy) … 3 (hard). */
  difficulty: number;
};

export const RUSH_LEVELS: RushLevel[] = [
  { id: "thunderhill-west", data: west as RushTrackData, theme: THEMES.golden!, tagline: "Rolling golden hills and blind crests", difficulty: 2 },
  { id: "streets-of-willow-cw", data: streets as RushTrackData, theme: THEMES.mojave!, tagline: "Tight desert switchbacks", difficulty: 3 },
  { id: "buttonwillow-13cw", data: buttonwillow as RushTrackData, theme: THEMES.dusk!, tagline: "Fast valley sweepers at sunset", difficulty: 1 },
  { id: "thunderhill-east", data: east as RushTrackData, theme: THEMES.meadow!, tagline: "The long one: big climbs, big speed", difficulty: 2 },
];

export function levelById(id: string): RushLevel | null {
  return RUSH_LEVELS.find((l) => l.id === id) ?? null;
}
