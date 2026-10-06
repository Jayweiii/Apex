import fs from "node:fs/promises";
import path from "node:path";
import { createLocalFsStorage } from "../src/lib/storage/local-fs";
import { hasR2Config } from "../src/lib/storage/env";

async function main() {
  const storage = createLocalFsStorage();
  const key = `test/${Date.now()}-hello.txt`;
  await storage.putObject(key, Buffer.from("apex-storage-ok"), "text/plain");
  const got = await storage.getObject(key);
  if (!got || got.toString("utf8") !== "apex-storage-ok") {
    throw new Error("local storage round-trip failed");
  }
  const url = await storage.getDownloadUrl(key);
  if (!url.includes(encodeURIComponent(key)) && !url.includes(key)) {
    throw new Error(`unexpected download url ${url}`);
  }
  await storage.deleteObject(key);

  const root = path.join(process.cwd(), ".data", "uploads");
  await fs.rm(path.join(root, "test"), { recursive: true, force: true });

  console.log(
    JSON.stringify({
      ok: true,
      localFallback: true,
      r2Configured: hasR2Config(),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
