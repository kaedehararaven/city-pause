import { describe, expect, it } from "vitest";
import { selectRouteCandidates } from "./routeValidationPolicy";
import type { DiscoverySnapshot } from "../contracts/discovery";
import { parseUserIntent } from "../recommendation/intent";
const intent = parseUserIntent({ minutes: 30, activity: "auto", text: "", avoidCost: false, nearby: false });
const snapshot = (): DiscoverySnapshot => ({ origin: { id: "o", name: "起点", location: { latitude: 30, longitude: 120, coordinateSystem: "BD-09" } }, searchedCategories: ["cafe", "park"], result: { source: "real", status: "success", categories: [], candidates: ["a", "b"].map(id => ({ poi: { source: "real", provider: "baidu", providerId: id, name: id, location: { latitude: 30, longitude: 120, coordinateSystem: "BD-09" } }, matchedSearchCategories: ["cafe"], discoveryPriority: "medium" })), observations: { searchedQueries: 1, validCount: 2, uniqueCandidates: [] } } });
describe("route preparation supply", () => {
  it("returns every discovered unique candidate and ignores goal and legacy limits", () => {
    const result = selectRouteCandidates({ ...intent, goal: "walk" }, snapshot(), 1);
    expect(result.map(item => item.poi.providerId)).toEqual(["a", "b"]);
  });
});
