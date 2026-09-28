// TEMP DEBUG: observation-only store. Never consumed by business logic.
export type DebugPoint = { latitude: number; longitude: number };
type Sample = DebugPoint & { source: string; observedAt: number; accuracyMeters?: number };
export type LocationDiagnostics = { sdk?: Sample; route?: Sample; visibleSource?: string; plannerSource?: string };
let state: LocationDiagnostics = {};
const listeners = new Set<() => void>();
export const readLocationDiagnostics = () => state;
export function subscribeLocationDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function observeLocation(kind: "sdk" | "route" | "visible" | "planner", point: DebugPoint | null, source: string, accuracyMeters?: number) {
  if (!import.meta.env.DEV) return;
  if (kind === "visible") state = { ...state, visibleSource: source };
  else if (kind === "planner") state = { ...state, plannerSource: source };
  else if (point) state = { ...state, [kind]: { latitude: point.latitude, longitude: point.longitude, source, observedAt: Date.now(), accuracyMeters: typeof accuracyMeters === "number" && Number.isFinite(accuracyMeters) && accuracyMeters >= 0 ? accuracyMeters : undefined } };
  for (const listener of listeners) { try { listener(); } catch { /* Diagnostics cannot interrupt production callbacks. */ } }
}
export function diagnosticDistance(a?: DebugPoint, b?: DebugPoint): number | undefined {
  if (!a || !b) return undefined;
  const radians = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
