import { describe, expect, it, vi } from "vitest";
import type { DiscoverySnapshot } from "../contracts/discovery";
import type { RouteResult } from "../contracts/map";
import { SEARCH_CATEGORIES } from "../contracts/search";
import { parseUserIntent } from "../recommendation/intent";
import { buildRecommendations } from "../recommendation/engine";
import { prepareRealPlan, selectRouteCandidates } from "./prepareRealPlan";
import type { WalkingRequest } from "./prepareRealPlan";

const location = { latitude: 39.9, longitude: 116.4, coordinateSystem: "BD-09" as const };
const snapshot: DiscoverySnapshot = {
  origin: { id: "origin", name: "测试起点", location },
  searchedCategories: [...SEARCH_CATEGORIES],
  result: {
    source: "real", status: "success", categories: [],
    candidates: SEARCH_CATEGORIES.flatMap(category => [0, 1].map(index => ({
      poi: { source: "real" as const, provider: "baidu" as const, providerId: category + index, name: category + index, location },
      matchedSearchCategories: [category], discoveryPriority: "high" as const,
    }))),
  },
};
const intent = (minutes = 30) => parseUserIntent({ minutes, activity: "auto", text: "", avoidCost: false, nearby: false });
const successful = (request: WalkingRequest, minutes = 6): RouteResult => ({
  status: "success", source: "real", provider: "baidu", mode: "walking",
  from: request.from, to: request.to, coordinateSystem: "BD-09",
  walkingMinutes: minutes, walkingDurationSeconds: minutes * 60, walkingDistanceMeters: minutes * 70,
});
const noPause = async () => undefined;

