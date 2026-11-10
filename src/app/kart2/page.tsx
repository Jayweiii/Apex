import { Kart2GameLazy } from "@/components/kart2/Kart2GameLazy";

export const metadata = {
  title: "Apex Kart · Apex",
  description: "A pixel-art 3D kart racer on real circuits, with altitude, drift boosts, and a telemetry ghost.",
};

export default function Kart2Page() {
  return <Kart2GameLazy />;
}
