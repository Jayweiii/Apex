"use client";

import { DRIVE_PHYSICS } from "@/lib/drive/physics";
import { enuToThree } from "@/lib/drive/track-mesh";
import type { DriveCarState } from "@/lib/drive/types";
import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import type { Group, Mesh } from "three";

type Props = {
  /** When provided, pose+suspension are read each frame from this ref. */
  carRef?: MutableRefObject<DriveCarState>;
  /** Static car (ghosts / fallback). */
  car?: DriveCarState;
  color: string;
  opacity?: number;
  ghost?: boolean;
  /** If true, parent group owns world pose — only draw body at local origin. */
  localOnly?: boolean;
};

/**
 * Procedural low-poly Miata-ish body with visible per-wheel suspension travel.
 */
export function MiataCar({
  carRef,
  car,
  color,
  opacity = 1,
  ghost = false,
  localOnly = false,
}: Props) {
  const root = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const cabin = useRef<Mesh>(null);
  const nose = useRef<Mesh>(null);
  const wheels = useRef<Group[]>([]);

  const wb = DRIVE_PHYSICS.wheelbaseM;
  const tw = DRIVE_PHYSICS.trackWidthM;
  const wheelLayout = [
    { x: -tw * 0.5, z: -wb * 0.5 },
    { x: tw * 0.5, z: -wb * 0.5 },
    { x: -tw * 0.5, z: wb * 0.5 },
    { x: tw * 0.5, z: wb * 0.5 },
  ];

  useFrame(() => {
    const state = carRef?.current ?? car;
    if (!state || !root.current) return;
    const travel = state.wheelTravel ?? [0, 0, 0, 0];
    const bodyY =
      0.42 +
      (ghost
        ? 0
        : (travel[0]! + travel[1]! + travel[2]! + travel[3]!) * 0.12);

    if (!localOnly) {
      const [x, y, z] = enuToThree(state.x, state.y, state.z ?? 0);
      root.current.position.set(x, y, z);
      root.current.rotation.set(
        state.pitch ?? 0,
        state.heading,
        -(state.roll ?? 0),
      );
    }

    if (body.current) body.current.position.set(0, bodyY, -0.05);
    if (cabin.current) cabin.current.position.set(0, bodyY + 0.28, 0.25);
    if (nose.current) nose.current.position.set(0, bodyY - 0.02, -1.45);
    for (let i = 0; i < 4; i += 1) {
      const w = wheels.current[i];
      const layout = wheelLayout[i]!;
      if (!w) continue;
      w.position.set(layout.x, 0.28 + travel[i]!, layout.z);
    }
  });

  return (
    <group ref={root}>
      <mesh ref={body} castShadow>
        <boxGeometry args={[1.55, 0.42, 3.15]} />
        <meshStandardMaterial
          color={color}
          transparent={opacity < 1}
          opacity={opacity}
          roughness={0.55}
          metalness={0.25}
        />
      </mesh>
      <mesh ref={cabin}>
        <boxGeometry args={[1.25, 0.32, 1.15]} />
        <meshStandardMaterial
          color="#0f172a"
          transparent={opacity < 1}
          opacity={opacity * 0.85}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
      <mesh ref={nose}>
        <boxGeometry args={[1.35, 0.28, 0.35]} />
        <meshStandardMaterial
          color={color}
          transparent={opacity < 1}
          opacity={opacity}
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
      {wheelLayout.map((w, i) => (
        <group
          key={i}
          ref={(el) => {
            if (el) wheels.current[i] = el;
          }}
          position={[w.x, 0.28, w.z]}
        >
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.28, 0.28, 0.22, 10]} />
            <meshStandardMaterial
              color="#18181b"
              transparent={opacity < 1}
              opacity={opacity}
              roughness={0.9}
            />
          </mesh>
          {!ghost ? (
            <mesh position={[0, 0.18, 0]}>
              <boxGeometry args={[0.06, 0.18, 0.06]} />
              <meshStandardMaterial
                color="#a1a1aa"
                metalness={0.6}
                roughness={0.35}
              />
            </mesh>
          ) : null}
        </group>
      ))}
    </group>
  );
}
