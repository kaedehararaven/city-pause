import { describe, expect, it, vi } from "vitest";
import { resolveDiscoveryOrigin } from "./discoveryOrigin";
const publicCenter = { latitude: 30, longitude: 120, coordinateSystem: "BD-09" as const };
const location = { latitude: 31, longitude: 121, coordinateSystem: "BD-09" as const };

describe("discovery origin independent of goal/candidate lifetime", () => {
  it("keeps the exact public origin across repeated generation without geolocation", async () => {
    const locate = vi.fn(async () => location);
    const signal = new AbortController().signal;
    const origin = await resolveDiscoveryOrigin(null, "public", publicCenter, locate, signal);
    for (let goalChange = 0; goalChange < 3; goalChange++) {
      expect(await resolveDiscoveryOrigin(origin, "reuse", publicCenter, locate, signal)).toBe(origin);
    }
    expect(locate).not.toHaveBeenCalled();
    const changed = await resolveDiscoveryOrigin(origin, "locate", publicCenter, locate, signal);
    expect(changed.location).toBe(location);
    expect(locate).toHaveBeenCalledTimes(1);
  });
  it("locates only on first generation and rejects cancellation before publishing", async () => {
    const controller = new AbortController();
    const locate = vi.fn(async () => { controller.abort(); return location; });
    await expect(resolveDiscoveryOrigin(null, "reuse", publicCenter, locate, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(locate).toHaveBeenCalledTimes(1);
    await expect(resolveDiscoveryOrigin(null, "public", publicCenter, locate, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
