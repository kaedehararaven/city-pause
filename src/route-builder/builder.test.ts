import { describe, expect, it, vi } from "vitest";
import { buildMultiStop } from "./builder";
import { fixture, mockEdge, tags } from "./fixtures.test-support";
import { allocateDwell, geometry } from "./math";
import { familyFor, maxStops } from "./policy";
import { edgeKey, EdgeSession, type EdgeCache, type EdgeRequest } from "./edges";
import { distinctRoutes, rankRoutes } from "./ranking";
import { buildDecisionResult, bufferForBudget } from "../recommendation/engine";
import { replayData } from "../demo/replayData";
import type { MultiRoute } from "./model";

describe("Multi-stop independent policy and math", () => {
  it("maps only real ancestor paths, keeps cafe families separate, leaves unknown unmapped", () => {
    expect(familyFor({ classifiedPoiTag: "旅游景点 > 公园 > 生态公园" })?.family).toBe("green");
    expect(familyFor({ classifiedPoiTag: tags.book })?.family).toBe("interest");
    expect(familyFor({ classifiedPoiTag: tags.bookCafe })?.family).toBe("bookCafe");
    expect(familyFor({ classifiedPoiTag: tags.cat })?.range.min).toBe(60);
    expect(familyFor({ classifiedPoiTag: "教育培训;兴趣培训;咖啡厅" })).toBeUndefined();
    expect(familyFor({ classifiedPoiTag: "咖啡厅" })).toBeUndefined();
  });
  it("respects the product stop limits at every UI budget", () => {
    for (const activity of ["rest", "walk", "explore"] as const) for (const minutes of [30, 45, 60, 90, 120, 150, 180]) {
      expect(maxStops({ ...fixture([], minutes).intent, activity })).toBe(minutes === 30 ? 0 : minutes < 90 || activity === "rest" ? 2 : 3);
    }
  });
  it("matches hand allocation, floors display safely, saturates, rejects invalid input", () => {
    const result = allocateDwell([{ min: 30, max: 60 }, { min: 15, max: 40 }], 65)!;
    expect(result.exact[0]).toBeCloseTo(40.9090909);
    expect(result.exact[1]).toBeCloseTo(24.0909091);
    expect(result.display).toEqual([40, 20]);
    expect(allocateDwell([{ min: 30, max: 60 }], 100)?.exact).toEqual([60]);
    expect(allocateDwell([{ min: 30, max: 30 }], 40)?.exact).toEqual([30]);
    expect(allocateDwell([{ min: 30, max: 60 }], 29)).toBeNull();
    expect(allocateDwell([{ min: 60, max: 30 }], 90)).toBeNull();
    expect(allocateDwell([{ min: 30, max: 60 }], NaN)).toBeNull();
  });
  it("preserves min/max, safe totals and monotonic dwell on thousands of allocations", () => {
    for (const a of Object.values(tags)) for (const b of Object.values(tags)) {
      const ranges = [familyFor({ classifiedPoiTag: a })!.range, familyFor({ classifiedPoiTag: b })!.range];
      let previous: number[] = [];
      for (let minutes = 30; minutes <= 180; minutes++) {
        const available = minutes - bufferForBudget(minutes) - 4;
        const dwell = allocateDwell(ranges, available);
        if (!dwell) continue;
        dwell.exact.forEach((value, index) => {
          expect(value).toBeGreaterThanOrEqual(ranges[index].min);
          expect(value).toBeLessThanOrEqual(ranges[index].max);
          expect(value).toBeGreaterThanOrEqual(previous[index] ?? 0);
          expect(dwell.display[index]).toBeLessThanOrEqual(value);
          expect(dwell.display[index]).toBeGreaterThanOrEqual(ranges[index].min);
        });
        expect(dwell.display.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(available);
        previous = dwell.exact;
      }
    }
  });
  it("uses projected MST/chain; coincident points are UNKNOWN and detours are soft", () => {
    const point = (x: number) => ({ latitude: 30, longitude: 110 + x * 0.001, coordinateSystem: "BD-09" as const });
    expect(geometry([point(0), point(1), point(2), point(3)]).ratio).toBeCloseTo(1);
    expect(geometry([point(0), point(1), point(-1), point(2)]).ratio).toBeCloseTo(0.5);
    expect(geometry([point(0), point(0), point(0)]).ratio).toBeNull();
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) {
      const value = geometry([point(0), point(a), point(b), point(c)]).ratio;
      if (value !== null) { expect(value).toBeGreaterThan(0); expect(value).toBeLessThanOrEqual(1); }
    }
  });
});

