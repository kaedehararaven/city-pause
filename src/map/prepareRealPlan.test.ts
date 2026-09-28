import { describe, expect, it, vi } from "vitest";
import { prepareRealPlan } from "./prepareRealPlan";
import { buildRecommendations } from "../recommendation/engine";
import { parseUserIntent } from "../recommendation/intent";
import type { DiscoverySnapshot } from "../contracts/discovery";
import type { RouteResult } from "../contracts/map";
import { loadPlaceDetails } from "./placeDetailLoader";
vi.mock("./placeDetailLoader", () => ({ loadPlaceDetails: vi.fn(async (poi: { providerId: string }) => ({ providerId: poi.providerId, overallRating: "4.8", price: "25" })) }));

const location = { latitude: 30, longitude: 120, coordinateSystem: "BD-09" as const };
const intent = (returnMode: "open_ended" | "return_to_start" = "open_ended") => parseUserIntent({ minutes: 30, activity: "auto", text: "", avoidCost: false, nearby: false, returnMode });
const snapshot = (): DiscoverySnapshot => ({
  origin: { id: "origin", name: "起点", location },
  envelope: { mode: "walking", availableMinutes: 30, radiusMeters: 2000, heuristic: true, capped: false },
  searchedCategories: ["cafe", "dessert", "bookstore", "mall", "park", "culture", "lifestyle"],
  result: {
    source: "real", status: "success", categories: [],
    candidates: ["cafe", "park"].map(category => ({
      poi: { source: "real", provider: "baidu", providerId: category, name: category, location },
      matchedSearchCategories: [category as "cafe" | "park"], discoveryPriority: "medium",
    })),
    observations: { searchedQueries: 7, validCount: 2, uniqueCandidates: [] },
  },
});
const route = (from: string, to: string, seconds: number, status: "success" | "no_route" = "success"): RouteResult => status === "no_route" ? { source: "real", provider: "baidu", mode: "walking", from: { id: from, location }, to: { id: to, location }, coordinateSystem: "BD-09", status } : { source: "real", provider: "baidu", mode: "walking", from: { id: from, location }, to: { id: to, location }, coordinateSystem: "BD-09", status, walkingDistanceMeters: seconds, walkingDurationSeconds: seconds, walkingMinutes: Math.ceil(seconds / 60), distanceMeters: seconds, durationSeconds: seconds, durationMinutes: seconds / 60 };

describe("basic real route supply", () => {
  it("reuses unexpired discovery detail without fetching it again during route preparation", async () => {
    const current = snapshot();
    current.result.candidates.forEach(candidate => { candidate.poi.detailExpiresAt = Date.now() + 60_000; candidate.poi.rating = 4.2; });
    vi.mocked(loadPlaceDetails).mockClear();
    const data = await prepareRealPlan(intent(), current, new Map(), new AbortController().signal,
      async ({ from, to }) => route(from.id, to.id, 120), async () => undefined);
    expect(loadPlaceDetails).not.toHaveBeenCalled();
    expect(data.places.every(poi => poi.rating === 4.2)).toBe(true);
  });
  it("requests every discovered candidate without a recommendation quota", async () => {
    const fetcher = vi.fn(async ({ from, to }: { from: { id: string }; to: { id: string } }) => route(from.id, to.id, 120));
    const data = await prepareRealPlan(intent(), snapshot(), new Map(), new AbortController().signal, fetcher, async () => undefined);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(data.places).toHaveLength(2);
    expect(data.places.every(p => p.rating === 4.8 && p.priceText === "25")).toBe(true);
    expect(snapshot().result.candidates.every(p => p.poi.rating === undefined)).toBe(true);
  });
  it("requests return only in return-to-start mode", async () => {
    const fetcher = vi.fn(async ({ from, to }: { from: { id: string }; to: { id: string } }) => route(from.id, to.id, 120));
    await prepareRealPlan(intent("return_to_start"), snapshot(), new Map(), new AbortController().signal, fetcher, async () => undefined);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("keeps real source and lets the engine apply hard feasibility", async () => {
    const data = await prepareRealPlan(intent(), snapshot(), new Map(), new AbortController().signal, async ({ from, to }) => route(from.id, to.id, 120), async () => undefined);
    expect(buildRecommendations(intent(), data).every(plan => plan.source === "real")).toBe(true);
  });
  it("keeps optional detail failure unknown without blocking routes", async () => {
    vi.mocked(loadPlaceDetails).mockRejectedValueOnce(new Error("unavailable"));
    const data = await prepareRealPlan(intent(), snapshot(), new Map(), new AbortController().signal, async ({ from, to }) => route(from.id, to.id, 120), async () => undefined);
    expect(data.places[0].rating).toBeUndefined();
    expect(data.routes).toHaveLength(2);
  });
});
