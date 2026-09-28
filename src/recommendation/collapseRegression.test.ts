import { describe, expect, it } from "vitest";
import { buildDecisionResult } from "./engine";
import { createRealCandidateData } from "./realProvider";
import { parseUserIntent } from "./intent";
import { normalizeIntent } from "./normalization";
import type { MapPOI, RouteResult } from "../contracts/map";
const location = { latitude: 30, longitude: 120, coordinateSystem: "BD-09" as const };
const origin = { id: "origin", name: "合成起点", location };
function fixture(seconds: number[], details: Partial<MapPOI>[] = []) {
  const pois: MapPOI[] = seconds.map((_, i) => ({ source: "real", provider: "baidu", providerId: `p${i}`, name: `合成地点${i}`, location, ...details[i] }));
  const routes: RouteResult[] = pois.map((poi, i) => ({ source: "real", provider: "baidu", mode: "walking", coordinateSystem: "BD-09", from: origin, to: { id: poi.providerId, location }, status: "success", walkingDistanceMeters: seconds[i], walkingDurationSeconds: seconds[i], walkingMinutes: Math.ceil(seconds[i] / 60) }));
  return createRealCandidateData({ origin, pois, routes });
}
const intent = (minutes: number) => parseUserIntent({ minutes, activity: "auto", text: "", nearby: false, avoidCost: false });
describe("singleton and stay regressions", () => {
  it("keeps a feasible S park ahead of a much closer W cafe for walking", () => {
    const data = fixture([120, 1080], [
      { classifiedPoiTag: "美食;咖啡厅", rating: 5 },
      { classifiedPoiTag: "旅游景点;公园;城市公园", rating: 3 },
    ]);
    data.discoveredCandidates = data.places.map((poi, i) => ({ poi, matchedSearchCategories: [], discoveryPriority: "high", tagValidation: "matched", goalMatch: i ? "S" : "W" }));
    const walking = { ...intent(60), activity: "walk" as const };
    expect(buildDecisionResult(walking, data).recommendations.map(p => p.id)).toEqual(["p1", "p0"]);
    const parkRoute = data.routes[1];
    if (parkRoute.status !== "success" || parkRoute.mode !== "walking") throw new Error("Expected walking fixture");
    parkRoute.walkingDurationSeconds = 1081;
    parkRoute.walkingMinutes = Math.ceil(1081 / 60);
    const short = buildDecisionResult(walking, data);
    expect(short.recommendations.map(p => p.id)).toEqual(["p0"]);
    expect(short.rejected.find(p => p.candidateId === "p1")?.checks[0].check).toBe("travel_gate");
    expect(buildDecisionResult({ ...walking, availableMinutes: 90 }, data).recommendations.map(p => p.id)).toEqual(["p1", "p0"]);
  });
  it("orders verified S/M/W ahead of mobility without eliminating any feasible place", () => {
    const data = fixture([120, 180, 240], [{ rating: 5, priceText: "1" }, { rating: 4.9 }, { rating: 3 }]);
    data.discoveredCandidates = data.places.map((poi, i) => ({ poi, matchedSearchCategories: [], discoveryPriority: "high", tagValidation: "matched", goalMatch: (["W", "M", "S"] as const)[i] }));
    const result = buildDecisionResult(intent(60), data);
    expect(result.recommendations.map(p => p.id)).toEqual(["p2", "p1", "p0"]);
    expect(result.recommendations.map(p => p.decisionTrace?.goalMatch.classification)).toEqual(["STRONG", "MEDIUM", "WEAK"]);
    expect(result.recommendations).toHaveLength(result.candidates.length);
    data.discoveredCandidates[2].tagValidation = "unknown";
    expect(buildDecisionResult(intent(60), data).recommendations.find(p => p.id === "p2")?.goalMatch).toBeUndefined();
  });
  it("keeps seven similar routes instead of collapsing on seconds alone", () => {
    const result = buildDecisionResult(intent(60), fixture([300, 305, 310, 315, 320, 325, 330]));
    expect(result.candidates).toHaveLength(7);
    expect(result.recommendations).toHaveLength(7);
    expect(result.candidates[0].trace.activeDimensions).toEqual(["needMatch", "mobilityBurden", "rating", "price"]);
  });
  it("preserves slower candidates with known rating or numeric-price advantages", () => {
    const result = buildDecisionResult(intent(60), fixture([300, 360, 420], [{ rating: 4, priceText: "100" }, { rating: 4.8, priceText: "100" }, { rating: 4, priceText: "20" }]));
    expect(result.recommendations).toHaveLength(3);
  });
  it("retains every feasible candidate without Pareto elimination", () => {
    const result = buildDecisionResult(intent(60), fixture([300, 360], [{ rating: 4.8 }, {}]));
    expect(result.recommendations.map(p => p.id)).toEqual(["p0", "p1"]);
    expect(result.supplyAudit.collapse).toBe(false);
    expect(result.candidates.every(c => c.trace.pareto.enabled === false)).toBe(true);
  });
  it("compares price numerically after two ratings above 4.5", () => {
    const result = buildDecisionResult(intent(60), fixture([300, 310], [{ rating: 4.9, priceText: "100" }, { rating: 4.8, priceText: "20" }]));
    expect(result.recommendations.map(p => p.id)).toEqual(["p1", "p0"]);
  });
  it.each([15, 30, 45, 60, 90, 120, 150, 180])("allocates flexible real stay from the %i minute budget", minutes => {
    const [plan] = buildDecisionResult(intent(minutes), fixture([120])).recommendations;
    expect(plan.totalMinutes).toBe(minutes);
    expect(plan.stayMinutes).toBe(minutes - 2 - plan.bufferMinutes);
    expect(plan.remainingMinutes).toBe(0);
    expect(plan.steps.reduce((sum, s) => sum + s.minutes, 0)).toBe(minutes);
  });
  it("respects a non-flexible explicit stay cap", () => {
    const data = fixture([120]); data.places[0].stayAllocation = undefined;
    const [plan] = buildDecisionResult(intent(60), data).recommendations;
    expect(plan.stayMinutes).toBe(15);
    expect(plan.remainingMinutes).toBe(37);
  });
  it.each([["auto", "flexible"], ["rest", "rest"], ["walk", "walk"], ["explore", "discover"]] as const)("preserves %s intent without inventing category match", (activity, goal) => {
    const input = parseUserIntent({ minutes: 60, activity, text: "", avoidCost: false, nearby: false });
    expect(normalizeIntent(input).goal).toBe(goal);
    const result = buildDecisionResult(input, fixture([120]));
    expect(result.candidates[0].trace.dimensions.needMatch?.value).toBeNull();
  });
});
