import { describe, expect, it, vi } from "vitest";
import { createPlaceDetailCache } from "./placeDetailCache";
import { BaiduProviderError } from "./baiduMapService";

const pause = async () => {};
describe("shared short-lived detail cache", () => {
  it("shares batch results with single requests and does not lose cached identities", async () => {
    const single = vi.fn(async (uid: string) => ({ name: uid }));
    const bulk = vi.fn(async (uids: string[]) => new Map(uids.filter(uid => uid !== "missing").map(uid => [uid, { name: uid }])));
    const get = createPlaceDetailCache(single, () => 0, pause, bulk);
    const batch = get.batch(["a", "b", "missing"]);
    const a = get("a");
    const results = await batch;
    expect(results.map(r => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(await a).toMatchObject({ name: "a" });
    await get("b");
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });
  it("coalesces concurrent clients and preserves original expiry", async () => {
    let now = 100;
    const load = vi.fn(async (uid: string) => ({ name: uid }));
    const get = createPlaceDetailCache(load, () => now, pause);
    const [a, b] = await Promise.all([get("a"), get("a")]);
    expect(a).toEqual(b);
    now += 200_000;
    expect(await get("a")).toEqual(a);
    expect(load).toHaveBeenCalledTimes(1);
    now += 100_001;
    expect((await get("a")).observedAt).toBe(now);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("evicts one least recently used entry instead of clearing the cache", async () => {
    const load = vi.fn(async (uid: string) => ({ name: uid }));
    const get = createPlaceDetailCache(load, () => 0, pause);
    for (let i = 0; i < 256; i++) await get(String(i));
    await get("0");
    await get("256");
    await get("0");
    expect(load).toHaveBeenCalledTimes(257);
    await get("1");
    expect(load).toHaveBeenCalledTimes(258);
  });
  it("stops queued misses after quota refusal, still serves fresh cache, and permits recovery", async () => {
    let now = 0;
    const load = vi.fn(async (uid: string) => {
      if (uid !== "good" && now < 60_000) throw new BaiduProviderError("rejected", 302);
      return { name: uid };
    });
    const get = createPlaceDetailCache(load, () => now, pause);
    await get("good");
    const failed = await Promise.allSettled([get("bad"), get("queued")]);
    expect(failed.every(item => item.status === "rejected")).toBe(true);
    await get("good");
    expect(load).toHaveBeenCalledTimes(2);
    now = 60_001;
    await get("bad");
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("does not cache ordinary failures", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValue({ name: "good" });
    const get = createPlaceDetailCache(load, Date.now, pause);
    await expect(get("a")).rejects.toThrow();
    await expect(get("a")).resolves.toMatchObject({ name: "good" });
  });
});
