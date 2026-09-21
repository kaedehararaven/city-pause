import { describe, expect, it } from "vitest";
import type { MapLocation, RouteResult } from "../contracts/map";
import { walkingMinutesFromSeconds } from "../contracts/map";
import { buildRecommendations } from "./engine";
import { parseUserIntent } from "./intent";
import { createMockCandidateData } from "./mock";
import { createRealCandidateData } from "./realProvider";
import type { CandidateData, CandidatePlace, UserIntent } from "./model";

const location: MapLocation = { latitude: 39.9, longitude: 116.4, coordinateSystem: "BD-09" };
const intent = (minutes = 30, extra: Partial<UserIntent> = {}): UserIntent => ({
  ...parseUserIntent({ minutes, activity: "auto", text: "", avoidCost: false, nearby: false, returnMode: "return_to_start" }), ...extra,
});
const place = (providerId: string, extra: Partial<CandidatePlace> = {}): CandidatePlace => ({
  source: "mock", provider: "mock", providerId, name: `地点 ${providerId}`, location,
  kind: providerId, costRequired: false, minimumStayMinutes: 5, suggestedStayMinutes: 15, ...extra,
});
function route(from: string, to: string, minutes: number | null, source: "mock" | "real" = "mock"): RouteResult {
  const base = {
    source, provider: source === "real" ? "baidu" as const : "mock" as const,
    mode: "walking" as const, from: { id: from, location }, to: { id: to, location }, coordinateSystem: "BD-09" as const,
  };
  if (minutes === null) return { ...base, status: "provider_error" };
  const seconds = minutes * 60;
  return {
    ...base, status: "success", walkingDistanceMeters: minutes * 75,
    walkingDurationSeconds: seconds, walkingMinutes: walkingMinutesFromSeconds(seconds),
  };
}
const data = (places: CandidatePlace[], routes: Record<string, number | null>): CandidateData => ({
  source: "mock", origin: { id: "o", name: "演示起点", location }, places,
  routes: Object.entries(routes).map(([key, minutes]) => {
    const [from, to] = key.split(":");
    return route(from, to, minutes);
  }),
});

describe("A1 hard constraints and unknown facts", () => {
  const minimum25 = data([place("a", { minimumStayMinutes: 10 })], { "o:a": 6, "a:o": 6 });
  it("rejects a 25-minute minimum when only 15 minutes are available", () => {
    expect(buildRecommendations(intent(15), minimum25)).toEqual([]);
  });
  it("accepts an exact fit including separate outbound, return and buffer", () => {
    const [plan] = buildRecommendations(intent(25), minimum25);
    expect(plan.totalMinutes).toBe(25);
    expect(plan.routes.map((item) => `${item.from.id}:${item.to.id}`)).toEqual(["o:a", "a:o"]);
    expect(plan.steps.reduce((n, s) => n + s.minutes, 0)).toBe(25);
  });
  it("retains unknown category and cost rather than treating them as false", () => {
    const unknown = data([place("a", { kind: undefined, categoryLabel: undefined, costRequired: undefined })], { "o:a": 2, "a:o": 3 });
    const [plan] = buildRecommendations(intent(), unknown);
    expect(plan.costStatus).toBe("unknown");
    expect(plan.places[0].kind).toBeUndefined();
    expect(buildRecommendations(intent(30, { avoidCost: true }), unknown)).toEqual([]);
    expect(buildRecommendations(intent(30, { excludedKinds: ["cafe"] }), unknown)).toEqual([]);
  });
  it("does not guess a missing reverse route from the outbound route", () => {
    const missing = data([place("a")], { "o:a": 2 });
    expect(buildRecommendations(intent(), missing)).toEqual([]);
    expect(buildRecommendations(intent(30, { returnMode: "open_ended" }), missing)).toHaveLength(1);
  });
  it("rejects route failures instead of generating a fake feasible plan", () => {
    const failed = data([place("a")], { "o:a": null, "a:o": 2 });
    expect(buildRecommendations(intent(), failed)).toEqual([]);
  });
  it("uses derived route minutes without allocating beyond the budget", () => {
    const fractional = data([place("a")], { "o:a": 2.2, "a:o": 2.2 });
    const [plan] = buildRecommendations(intent(15), fractional);
    expect(plan.walkingMinutes).toBe(6);
    expect(plan.stayMinutes).toBe(6);
    expect(plan.totalMinutes).toBe(15);
  });
  it("uses stable category semantics rather than matching provider IDs", () => {
    const cafes = data([place("realistic-provider-id", { kind: "cafe" })], { "o:realistic-provider-id": 1, "realistic-provider-id:o": 1 });
    expect(buildRecommendations(intent(30, { excludedKinds: ["cafe"] }), cafes)).toEqual([]);
  });
  it("preserves Mock source and rejects unlabelled runtime data", () => {
    expect(buildRecommendations(intent(), minimum25)[0].source).toBe("mock");
    expect(buildRecommendations(intent(), { ...minimum25, source: undefined } as unknown as CandidateData)).toEqual([]);
  });
});

