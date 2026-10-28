"use client";

import { ChaseCamera } from "@/components/drive/scene/ChaseCamera";
import { MiataCar } from "@/components/drive/scene/MiataCar";
import type { DriveSimSnapshot } from "@/components/drive/scene/sim-bridge";
import { TrackMesh3D } from "@/components/drive/scene/TrackMesh3D";
import { buildGradeProfile } from "@/lib/drive/elevation";
import {
  createTimerClock,
  silenceUpstreamR3fClockDeprecation,
  type TimerClock,
} from "@/lib/drive/timer-clock";
import { buildTrackMeshBuffers, enuToThree } from "@/lib/drive/track-mesh";
import type { DriveCarState, DrivePoint, DriveTrackPayload } from "@/lib/drive/types";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Clock, Group } from "three";

// R3F store constructs THREE.Clock during Canvas mount (upstream); filter first.
silenceUpstreamR3fClockDeprecation();

type Props = {
  payload: DriveTrackPayload;
  simRef: MutableRefObject<DriveSimSnapshot>;
  carColor: string;
  mobile?: boolean;
  gate: { a: DrivePoint; b: DrivePoint } | null;
};

function SfPylon({ point }: { point: DrivePoint }) {
  const [x, y, z] = enuToThree(point.x, point.y, point.z ?? 0);
  return (
    <mesh position={[x, y + 0.9, z]}>
      <boxGeometry args={[0.35, 1.8, 0.35]} />
      <meshStandardMaterial
        color="#fafafa"
        emissive="#f97316"
        emissiveIntensity={0.35}
      />
    </mesh>
  );
}

function PlayerCar({
  simRef,
  color,
}: {
  simRef: MutableRefObject<DriveSimSnapshot>;
  color: string;
}) {
  const carRef = useRef<DriveCarState>({
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    slip: 0,
    onTrack: true,
    wheelTravel: [0, 0, 0, 0],
  });
  useFrame(() => {
    carRef.current = simRef.current.car;
  });
  return <MiataCar carRef={carRef} color={color} />;
}

function GhostLayer({
  simRef,
}: {
  simRef: MutableRefObject<DriveSimSnapshot>;
}) {
  const g0 = useRef<Group>(null);
  const g1 = useRef<Group>(null);
  useFrame(() => {
    const ghosts = simRef.current.ghosts;
    for (let i = 0; i < 2; i += 1) {
      const node = i === 0 ? g0.current : g1.current;
      const g = ghosts[i];
      if (!node) continue;
      if (!g) {
        node.visible = false;
        continue;
      }
      node.visible = true;
      const [x, y, z] = enuToThree(g.sample.x, g.sample.y, g.sample.z ?? 0);
      node.position.set(x, y, z);
      node.rotation.set(0, -g.heading, 0);
    }
  });
  return (
    <>
      <group ref={g0} visible={false}>
        <MiataCar
          ghost
          localOnly
          opacity={0.55}
          color="#38bdf8"
          car={{
            x: 0,
            y: 0,
            z: 0,
            heading: 0,
            speed: 0,
            slip: 0,
            onTrack: true,
            wheelTravel: [0, 0, 0, 0],
          }}
        />
      </group>
      <group ref={g1} visible={false}>
        <MiataCar
          ghost
          localOnly
          opacity={0.55}
          color="#facc15"
          car={{
            x: 0,
            y: 0,
            z: 0,
            heading: 0,
            speed: 0,
            slip: 0,
            onTrack: true,
            wheelTravel: [0, 0, 0, 0],
          }}
        />
      </group>
    </>
  );
}

function SceneInner({
  payload,
  simRef,
  carColor,
  gate,
}: {
  payload: DriveTrackPayload;
  simRef: MutableRefObject<DriveSimSnapshot>;
  carColor: string;
  gate: { a: DrivePoint; b: DrivePoint } | null;
}) {
  const grades = useMemo(
    () => buildGradeProfile(payload.centerline),
    [payload.centerline],
  );
  const buffers = useMemo(
    () =>
      buildTrackMeshBuffers(payload.centerline, payload.halfWidthM, grades),
    [payload.centerline, payload.halfWidthM, grades],
  );

  const bounds = useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of payload.centerline) {
      const [x, , z] = enuToThree(p.x, p.y, p.z ?? 0);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxZ - minZ, 80);
    return { center: [cx, 0, cz] as [number, number, number], size };
  }, [payload.centerline]);

  return (
    <>
      <color attach="background" args={["#16351a"]} />
      <fog attach="fog" args={["#16351a", 80, 320]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 80, 20]} intensity={1.15} />
      <hemisphereLight args={["#c7e0ff", "#3d5c3a", 0.35]} />

      <TrackMesh3D buffers={buffers} />

      {gate ? (
        <group>
          <SfPylon point={gate.a} />
          <SfPylon point={gate.b} />
        </group>
      ) : null}

      <PlayerCar simRef={simRef} color={carColor} />
      <GhostLayer simRef={simRef} />

      <ChaseCamera
        simRef={simRef}
        boundsCenter={bounds.center}
        boundsSize={bounds.size}
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[bounds.center[0], -0.4, bounds.center[2]]}
      >
        <planeGeometry args={[bounds.size * 4, bounds.size * 4]} />
        <meshStandardMaterial color="#1a3a1e" roughness={1} />
      </mesh>
    </>
  );
}

export function DriveScene({ payload, simRef, carColor, mobile, gate }: Props) {
  const dpr: [number, number] = mobile ? [1, 1.25] : [1, 1.75];
  const timerClockRef = useRef<TimerClock | null>(null);
  useEffect(() => {
    return () => {
      timerClockRef.current?.dispose();
      timerClockRef.current = null;
    };
  }, []);

  return (
    <Canvas
      className="absolute inset-0 h-full w-full touch-none"
      style={{ touchAction: "none", width: "100%", height: "100%" }}
      dpr={dpr}
      gl={{
        antialias: !mobile,
        powerPreference: "high-performance",
        alpha: false,
      }}
      camera={{ fov: 55, near: 0.5, far: 900, position: [0, 8, 18] }}
      frameloop="always"
      onCreated={(state) => {
        // Replace deprecated THREE.Clock (r183+) with THREE.Timer-backed facade.
        timerClockRef.current?.dispose();
        const clock = createTimerClock(document);
        timerClockRef.current = clock;
        state.set({ clock: clock as unknown as Clock });
      }}
    >
      <SceneInner
        payload={payload}
        simRef={simRef}
        carColor={carColor}
        gate={gate}
      />
    </Canvas>
  );
}
