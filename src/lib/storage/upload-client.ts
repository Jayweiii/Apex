export type UploadTarget = {
  key: string;
  uploadUrl: string;
  backend: "r2" | "local";
  localUploadPath?: string;
  sessionId?: string;
};

export async function presignUpload(input: {
  filename: string;
  contentType: string;
  kind: "raw" | "video";
  sessionId?: string;
}): Promise<UploadTarget> {
  const response = await fetch("/api/storage/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "Could not prepare upload");
  }
  return response.json();
}

export async function uploadToTarget(target: UploadTarget, file: Blob) {
  const url = target.localUploadPath || target.uploadUrl;
  const response = await fetch(url, {
    method: target.backend === "local" ? "PUT" : "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error("Upload to object storage failed");
  }
}
