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
  const frames = useRef(0);

  useFrame((_, dt) => {
    const car = simRef.current.car;
    const mode = simRef.current.camera;
    if (frames.current === 0) {
      smoothHeading.current = car.heading;
    }
    frames.current += 1;

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

    const back = 14 + Math.min(10, Math.abs(car.speed) * 0.15);
    const height = 5.5 + Math.min(3, Math.abs(car.speed) * 0.05);
    const sh = smoothHeading.current;
    // Stay behind the car in ENU (heading 0 = north).
    const behindEast = -Math.sin(sh) * back;
    const behindNorth = -Math.cos(sh) * back;
    const [bx, by, bz] = enuToThree(
      car.x + behindEast,
      car.y + behindNorth,
      (car.z ?? 0) + height,
    );
    pos.current.set(bx, by, bz);
    // Snap for the first frames so the car isn't a distant speck.
    const follow = frames.current < 4 ? 1 : 1 - Math.exp(-7 * dt);
    camera.position.lerp(pos.current, follow);
    camera.up.set(0, 1, 0);
    const lookTarget = look.current.clone();
    lookTarget.y += 0.6;
    camera.lookAt(lookTarget);
  });

  return null;
}
