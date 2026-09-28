import { describe, expect, it, vi } from "vitest";
import { buildMultiStop } from "./builder";
import { fixture, mockEdge } from "./fixtures.test-support";
import type { EdgeRequest } from "./edges";
import { replayData } from "../demo/replayData";
import { buildDecisionResult } from "../recommendation/engine";
import { parseUserIntent } from "../recommendation/intent";
import { replayMultiData } from "../demo/multiReplay";
import { buildMultiWithSupply } from "./supplement";
import originalCapture from "../demo/public-capture.json";
import { createRealCandidateData } from "../recommendation/realProvider";
import type { DiscoveredCandidate } from "../contracts/discovery";
import type { RouteEndpoint, RouteResult } from "../contracts/map";

describe("180-minute route diagnosis (synthetic cases and public history, no network)", () => {
  it("public walking history keeps at most one route per anchor in original rank order", async () => {
    const intent = parseUserIntent({ minutes: 180, activity: "walk", text: "", avoidCost: false, nearby: false });
    const singles = buildDecisionResult(intent, replayData(intent)).recommendations;
    const result = await buildMultiWithSupply({ intent, singles, ...replayMultiData(intent) });
    expect(result.audit.requests).toBe(0);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.routes.length).toBeLessThanOrEqual(3);
    const ranks = result.routes.map(route => route.stops[0].rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("uses reserved requests for the next anchor after paid failure instead of stopping empty", async () => {
    const input = fixture(["book", "shop", "shop", "shop", "park"], 180);
    const fetchEdge = vi.fn(async (request: EdgeRequest) => mockEdge(request,
      request.from.id === "synthetic-0" && request.to.id !== "synthetic-4" ? 3600 : 120));
    const result = await buildMultiStop({ ...input, fetchEdge });
    expect(result.status).toBe("ok");
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.audit.requests).toBeLessThanOrEqual(6);
    expect(result.audit.anchorAttempts).toHaveLength(3);
    expect(result.audit.anchorAttempts[0].requests).toBe(2);
    expect(result.audit.anchorAttempts[1].outcome).toBe("success");
    expect(result.audit.routeRejections.travel_gate).toBe(2);
  });

  it("can leave 66 minutes because both stops reach their approved dwell maxima", async () => {
    const result = await buildMultiStop({ ...fixture(["park", "book"], 180), fetchEdge: async request => mockEdge(request) });
    const route = result.routes[0];
    expect(route.exactDwell).toEqual([60, 40]);
    expect(route.totalMinutes).toBe(114);
    expect(route.remainingMinutes).toBe(66);
    expect(route.unusedAfterDwellMaxMinutes).toBe(66);
    expect(route.displayRoundingMinutes).toBe(0);
  });

  it("can verify a third stop but remove the route extension under the approved ranking and dedup", async () => {
    const input = fixture(["park", "book", "shop"], 180, ["S", "S", "W"]);
    const result = await buildMultiStop({ ...input, fetchEdge: async request => mockEdge(request) });
    expect(result.audit.verifiedTriples).toBeGreaterThan(0);
    expect(result.audit.removedTriples).toBe(result.audit.verifiedTriples - result.routes.filter(route => route.stops.length === 3).length);
    expect(result.routes[0].stops).toHaveLength(2);
    expect(result.routes[0].remainingMinutes).toBe(66);
  });

  it("rest180 cafe to book uses the approved extended cafe limit rather than leaving50min", async () => {
    const input = fixture(["cafe", "book"], 180);
    const result = await buildMultiStop({ ...input, intent: { ...input.intent, activity: "rest", goal: "rest" }, fetchEdge: async request => mockEdge(request, 18 * 60) });
    expect(result.audit.maxStops).toBe(2);
    expect(result.routes[0].exactDwell[0]).toBeGreaterThan(60);
    expect(result.routes[0].exactDwell[0]).toBeLessThanOrEqual(120);
    expect(result.routes[0].remainingMinutes).toBeLessThan(10);
    expect(result.routes[0].unusedAfterDwellMaxMinutes).toBeCloseTo(0);
    expect(result.audit.verifiedTriples).toBe(0);
  });

  it("counts display rounding separately from genuine unused time", async () => {
    const input = fixture(["park", "book"], 90);
    const result = await buildMultiStop({ ...input, fetchEdge: async request => mockEdge(request, 137) });
    const route = result.routes[0];
    expect(route.unusedAfterDwellMaxMinutes).toBeCloseTo(0);
    expect(route.displayRoundingMinutes).toBeGreaterThan(0);
    expect(route.displayRoundingMinutes).toBeLessThan(10);
    expect(route.displayRoundingMinutes + route.unusedAfterDwellMaxMinutes).toBeCloseTo(route.remainingMinutes);
  });

  it("unused budget recovery does not expand the maximum six second-stop proposals", async () => {
    const input = fixture(["book", "shop", "shop", "shop", "shop", "shop", "shop", "park"], 180);
    const fetchEdge = vi.fn(async (request: EdgeRequest) => mockEdge(request, 3600));
    const result = await buildMultiStop({ ...input, fetchEdge });
    expect(result.status).toBe("search_incomplete");
    expect(result.audit.requests).toBe(6);
    expect(result.audit.secondProposalsChecked).toBe(6);
    expect(result.audit.unusedRequestBudget).toBe(0);
    expect(result.audit.truncated).toBeGreaterThan(0);
    expect(result.audit.anchorAttempts).toHaveLength(3);
  });

  it.each([
    ["rest", 12, 3, "missing_offline_edges"],
    ["walk", 19, 4, "missing_offline_edges"],
    ["explore", 26, 1, "no_feasible_multi_stop"],
  ] as const)("public history %s: %i singles / %i families / %s at180min", async (activity, count, families, status) => {
    const intent = parseUserIntent({ minutes: 180, activity, text: "", avoidCost: false, nearby: false });
    const data = createRealCandidateData({ origin: originalCapture.origin as RouteEndpoint & { name: string },
      discoveredCandidates: originalCapture.pools[activity === "explore" ? "discover" : activity] as DiscoveredCandidate[],
      routes: originalCapture.routes as RouteResult[] });
    const singles = buildDecisionResult(intent, data).recommendations;
    const result = await buildMultiStop({ intent, data, singles });
    expect(singles.length).toBe(count);
    expect(Object.keys(result.audit.familyCounts)).toHaveLength(families);
    expect(result.status).toBe(status);
    expect(result.audit.requests).toBe(0);
  });
});
