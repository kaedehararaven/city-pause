import type { MapLocation } from "../contracts/map";
import type { DwellRange } from "./policy";

export function allocateDwell(ranges: readonly DwellRange[], availableMinutes: number) {
  if (!Number.isFinite(availableMinutes) || ranges.some(r => !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min < 0 || r.max < r.min)) return null;
  const minimum = ranges.reduce((sum, r) => sum + r.min, 0);
  if (availableMinutes < minimum) return null;
  const width = ranges.reduce((sum, r) => sum + r.max - r.min, 0);
  const alpha = width === 0 ? 0 : Math.min(1, (availableMinutes - minimum) / width);
  const exact = ranges.map(r => r.min + alpha * (r.max - r.min));
  const display = exact.map((value, index) => Math.max(ranges[index].min, 5 * Math.floor(value / 5)));
  return { alpha, exact, display };
}

export function validLocation(p: MapLocation) {
  return p.coordinateSystem === "BD-09" && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
    Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
}

export function geometry(locations: readonly MapLocation[]): { ratio: number | null; chainMeters: number; mstMeters: number } {
  if (locations.length < 2 || locations.some(p => !validLocation(p))) return { ratio: null, chainMeters: 0, mstMeters: 0 };
  const base = locations[0], radians = Math.PI / 180, radius = 6371000;
  const latitude = locations.reduce((sum, p) => sum + p.latitude, 0) / locations.length;
  const points = locations.map(p => ({ x: (p.longitude - base.longitude) * radians * radius * Math.cos(latitude * radians), y: (p.latitude - base.latitude) * radians * radius }));
  const distance = (a: number, b: number) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  const chainMeters = points.slice(1).reduce((sum, _, index) => sum + distance(index, index + 1), 0);
  if (chainMeters === 0) return { ratio: null, chainMeters, mstMeters: 0 };
  const visited = new Set([0]);
  let mstMeters = 0;
  while (visited.size < points.length) {
    let shortest = Infinity, next = -1;
    for (const a of visited) for (let b = 0; b < points.length; b++) {
      if (!visited.has(b) && distance(a, b) < shortest) { shortest = distance(a, b); next = b; }
    }
    visited.add(next); mstMeters += shortest;
  }
  return { ratio: Math.min(1, mstMeters / chainMeters), chainMeters, mstMeters };
}
