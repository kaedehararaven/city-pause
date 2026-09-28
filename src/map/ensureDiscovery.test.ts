import { describe, expect, it, vi } from "vitest";
import type { DiscoverySnapshot } from "../contracts/discovery";
import { parseUserIntent } from "../recommendation/intent";
import { buildSearchPolicy } from "../recommendation/searchPolicy";
import { discoveryEnvelope } from "./discoveryEnvelope";
import { ensureDiscovery } from "./ensureDiscovery";

const policy = (minutes: number) => buildSearchPolicy(parseUserIntent({ minutes, text: "", activity: "auto", nearby: false, avoidCost: false }));
const snapshot = (minutes: number): DiscoverySnapshot => ({
  origin: { id: "test-origin", name: "合成起点", location: { latitude: 30, longitude: 120, coordinateSystem: "BD-09" } },
  envelope: discoveryEnvelope(minutes), searchedCategories: policy(minutes).entries.map(e => e.category),
  result: { source: "real", status: "success", categories: [], candidates: [] },
});

describe("Planner discovery budget synchronization", () => {
  it("refreshes 15 -> 30 -> 45 -> 60 using the current policy, then reuses the expanded snapshot", async () => {
    const signal = new AbortController().signal;
    const refresh = vi.fn(async (p: ReturnType<typeof policy>) => snapshot(p.availableMinutes));
    let current = snapshot(15);
    for (const minutes of [30, 45, 60]) {
      current = await ensureDiscovery(current, policy(minutes), signal, refresh);
      expect(current.envelope?.radiusMeters).toBe(discoveryEnvelope(minutes).radiusMeters);
      expect(refresh).toHaveBeenLastCalledWith(policy(minutes), signal);
    }
    for (const minutes of [60, 45, 30]) expect(await ensureDiscovery(current, policy(minutes), signal, refresh)).toBe(current);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("refreshes a legacy snapshot or missing category even when its radius is sufficient", async () => {
    const refresh = vi.fn(async () => snapshot(60));
    const signal = new AbortController().signal;
    await ensureDiscovery({ ...snapshot(60), envelope: undefined }, policy(30), signal, refresh);
    await ensureDiscovery({ ...snapshot(60), searchedCategories: [] }, policy(30), signal, refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("does not replace a failed refresh with the old pool or mock data", async () => {
    const refresh = vi.fn(async () => ({ ...snapshot(60), result: { ...snapshot(60).result, status: "error" as const } }));
    await expect(ensureDiscovery(snapshot(15), policy(60), new AbortController().signal, refresh)).rejects.toThrow("搜索未成功");
  });
  it("does not publish a refresh completed after cancellation", async () => {
    const controller = new AbortController();
    const refresh = vi.fn(async () => { controller.abort(); return snapshot(60); });
    await expect(ensureDiscovery(snapshot(15), policy(60), controller.signal, refresh)).rejects.toMatchObject({ name: "AbortError" });
  });
});
