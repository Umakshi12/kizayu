import { API_URL } from "./config";

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Requests give up after this long, so the app never hangs forever on a bad connection or a sleeping server. */
const TIMEOUT_MS = 30_000;

export async function api<T = unknown>(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  let res: Response;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch {
    throw new ApiError(0, ctl.signal.aborted ? "The server is taking too long to answer. Check your internet and try again." : "Can't reach Kizayu. Check your internet connection and try again.");
  } finally { clearTimeout(timer); }
  if (res.status === 401 && token) onUnauthorized?.();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const get = <T,>(path: string, timeoutMs?: number) => api<T>("GET", path, undefined, timeoutMs);
export const post = <T,>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const put = <T,>(path: string, body?: unknown) => api<T>("PUT", path, body ?? {});
export const patch = <T,>(path: string, body?: unknown) => api<T>("PATCH", path, body ?? {});
export const del = (path: string) => api<null>("DELETE", path);

/** Upload a local image (base64 from expo-image-picker) and get back a public URL. */
export async function uploadImage(base64: string, uri: string): Promise<string> {
  const ext = (uri.split("?")[0].split(".").pop() ?? "jpg").toLowerCase();
  const r = await post<{ url: string }>("/uploads", { data: base64, ext: ["jpg", "jpeg", "png", "webp", "heic"].includes(ext) ? ext : "jpg" });
  return r.url;
}

/** Image URLs from the server may be relative (e.g. "/uploads/x.png"); resolve them against the API host. */
export const mediaUrl = (u: string | null | undefined): string | undefined =>
  !u ? undefined : u.startsWith("/") ? API_URL + u : u;
