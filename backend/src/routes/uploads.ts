import express, { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { PUBLIC_URL } from "../config";
import { HttpError, parse, wrap } from "../util";
import { looksLikeImage, saveImage } from "../services/storage";

export const uploadsRouter = Router();

const ALLOWED = ["jpg", "jpeg", "png", "webp", "heic"];
const MAX_BYTES = 8 * 1024 * 1024;

uploadsRouter.post("/uploads", requireAuth, express.json({ limit: "12mb" }), wrap(async (req, res) => {
  const b = parse(z.object({ data: z.string().min(1), ext: z.string().default("jpg") }), req.body);
  const ext = b.ext.toLowerCase().replace(/^\./, "");
  if (!ALLOWED.includes(ext)) throw new HttpError(400, "Unsupported image type");
  const buf = Buffer.from(b.data.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (buf.length > MAX_BYTES) throw new HttpError(413, "Image is too large (max 8 MB)");
  if (!looksLikeImage(buf)) throw new HttpError(400, "That file isn't a valid image");
  const base = PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
  res.status(201).json({ url: await saveImage(buf, ext === "jpeg" ? "jpg" : ext, base) });
}));
