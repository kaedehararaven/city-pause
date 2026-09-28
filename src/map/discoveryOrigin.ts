import type { DiscoverySnapshot } from "../contracts/discovery";
import type { MapLocation } from "../contracts/map";

export async function resolveDiscoveryOrigin(
  previous: DiscoverySnapshot["origin"] | null,
  selection: "reuse" | "public" | "locate",
  publicCenter: MapLocation,
  locate: () => Promise<MapLocation>,
  signal: AbortSignal,
): Promise<DiscoverySnapshot["origin"]> {
  signal.throwIfAborted();
  if (selection === "reuse" && previous) return previous;
  const location = selection === "public" ? publicCenter : await locate();
  signal.throwIfAborted();
  return { id: "current-location", name: selection === "public" ? "公开测试起点" : "当前位置", location };
}
