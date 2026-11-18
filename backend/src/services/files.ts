import fs from "fs";
import path from "path";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { S3 } from "../config";
import { UPLOAD_DIR } from "./storage";

let s3: S3Client | null = null;

/** Best-effort removal of an uploaded image (local disk or S3). Never throws. */
export async function deleteStoredFile(url: string | null | undefined) {
  if (!url) return;
  try {
    const local = url.match(/\/uploads\/([\w.-]+)$/);
    if (local && !S3.bucket) {
      await fs.promises.rm(path.join(UPLOAD_DIR, path.basename(local[1])), { force: true });
      return;
    }
    if (S3.bucket) {
      const key = url.match(/(uploads\/\d{4}-\d{2}-\d{2}\/[\w.-]+)$/)?.[1];
      if (!key) return;
      s3 ??= new S3Client({ region: S3.region, ...(S3.endpoint ? { endpoint: S3.endpoint, forcePathStyle: true } : {}) });
      await s3.send(new DeleteObjectCommand({ Bucket: S3.bucket, Key: key }));
    }
  } catch (e) {
    console.warn("[files] delete failed:", (e as Error).message);
  }
}
