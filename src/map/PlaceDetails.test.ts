import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapPOI } from "../contracts/map";
const fetchDetail = vi.hoisted(() => vi.fn());
vi.mock("./capabilityClient", () => ({ fetchPlaceDetail: fetchDetail }));
const poi = (id: string): MapPOI => ({ source: "real", provider: "baidu", providerId: id, name: "示例",
  location: { latitude: 30, longitude: 120, coordinateSystem: "BD-09" } });
beforeEach(() => { vi.resetModules(); fetchDetail.mockReset(); });
describe("on-demand place details", () => {
  it("retains details beyond thirty places and respects server expiry", async () => {
    const { loadPlaceDetails } = await import("./PlaceDetails");
    fetchDetail.mockImplementation(async (id: string) => ({ providerId: id, expiresAt: Date.now() + 30_000 }));
    for (let i = 0; i < 40; i++) await loadPlaceDetails(poi(String(i)));
    await loadPlaceDetails(poi("0"));
    expect(fetchDetail).toHaveBeenCalledTimes(40);
    fetchDetail.mockResolvedValue({ providerId: "expired", expiresAt: 0 });
    await loadPlaceDetails(poi("expired"));
    await loadPlaceDetails(poi("expired"));
    expect(fetchDetail).toHaveBeenCalledTimes(42);
  });
  it("coalesces duplicate requests, serializes places and reuses successful details", async () => {
    const { loadPlaceDetails } = await import("./PlaceDetails");
    let active = 0;
    fetchDetail.mockImplementation(async (id: string) => {
      active++; expect(active).toBe(1); await Promise.resolve(); active--;
      return { providerId: id };
    });
    await Promise.all([loadPlaceDetails(poi("a")), loadPlaceDetails(poi("a")), loadPlaceDetails(poi("b"))]);
    await loadPlaceDetails(poi("a"));
    expect(fetchDetail).toHaveBeenCalledTimes(2);
  });
  it("does not cache failure or mismatched identities and allows retry", async () => {
    const { loadPlaceDetails } = await import("./PlaceDetails");
    fetchDetail.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ providerId: "wrong" }).mockResolvedValue({ providerId: "a" });
    await expect(loadPlaceDetails(poi("a"))).rejects.toThrow();
    await expect(loadPlaceDetails(poi("a"))).rejects.toThrow();
    await expect(loadPlaceDetails(poi("a"))).resolves.toMatchObject({ providerId: "a" });
  });
  it("never requests provider data for a mock place", async () => {
    const { loadPlaceDetails } = await import("./PlaceDetails");
    await expect(loadPlaceDetails({ ...poi("a"), source: "mock", provider: "mock" })).rejects.toThrow();
    expect(fetchDetail).not.toHaveBeenCalled();
  });
});
