"use client";

import type { DriveSimSnapshot } from "@/components/drive/scene/sim-bridge";
import { enuToThree } from "@/lib/drive/track-mesh";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import { Vector3 } from "three";

type Props = {
  simRef: MutableRefObject<DriveSimSnapshot>;
  /** World AABB center for top-down framing. */
  boundsCenter: [number, number, number];
  boundsSize: number;
};

/**
 * Chase camera behind the car, smoothed toward heading.
 * Top mode orbits above the whole track.
 */
export function ChaseCamera({ simRef, boundsCenter, boundsSize }: Props) {
  const { camera } = useThree();
  const look = useRef(new Vector3());
  const pos = useRef(new Vector3());
  const smoothHeading = useRef(0);
  const primed = useRef(false);

  useFrame((_, dt) => {
    const car = simRef.current.car;
    const mode = simRef.current.camera;
    if (!primed.current) {
      smoothHeading.current = car.heading;
      primed.current = true;
    }

    let dh = car.heading - smoothHeading.current;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const blend = 1 - Math.exp(-6 * Math.min(0.05, dt));
    smoothHeading.current += dh * blend;

    const [cx, cy, cz] = enuToThree(car.x, car.y, car.z ?? 0);
    look.current.set(cx, cy + 1.1, cz);

    if (mode === "top") {
      const height = Math.max(80, boundsSize * 1.15);
      pos.current.set(boundsCenter[0], height, boundsCenter[2]);
      camera.position.lerp(pos.current, 1 - Math.exp(-4 * dt));
      camera.up.set(0, 1, 0);
      camera.lookAt(boundsCenter[0], 0, boundsCenter[2]);
      return;
    }

    const back = 12 + Math.min(8, Math.abs(car.speed) * 0.12);
    const height = 4.2 + Math.min(2.5, Math.abs(car.speed) * 0.04);
    const sh = smoothHeading.current;
    const behindEast = -Math.sin(sh) * back;
    const behindNorth = -Math.cos(sh) * back;
    const [bx, , bz] = enuToThree(
      car.x + behindEast,
      car.y + behindNorth,
      (car.z ?? 0) + height,
    );
    pos.current.set(bx, (car.z ?? 0) + height, bz);
    camera.position.lerp(pos.current, 1 - Math.exp(-5.5 * dt));
    camera.up.set(0, 1, 0);
    const lookTarget = look.current.clone();
    lookTarget.y += 0.4;
    camera.lookAt(lookTarget);
  });

  return null;
}