describe("bounded greedy construction", () => {
  it("45min can produce two light stops, 30min never calls edges", async () => {
    const fetchEdge = vi.fn(async (request: EdgeRequest) => mockEdge(request));
    const result = await buildMultiStop({ ...fixture(["book", "shop"], 45), fetchEdge });
    expect(result.status).toBe("ok");
    expect(result.routes[0].stops).toHaveLength(2);
    expect(result.routes[0].totalMinutes).toBeLessThanOrEqual(45);
    expect(fetchEdge).toHaveBeenCalledTimes(1);
    fetchEdge.mockClear();
    expect((await buildMultiStop({ ...fixture(["book", "shop"], 30), fetchEdge })).status).toBe("not_applicable");
    expect(fetchEdge).not.toHaveBeenCalled();
  });
  it("60min culture+book and same-family pools fail before API", async () => {
    const fetchEdge = vi.fn(async (request: EdgeRequest) => mockEdge(request));
    for (const input of [fixture(["art", "book"], 60), fixture(["art", "art", "art"], 180)]) {
      expect((await buildMultiStop({ ...input, fetchEdge })).status).toBe("no_feasible_multi_stop");
    }
    expect(fetchEdge).not.toHaveBeenCalled();
  });
  it("cat cafe keeps its 60min floor; 60 fails, 90 can pair with book", async () => {
    const fetchEdge = async (request: EdgeRequest) => mockEdge(request);
    expect((await buildMultiStop({ ...fixture(["cat", "book"], 60), fetchEdge })).routes).toHaveLength(0);
    const route = (await buildMultiStop({ ...fixture(["cat", "book"], 90), fetchEdge })).routes[0];
    expect(route.exactDwell[0]).toBeGreaterThanOrEqual(60);
    expect(route.stops).toHaveLength(2);
  });
  it("scans the full pool for each of the first three anchors even after success", async () => {
    const input = fixture(["art", "book", "park"], 60);
    const fetchEdge = vi.fn(async (request: EdgeRequest) => mockEdge(request));
    const result = await buildMultiStop({ ...input, fetchEdge });
    expect(result.audit.anchorAttempts.map(a => a.rank)).toEqual([0, 1, 2]);
    expect(result.routes[0].stops.map(s => s.poi.providerId)).toEqual(["synthetic-1", "synthetic-2"]);
    expect(fetchEdge).toHaveBeenCalledTimes(1);
    expect(fetchEdge.mock.calls[0][0].from.id).toBe("synthetic-1");
    const same = fixture(["park", "park", "park", "park", "park", "park", "book"], 90);
    const other = await buildMultiStop({ ...same, fetchEdge });
    expect(other.audit.anchorAttempts).toHaveLength(3);
    expect(other.audit.anchorAttempts[0].scanned).toBe(7);
    expect(other.routes).toHaveLength(3);
    expect(other.routes.map(route => route.stops[0].rank)).toEqual([0, 1, 2]);
    expect(other.audit.requests).toBeLessThanOrEqual(6);
  });
  it("allows paid fallback to three anchors while keeping the same six-call ledger", async () => {
    const fetchEdge = vi.fn(async (request: EdgeRequest) => ({ ...mockEdge(request), status: "provider_error" as const }));
    const result = await buildMultiStop({ ...fixture(["book", "shop", "park"], 90), fetchEdge });
    expect(result.status).toBe("provider_unavailable");
    expect(result.audit.anchorAttempts.map(a => a.rank)).toEqual([0, 1, 2]);
    expect(fetchEdge.mock.calls.length).toBeLessThanOrEqual(6);
    expect(new Set(fetchEdge.mock.calls.map(([r]) => r.from.id)).size).toBe(3);
    fetchEdge.mockClear();
    const third = await buildMultiStop({ ...fixture(["art", "art", "book", "shop"], 60), fetchEdge });
    expect(third.audit.anchorAttempts.map(a => a.rank)).toEqual([0, 1, 2]);
    expect(fetchEdge.mock.calls.every(([r]) => r.from.id === "synthetic-2")).toBe(true);
    fetchEdge.mockClear();
    const fourth = await buildMultiStop({ ...fixture(["art", "art", "art", "book", "shop"], 60), fetchEdge });
    expect(fourth.audit.anchorAttempts.map(a => a.rank)).toEqual([0, 1, 2]);
    expect(fetchEdge).not.toHaveBeenCalled();
  });
  it("preserves pairs when extension would squeeze dwell; longer budgets can extend", async () => {
    const fetchEdge = async (request: EdgeRequest) => mockEdge(request);
    const two = await buildMultiStop({ ...fixture(["park", "cafe", "mall"], 90), fetchEdge });
    expect(two.audit.verifiedPairs).toBeGreaterThan(0);
    expect(two.audit.verifiedTriples).toBe(0);
    for (const minutes of [120, 150]) {
      const three = await buildMultiStop({ ...fixture(["park", "book", "cafe"], minutes), fetchEdge });
      expect(three.audit.verifiedPairs).toBeGreaterThan(0);
      if (minutes === 120) expect(three.audit.verifiedTriples).toBe(0);
      else expect(three.audit.verifiedTriples).toBeGreaterThan(0);
      for (const route of three.routes) {
        expect(new Set(route.stops.map(s => s.family)).size).toBe(route.stops.length);
        route.stops.forEach((stop, index) => expect(route.exactDwell[index]).toBeGreaterThanOrEqual(stop.range.min));
        expect(route.exactTotalMinutes).toBeLessThanOrEqual(minutes + 1e-9);
      }
    }
  });
  it("does not reward filling time after max dwell saturation", async () => {
    const result = await buildMultiStop({ ...fixture(["book", "shop"], 180), fetchEdge: async request => mockEdge(request) });
    expect(result.routes[0].exactDwell).toEqual([40, 40]);
    expect(result.routes[0].remainingMinutes).toBe(86);
    expect(result.routes[0].steps.reduce((sum, step) => sum + step.minutes, 0)).toBe(result.routes[0].totalMinutes);
  });
  it("uses summed real seconds for the gate and explicit MUST, not geometric speed", async () => {
    const near = fixture(["book", "shop"], 90);
    const long = await buildMultiStop({ ...near, fetchEdge: async request => mockEdge(request, 30 * 60) });
    expect(long.routes).toHaveLength(0);
    const exact = await buildMultiStop({ ...near, fetchEdge: async request => mockEdge(request, 25 * 60) });
    expect(exact.routes[0].travelSeconds).toBe(27 * 60);
    const must = await buildMultiStop({ ...near, intent: { ...near.intent, maxWalkingMinutes: { strength: "MUST", value: 3 } }, fetchEdge: async request => mockEdge(request) });
    expect(must.routes).toHaveLength(0);
  });
  it("has shared six/twelve budgets, counts failures, keeps both phases bounded", async () => {
    for (const budget of [6, 12] as const) {
      const input = fixture(["book", "shop", "park", "cafe", "mall", "art", "street", "craft", "cat", "bookCafe"], 180);
      const fetchEdge = vi.fn(async (request: EdgeRequest) => mockEdge(request));
      const result = await buildMultiStop({ ...input, fetchEdge, budget });
      expect(fetchEdge.mock.calls.length).toBeLessThanOrEqual(budget);
      expect(result.audit.requests).toBe(fetchEdge.mock.calls.length);
      expect(result.audit.verifiedTriples).toBeGreaterThan(0);
      expect(result.routes.length).toBeLessThanOrEqual(3);
      expect(new Set(fetchEdge.mock.calls.map(([request]) => edgeKey(request))).size).toBe(fetchEdge.mock.calls.length);
      expect(fetchEdge.mock.calls.every(([request]) => request.to.id !== input.data.origin.id)).toBe(true);
    }
  });
  it("keeps valid routes when some API calls fail, rejects mismatched endpoints", async () => {
    let count = 0;
    const result = await buildMultiStop({ ...fixture(["book", "shop", "park"], 90), fetchEdge: async request => ++count === 1 ? { ...mockEdge(request), status: "timeout" } : mockEdge(request) });
    expect(result.status).toBe("ok"); expect(result.audit.failures).toBe(1);
    const invalid = await buildMultiStop({ ...fixture(["book", "shop"], 90), fetchEdge: async request => ({ ...mockEdge(request), to: request.from }) });
    expect(invalid.status).toBe("provider_unavailable");
  });
  it("does not mutate single results and never replaces long-budget singles", async () => {
    const input = fixture(["park", "book", "cafe"], 180);
    const original = JSON.stringify(input);
    await buildMultiStop({ ...input, fetchEdge: async request => mockEdge(request) });
    expect(JSON.stringify(input)).toBe(original);
    expect(buildDecisionResult(input.intent, input.data).recommendations).toEqual(input.singles);
    expect(input.singles).toHaveLength(3);
  });
  it("explicitly skips return mode and cycling, never issues unsupported edges", async () => {
    const input = fixture(["book", "shop"], 90), fetchEdge = vi.fn();
    expect((await buildMultiStop({ ...input, intent: { ...input.intent, returnMode: "return_to_start" }, fetchEdge })).status).toBe("unsupported_mode");
    expect((await buildMultiStop({ ...input, data: { ...input.data, travelMode: "cycling" }, fetchEdge })).status).toBe("unsupported_mode");
    expect(fetchEdge).not.toHaveBeenCalled();
  });
  it("replay remains network-free and does not fabricate inter-POI edges", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    try {
      for (const activity of ["rest", "walk", "explore"] as const) {
        const intent = { ...fixture([], 180).intent, activity };
        const data = replayData(intent), singles = buildDecisionResult(intent, data).recommendations;
        const result = await buildMultiStop({ intent, data, singles });
        expect(result.routes).toHaveLength(0);
        expect(["missing_offline_edges", "no_feasible_multi_stop"]).toContain(result.status);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("edge cache, budget and cancellation", () => {
  const input = () => { const f = fixture(["book", "shop"]); return { from: f.singles[0].routes[0].to, to: f.singles[1].routes[0].to, destinationUid: f.singles[1].places[0].providerId }; };
  it("keys direction, canonical coordinates and entrance UID; respects five-minute TTL", async () => {
    const request = input(), cache: EdgeCache = new Map(), fetchEdge = vi.fn(async (r: EdgeRequest) => mockEdge(r));
    let now = 0;
    const session = () => new EdgeSession({ source: "mock", cache, budget: 6, fetchEdge, now: () => now });
    await session().get(request); await session().get(request);
    expect(fetchEdge).toHaveBeenCalledTimes(1);
    expect(edgeKey(request)).not.toBe(edgeKey({ ...request, from: request.to, to: request.from }));
    expect(edgeKey(request)).not.toBe(edgeKey({ ...request, destinationUid: "another-entrance" }));
    expect(edgeKey(request)).not.toBe(edgeKey({ ...request, from: { ...request.from, location: { ...request.from.location, latitude: 31 } } }));
    now = 300_000;
    await session().get(request);
    expect(fetchEdge).toHaveBeenCalledTimes(2);
  });
  it("deduplicates in-flight and failed edges; parallel calls cannot exceed shared budget", async () => {
    const request = input(), fetchEdge = vi.fn(async (r: EdgeRequest) => ({ ...mockEdge(r), status: "timeout" as const }));
    const session = new EdgeSession({ source: "mock", cache: new Map(), budget: 1, fetchEdge });
    await Promise.all([session.get(request), session.get(request), session.get({ ...request, destinationUid: "other" })]);
    await session.get(request);
    expect(fetchEdge).toHaveBeenCalledTimes(1);
    expect(session.stats.failures).toBe(1); expect(session.stats.budgetDenied).toBe(1);
  });
  it("cancellation stops subsequent requests and discards in-flight results", async () => {
    const controller = new AbortController(), cache: EdgeCache = new Map();
    const fetchEdge = vi.fn(async (request: EdgeRequest) => { controller.abort(); return mockEdge(request); });
    await expect(buildMultiStop({ ...fixture(["book", "shop", "park"], 120), fetchEdge, cache, signal: controller.signal })).rejects.toThrow();
    expect(fetchEdge).toHaveBeenCalledTimes(1); expect(cache.size).toBe(0);
  });
  it("can form a pair entirely from same-direction fresh cache without requesting", async () => {
    const f = fixture(["book", "shop"], 45), request = input();
    const cache: EdgeCache = new Map([[edgeKey(request), { route: mockEdge(request), expiresAt: Date.now() + 60_000 }]]);
    const fetchEdge = vi.fn();
    const result = await buildMultiStop({ ...f, cache, fetchEdge });
    expect(result.status).toBe("ok"); expect(result.audit.cacheHits).toBe(1); expect(fetchEdge).not.toHaveBeenCalled();
  });
});

describe("route quality and route-level dedup", () => {
  async function base() { return (await buildMultiStop({ ...fixture(["book", "shop"], 90), fetchEdge: async request => mockEdge(request) })).routes[0]; }
  it("weakest goal beats averages, then S proportion, never stop count", async () => {
    const route = await base();
    const mm = { ...route, id: "mm", weakestGoal: "M" as const, strongProportion: 0 };
    const sw = { ...route, id: "sw", weakestGoal: "W" as const, strongProportion: 0.5 };
    expect(rankRoutes([sw, mm])[0].id).toBe("mm");
    const sm = { ...mm, id: "sm", strongProportion: 0.5 }, ssm = { ...mm, id: "ssm", strongProportion: 2 / 3 };
    expect(rankRoutes([sm, ssm])[0].id).toBe("ssm");
    expect(rankRoutes([{ ...route, id: "three", stops: [...route.stops, route.stops[0]], geometry: 0.8 }, { ...route, id: "two", geometry: 1 }])[0].id).toBe("two");
  });
  it("fixed mobility groups eliminate cyclic 10/11.5/13 comparisons and honor exact20%", async () => {
    const route = await base();
    const routes = [10, 11.5, 13].map((t, i) => ({ ...route, id: String(t), travelSeconds: t * 60, geometry: 0.8 + i / 10 }));
    expect(rankRoutes(routes).map(r => r.id)).toEqual(["11.5", "10", "13"]);
    expect(rankRoutes([...routes].reverse())).toEqual(rankRoutes(routes));
    expect(rankRoutes([{ ...route, id: "short", travelSeconds: 600, geometry: 0.5 }, { ...route, id: "long", travelSeconds: 720, geometry: 1 }])[0].id).toBe("short");
    expect(rankRoutes([{ ...route, id: "zero", travelSeconds: 0, geometry: null }, { ...route, id: "one", travelSeconds: 1 }])[0].id).toBe("zero");
  });
  it("rating is min when complete and price is mean when complete; unknown stays unknown", async () => {
    const f = fixture(["book", "shop"], 90);
    f.data.places[0].rating = 4.8; f.data.places[1].rating = 4.2;
    f.data.places[0].priceText = "10"; f.data.places[1].priceText = "30";
    const result = await buildMultiStop({ ...f, singles: buildDecisionResult(f.intent, f.data).recommendations, fetchEdge: async request => mockEdge(request) });
    expect(result.routes[0].minRating).toBe(4.2); expect(result.routes[0].meanMerchantPrice).toBe(20);
    f.data.places[1].rating = undefined; f.data.places[1].priceText = undefined;
    const unknown = await buildMultiStop({ ...f, singles: buildDecisionResult(f.intent, f.data).recommendations, fetchEdge: async request => mockEdge(request) });
    expect(unknown.routes[0].minRating).toBeNull(); expect(unknown.routes[0].meanMerchantPrice).toBeNull();
  });
  it("both high ratings defer to lower price; unknown price gets no advantage", async () => {
    const route = await base();
    const expensive = { ...route, id: "expensive", minRating: 4.9, meanMerchantPrice: 30 };
    const cheap = { ...route, id: "cheap", minRating: 4.6, meanMerchantPrice: 10 };
    const unknown = { ...route, id: "unknown", minRating: 4.7, meanMerchantPrice: null };
    expect(rankRoutes([unknown, expensive, cheap]).map(r => r.id)).toEqual(["cheap", "expensive", "unknown"]);
    expect(rankRoutes([{ ...cheap, minRating: 4.5 }, expensive])[0].id).toBe("expensive");
  });
  it("deduplicates unordered POIs, extensions and non-anchor family subsets after ranking", async () => {
    const a = await base(), b = { ...a, id: "reverse", stops: [...a.stops].reverse() };
    expect(distinctRoutes([a, b])).toHaveLength(1);
    const c: MultiRoute = { ...a, id: "extension", stops: [...a.stops, { ...a.stops[1], poi: { ...a.stops[1].poi, providerId: "other" }, family: "green" }] };
    expect(distinctRoutes([c, a])[0].id).toBe("extension");
    expect(distinctRoutes([c, a])).toHaveLength(1);
    expect(distinctRoutes([a, { ...a, id: "same-experience", stops: [a.stops[0], { ...a.stops[1], poi: { ...a.stops[1].poi, providerId: "other-shop" } }] }])).toHaveLength(1);
  });
});
