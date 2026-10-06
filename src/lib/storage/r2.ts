import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Config, type R2Config } from "./env";
import type { ObjectStorage, PresignResult, StoragePutResult } from "./types";

function clientFor(config: R2Config) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function createR2Storage(config = getR2Config()): ObjectStorage {
  if (!config) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.",
    );
  }
  const client = clientFor(config);

  return {
    backend: "r2",
    async presignUpload(key, contentType): Promise<PresignResult> {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: 60 * 30 });
      return { key, uploadUrl, backend: "r2" };
    },
    async putObject(key, body, contentType): Promise<StoragePutResult> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: Buffer.from(body),
          ContentType: contentType,
        }),
      );
      return { key, backend: "r2" };
    },
    async getObject(key) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        const bytes = await result.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch {
        return null;
      }
    },
    async getDownloadUrl(key) {
      if (config.publicBaseUrl) {
        return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
      }
      const command = new GetObjectCommand({ Bucket: config.bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: 60 * 60 });
    },
    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
    },
  };
}
