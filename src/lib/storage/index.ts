import { hasR2Config } from "./env";
import { createLocalFsStorage } from "./local-fs";
import { createR2Storage } from "./r2";
import type { ObjectStorage } from "./types";

export type { ObjectStorage, PresignResult, StoragePutResult } from "./types";
export { getR2Config, hasR2Config } from "./env";

export function getObjectStorage(): ObjectStorage {
  if (hasR2Config()) return createR2Storage();
  return createLocalFsStorage();
}

export function storageBackendLabel(): "r2" | "local" {
  return hasR2Config() ? "r2" : "local";
}
