"use client";

import type { TrackMeshBuffers } from "@/lib/drive/track-mesh";
import { useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Line,
  LineBasicMaterial,
} from "three";

function geoFrom(
  positions: Float32Array,
  indices: Uint32Array,
): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setIndex(new BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

type Props = {
  buffers: TrackMeshBuffers;
};

export function TrackMesh3D({ buffers }: Props) {
  const asphalt = useMemo(
    () => geoFrom(buffers.asphalt, buffers.asphaltIndex),
    [buffers],
  );
  const curb = useMemo(
    () => geoFrom(buffers.curb, buffers.curbIndex),
    [buffers],
  );
  const grass = useMemo(
    () => geoFrom(buffers.grass, buffers.grassIndex),
    [buffers],
  );
  const stripeLine = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(buffers.stripe, 3));
    const mat = new LineBasicMaterial({
      color: "#fafafa",
      transparent: true,
      opacity: 0.35,
    });
    return new Line(geo, mat);
  }, [buffers]);

  return (
    <group>
      <mesh geometry={grass} receiveShadow>
        <meshStandardMaterial color="#2f6b38" side={DoubleSide} roughness={0.95} />
      </mesh>
      <mesh geometry={curb} receiveShadow>
        <meshStandardMaterial color="#c4a574" side={DoubleSide} roughness={0.85} />
      </mesh>
      <mesh geometry={asphalt} receiveShadow>
        <meshStandardMaterial color="#3f3f46" side={DoubleSide} roughness={0.9} />
      </mesh>
      <primitive object={stripeLine} />
    </group>
  );
}
