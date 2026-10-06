export type StoragePutResult = {
  key: string;
  backend: "r2" | "local";
};

export type PresignResult = {
  key: string;
  uploadUrl: string;
  backend: "r2" | "local";
  /** When backend is local, the client POSTs the file bytes to this same-origin path. */
  localUploadPath?: string;
};

export interface ObjectStorage {
  backend: "r2" | "local";
  presignUpload(key: string, contentType: string): Promise<PresignResult>;
  putObject(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<StoragePutResult>;
  getObject(key: string): Promise<Buffer | null>;
  getDownloadUrl(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
