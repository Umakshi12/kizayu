import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { IS_PROD, S3 } from "../config";

// Tests set UPLOAD_DIR so their images never land in the app's uploads folder.
export const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads");
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", mp4: "video/mp4", m4a: "audio/mp4" };

let s3: S3Client | null = null;

/** Saves an image and returns its public URL. S3-compatible storage when configured, else local disk. */
export const saveImage = (buf: Buffer, ext: string, localBaseUrl: string) => saveBinary(buf, ext, MIME[ext] ?? "application/octet-stream", localBaseUrl);

/** Saves any file (image, video clip, audio clip) and returns its public URL. */
export async function saveBinary(buf: Buffer, ext: string, contentType: string, localBaseUrl: string): Promise<string> {
  const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  if (S3.bucket) {
    s3 ??= new S3Client({ region: S3.region, ...(S3.endpoint ? { endpoint: S3.endpoint, forcePathStyle: true } : {}) });
    await s3.send(new PutObjectCommand({ Bucket: S3.bucket, Key: key, Body: buf, ContentType: contentType }));
    const base = S3.publicUrl ?? `https://${S3.bucket}.s3.${S3.region}.amazonaws.com`;
    return `${base.replace(/\/$/, "")}/${key}`;
  }
  if (IS_PROD) console.warn("[storage] S3_BUCKET is not set: saving uploads to local disk, which is not durable in production");
  const name = path.basename(key);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf);
  return `${localBaseUrl}/uploads/${name}`;
}

/** Checks magic bytes so non-images can't be uploaded with an image extension. */
export function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
  const heic = buf.subarray(4, 8).toString() === "ftyp";
  return jpg || png || webp || heic;
}