describe("real Candidate Provider integration", () => {
  const realPoi = {
    source: "real" as const, provider: "baidu" as const, providerId: "real-poi",
    name: "真实地点", location,
  };
  it("feeds one real MapPOI and two directed RouteResults into hard constraints", () => {
    const realData = createRealCandidateData({
      origin: { id: "origin", name: "当前位置", location }, poi: realPoi,
      routes: [route("origin", "real-poi", 4.1, "real"), route("real-poi", "origin", 5.1, "real")],
    });
    const [plan] = buildRecommendations(intent(30), realData);
    expect(plan.source).toBe("real");
    expect(plan.walkingMinutes).toBe(11);
    expect(plan.routes).toHaveLength(2);
    expect(plan.costStatus).toBe("unknown");
  });
  it("does not crash when all optional POI details are missing", () => {
    const realData = createRealCandidateData({
      origin: { id: "origin", name: "当前位置", location }, poi: realPoi,
      routes: [route("origin", "real-poi", 2, "real"), route("real-poi", "origin", 2, "real")],
    });
    expect(() => buildRecommendations(intent(20), realData)).not.toThrow();
  });
  it("filters the real candidate when the real duration exceeds the budget", () => {
    const realData = createRealCandidateData({
      origin: { id: "origin", name: "当前位置", location }, poi: realPoi,
      routes: [route("origin", "real-poi", 10, "real"), route("real-poi", "origin", 10, "real")],
    });
    expect(buildRecommendations(intent(20), realData)).toEqual([]);
  });
});

describe("deterministic strategy selection", () => {
  it("selects three strategies by rules and never repeats the same place combination", () => {
    const input = intent(45);
    const result = buildRecommendations(input, createMockCandidateData());
    expect(result.map(p => p.strategyId)).toEqual(["easy", "balanced", "explore"]);
    expect(result[0].places).toHaveLength(1);
    expect(result[1].places).toHaveLength(2);
    expect(result[2].places).toHaveLength(2);
    expect(new Set(result.map(p => p.places.map(s => s.providerId).sort().join("|"))).size).toBe(3);
    expect(buildRecommendations(input, createMockCandidateData())).toEqual(result);
  });
  it("keeps all rest recommendations to one stop", () => {
    expect(buildRecommendations(intent(45, { activity: "rest" }), createMockCandidateData()).every(p => p.places.length === 1)).toBe(true);
  });
  it("passes 84 combinations of time, activity, return and consumption", () => {
    for (const activity of ["rest", "walk", "explore"] as const)
      for (const minutes of [5, 10, 15, 30, 45, 60, 180])
        for (const back of [true, false]) for (const free of [true, false]) {
          const plans = buildRecommendations(intent(minutes, { activity, returnMode: back ? "return_to_start" : "open_ended", avoidCost: free }), createMockCandidateData());
          expect(plans.length).toBeLessThanOrEqual(3);
          for (const p of plans) {
            expect(p.totalMinutes).toBeLessThanOrEqual(minutes);
            expect(p.steps.reduce((n, s) => n + s.minutes, 0)).toBe(p.totalMinutes);
            expect(p.steps.some(s => s.kind === "返程")).toBe(back);
            expect(p.source).toBe("mock");
            if (free) expect(p.costStatus).toBe("not-required");
          }
        }
  });
});

describe("intent provenance", () => {
  it("defaults to open-ended time", () => {
    const parsed = parseUserIntent({ minutes: 30, activity: "auto", text: "", avoidCost: false, nearby: false });
    expect(parsed.returnMode).toBe("open_ended");
    expect(parsed.source.returnMode).toBe("default");
  });
  it("records user controls separately from natural-language rules", () => {
    const parsed = parseUserIntent({ minutes: 30, activity: "auto", text: "想散散步，不想花钱，最后回来", returnMode: "return_to_start", avoidCost: false, nearby: false });
    expect(parsed.activity).toBe("walk");
    expect(parsed.avoidCost).toBe(true);
    expect(parsed.source.avoidCost).toBe("text-rule");
    expect(parsed.source.availableMinutes).toBe("form");
    expect(parsed.source.returnMode).toBe("form");
  });
});

describe("time semantics contract", () => {
  for (const source of ["mock", "real"] as const) {
    it(`keeps the 24-minute open-ended plan and rejects a 31-minute return plan (${source})`, () => {
      const candidate = data([place("a", { minimumStayMinutes: 15, suggestedStayMinutes: 15 })], {});
      candidate.source = source;
      candidate.places[0].source = source;
      candidate.places[0].provider = source === "real" ? "baidu" : "mock";
      candidate.routes = [route("o", "a", 6, source), route("a", "o", 7, source)];
      const [plan] = buildRecommendations(intent(30, { returnMode: "open_ended" }), candidate);
      expect(plan).toMatchObject({
        returnMode: "open_ended", outboundWalkingMinutes: 6, stayMinutes: 15,
        bufferMinutes: 3, totalMinutes: 24, remainingMinutes: 6, source,
      });
      expect(plan).not.toHaveProperty("returnWalkingMinutes");
      expect(plan.steps.some(step => step.kind === "返程")).toBe(false);
      expect(buildRecommendations(intent(30), candidate)).toEqual([]);
      expect(buildRecommendations(intent(31), candidate)[0]).toMatchObject({
        returnMode: "return_to_start", returnWalkingMinutes: 7,
        totalMinutes: 31, remainingMinutes: 0, source,
      });
      candidate.routes = [route("o", "a", 6, source)];
      expect(buildRecommendations(intent(30, { returnMode: "open_ended" }), candidate)).toHaveLength(1);
      expect(buildRecommendations(intent(60), candidate)).toEqual([]);
      for (const status of ["no_route", "timeout", "provider_error"] as const) {
        candidate.routes = [route("o", "a", 6, source), { ...route("a", "o", null, source), status }];
        expect(buildRecommendations(intent(60), candidate)).toEqual([]);
        expect(buildRecommendations(intent(30, { returnMode: "open_ended" }), candidate)).toHaveLength(1);
      }
    });
  }
});