describe("multi-category real planning", () => {
  it("acquires routes for non-park candidates and keeps the same REAL contract", async () => {
    const fetchRoute = vi.fn(async (request: WalkingRequest) => successful(request));
    const data = await prepareRealPlan(intent(), snapshot, new Map(), new AbortController().signal, fetchRoute, noPause);
    expect(data.places).toHaveLength(6);
    expect(new Set(data.places.map(place => place.providerId.replace(/\d$/, "")))).toEqual(new Set(SEARCH_CATEGORIES));
    expect(fetchRoute).toHaveBeenCalledTimes(6);
    expect(fetchRoute.mock.calls.every(([request]) => request.from.id === "origin")).toBe(true);
    const plans = buildRecommendations(intent(), data);
    expect(plans).toHaveLength(3);
    expect(plans.every(plan => plan.source === "real" && plan.totalMinutes === 30)).toBe(true);
    expect(plans.every(plan => plan.places[0].kind === undefined && plan.costStatus === "unknown")).toBe(true);
    expect(data.discoveredCandidates).toEqual(selectRouteCandidates(intent(), snapshot));
    expect(plans.every(plan => plan.scoreTrace?.categorySource === "discovery")).toBe(true);
    expect(new Set(plans.flatMap(plan => plan.scoreTrace?.categories ?? [])).size).toBe(3);
  });

  it("passes real discovery metadata through routes, hard constraints and A3 preference scoring", async () => {
    const walk = { ...intent(), activity: "walk" as const, source: { ...intent().source, activity: "button" as const } };
    const fetchRoute = vi.fn(async (request: WalkingRequest) => successful(request, request.to.id.startsWith("park") ? 6 : 2));
    const data = await prepareRealPlan(walk, snapshot, new Map(), new AbortController().signal, fetchRoute, noPause);
    expect(new Set(data.discoveredCandidates?.flatMap(candidate => candidate.matchedSearchCategories)).size).toBe(5);
    const plans = buildRecommendations(walk, data);
    expect(plans).toHaveLength(2);
    expect(plans.every(plan => plan.scoreTrace?.categories.includes("park") && plan.scoreTrace.hardConstraints === "passed")).toBe(true);
    expect(fetchRoute.mock.calls.every(([request]) => request.from.id === "origin")).toBe(true);
    expect(data.places.every(place => place.categories === undefined)).toBe(true);
  });

  it("changes the route shortlist with the latest preferences, without searching again", () => {
    const walk = { ...intent(), activity: "walk" as const, source: { ...intent().source, activity: "button" as const } };
    const selected = selectRouteCandidates(walk, snapshot);
    expect(selected.filter(candidate => candidate.matchedSearchCategories.includes("park"))).toHaveLength(2);
    expect(new Set(selected.flatMap(candidate => candidate.matchedSearchCategories))).toEqual(new Set(SEARCH_CATEGORIES));
    expect(selectRouteCandidates(walk, snapshot)).toEqual(selected);
    const rest = { ...intent(), activity: "rest" as const, source: { ...intent().source, activity: "button" as const } };
    expect(new Set(selectRouteCandidates(rest, snapshot).flatMap(candidate => candidate.matchedSearchCategories))).toEqual(new Set(SEARCH_CATEGORIES));
  });

  it("reuses directed routes when time changes and requests return only when explicitly selected", async () => {
    const cache = new Map<string, RouteResult>();
    const fetchRoute = vi.fn(async (request: WalkingRequest) => successful(request, request.to.id === "origin" ? 7 : 6));
    await prepareRealPlan(intent(30), snapshot, cache, new AbortController().signal, fetchRoute, noPause);
    const data60 = await prepareRealPlan(intent(60), snapshot, cache, new AbortController().signal, fetchRoute, noPause);
    // Both budgets retain all categories, so these selected routes are already cached.
    expect(fetchRoute).toHaveBeenCalledTimes(6);
    await prepareRealPlan(intent(60), snapshot, cache, new AbortController().signal, fetchRoute, noPause);
    expect(fetchRoute).toHaveBeenCalledTimes(6);
    expect(buildRecommendations(intent(60), data60)[0]).toMatchObject({ totalMinutes: 60, stayMinutes: 48, bufferMinutes: 6 });
    const back = { ...intent(60), returnMode: "return_to_start" as const };
    const dataBack = await prepareRealPlan(back, snapshot, cache, new AbortController().signal, fetchRoute, noPause);
    expect(fetchRoute).toHaveBeenCalledTimes(12);
    expect(buildRecommendations(back, dataBack)[0]).toMatchObject({ returnWalkingMinutes: 7, stayMinutes: 41, totalMinutes: 60 });
  });

  it("adapts stay and buffer for one place rather than repeating a 39-minute total", async () => {
    const one = { ...snapshot, result: { ...snapshot.result, candidates: [snapshot.result.candidates[8]] } };
    const cache = new Map<string, RouteResult>();
    for (const [budget, stay, buffer] of [[30, 6, 3], [45, 19, 5], [60, 33, 6], [90, 60, 9]]) {
      const data = await prepareRealPlan(intent(budget), one, cache, new AbortController().signal, async request => successful(request, 21), noPause);
      const [plan] = buildRecommendations(intent(budget), data);
      expect(plan).toMatchObject({ totalMinutes: budget, stayMinutes: stay, bufferMinutes: buffer, walkingMinutes: 21, remainingMinutes: 0 });
    }
    const tooShort = await prepareRealPlan(intent(25), one, cache, new AbortController().signal, async request => successful(request, 21), noPause);
    expect(buildRecommendations(intent(25), tooShort)).toEqual([]);
  });

  it("filters failed return routes and retains other feasible places", async () => {
    const back = { ...intent(30), returnMode: "return_to_start" as const };
    const data = await prepareRealPlan(back, snapshot, new Map(), new AbortController().signal, async request => {
      if (request.to.id === "origin" && request.from.id === "bookstore0") {
        return { ...successful(request), status: "no_route" } as RouteResult;
      }
      return successful(request);
    }, noPause);
    expect(buildRecommendations(back, data).every(plan => plan.places.every(place => place.providerId !== "bookstore0"))).toBe(true);
  });

  it("serializes requests, stops after cancellation, and never uses a mock fallback", async () => {
    const controller = new AbortController();
    const fetchRoute = vi.fn(async (request: WalkingRequest) => {
      controller.abort();
      return successful(request);
    });
    await expect(prepareRealPlan(intent(), snapshot, new Map(), controller.signal, fetchRoute, noPause)).rejects.toThrow();
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    await expect(prepareRealPlan(intent(), snapshot, new Map(), new AbortController().signal, async request => ({
      ...successful(request), status: "provider_error",
    } as RouteResult), noPause)).rejects.toThrow("真实去程路线均不可用");
  });

  it("does not request routes for unverifiable free guarantees", async () => {
    const fetchRoute = vi.fn(async (request: WalkingRequest) => successful(request));
    const free = { ...intent(), avoidCost: true };
    const data = await prepareRealPlan(free, snapshot, new Map(), new AbortController().signal, fetchRoute, noPause);
    expect(fetchRoute).not.toHaveBeenCalled();
    expect(data.discoveredCandidates?.length).toBeGreaterThan(0);
    expect(buildRecommendations(free, data)).toEqual([]);
  });
});
