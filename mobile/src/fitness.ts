import type { IconName } from "./components/ui";

export type Kind = "walk" | "run" | "cycle";

export const KIND_INFO: Record<Kind, { label: string; verb: string; icon: IconName; maxKmh: number }> = {
  walk: { label: "Walk", verb: "walk", icon: "walk", maxKmh: 12 },
  run: { label: "Run", verb: "run", icon: "footsteps", maxKmh: 26 },
  cycle: { label: "Ride", verb: "ride", icon: "bicycle", maxKmh: 55 },
};
export const kindInfo = (k: string) => KIND_INFO[k as Kind] ?? KIND_INFO.walk;

/** Distance between two points on Earth in metres. */
export function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);
/** "12:05" or "1:02:09" */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
/** Pace as "5:30 /km" for walking and running; speed as "18.2 km/h" for riding. */
export function fmtPace(kind: string, distM: number, sec: number): string {
  if (distM < 20 || sec < 5) return "·";
  if (kind === "cycle") return `${((distM / 1000) / (sec / 3600)).toFixed(1)} km/h`;
  const perKm = sec / (distM / 1000);
  return `${Math.floor(perKm / 60)}:${String(Math.round(perKm % 60)).padStart(2, "0")} /km`;
}

/** Keep the route small enough to upload: drop points closer than 8 m, then thin evenly to at most `max`. */
export function simplifyRoute(points: [number, number][], max = 500): [number, number][] {
  const kept: [number, number][] = [];
  for (const p of points) if (!kept.length || distanceM(kept[kept.length - 1], p) >= 8) kept.push(p);
  if (points.length > 1 && kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]);
  if (kept.length <= max) return kept;
  const step = (kept.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => kept[Math.round(i * step)]);
}
