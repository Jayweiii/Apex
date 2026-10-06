import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage, PresignResult, StoragePutResult } from "./types";

const ROOT = path.join(process.cwd(), ".data", "uploads");

async function ensureParent(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function resolveKey(key: string) {
  const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
  return path.join(ROOT, safe);
}

export function createLocalFsStorage(): ObjectStorage {
  return {
    backend: "local",
    async presignUpload(key, contentType): Promise<PresignResult> {
      return {
        key,
        uploadUrl: `/api/storage/local-upload?key=${encodeURIComponent(key)}`,
        backend: "local",
        localUploadPath: `/api/storage/local-upload?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}`,
      };
    },
    async putObject(key, body, _contentType): Promise<StoragePutResult> {
      const filePath = resolveKey(key);
      await ensureParent(filePath);
      await writeFile(filePath, Buffer.from(body));
      return { key, backend: "local" };
    },
    async getObject(key) {
      try {
        return await readFile(resolveKey(key));
      } catch {
        return null;
      }
    },
    async getDownloadUrl(key) {
      return `/api/storage/download?key=${encodeURIComponent(key)}`;
    },
    async deleteObject(key) {
      try {
        await unlink(resolveKey(key));
      } catch {
        // ignore missing
      }
    },
  };
}
