import { describe, expect, it, vi } from "vitest";
import { buildMultiStop } from "./builder";
import { fixture, mockEdge } from "./fixtures.test-support";
import type { EdgeRequest } from "./edges";

describe("time-window route expansion", () => {
  it("keeps 90min as a pair and prefers its safe extension from120 without shrinking the pair", async () => {
    const fetchEdge = vi.fn(async (request: EdgeRequest) => mockEdge(request, 60));
    const short = await buildMultiStop({ ...fixture(["book", "shop", "street"], 90), fetchEdge });
    expect(short.routes.every(route => route.stops.length === 2)).toBe(true);
    for (const minutes of [120, 150, 180]) {
      const input = fixture(["book", "shop", "street"], minutes);
      const pair = (await buildMultiStop({ ...input, singles: input.singles.slice(0, 2), fetchEdge })).routes[0];
      const result = await buildMultiStop({ ...input, fetchEdge });
      const route = result.routes[0];
      expect(route.stops).toHaveLength(3);
      expect(route.stops.slice(0, 2).map(s => s.poi.providerId)).toEqual(pair.stops.map(s => s.poi.providerId));
      expect(route.exactDwell.slice(0, 2)).toEqual(pair.exactDwell);
      expect(route.displayDwell.slice(0, 2)).toEqual(pair.displayDwell);
      expect(route.totalMinutes).toBeLessThanOrEqual(minutes);
      expect(result.audit.requests).toBeLessThanOrEqual(6);
    }
  });

  it("does not buy a lower-goal third stop even when time is ample", async () => {
    const result = await buildMultiStop({ ...fixture(["book", "shop", "park"], 180, ["S", "S", "W"]), fetchEdge: async r => mockEdge(r) });
    expect(result.routes[0].stops).toHaveLength(2);
    expect(result.routes[0].weakestGoal).toBe("S");
    expect(result.audit.precheckRejections.extension_goal_downgrade).toBeGreaterThan(0);
  });

  it("keeps a feasible pair when extending would consume its allocated dwell", async () => {
    const result = await buildMultiStop({ ...fixture(["book", "shop", "park"], 120), fetchEdge: async r => mockEdge(r) });
    expect(result.routes[0].stops).toHaveLength(2);
    expect(result.audit.precheckRejections.extension_dwell_protection).toBeGreaterThan(0);
  });

  it("a failed third edge does not remove the pair or trigger extra API budget", async () => {
    const result = await buildMultiStop({ ...fixture(["book", "shop", "street"], 180), fetchEdge: async request =>
      request.from.id === "synthetic-1" && request.to.id === "synthetic-2" ? { ...mockEdge(request), status: "timeout" as const } : mockEdge(request) });
    expect(result.routes[0].stops.map(s => s.poi.providerId)).toEqual(["synthetic-0", "synthetic-1"]);
    expect(result.audit.requests).toBeLessThanOrEqual(6);
  });

  it("rest keeps two stops even in a180min window", async () => {
    const input = fixture(["book", "shop", "street"], 180);
    const result = await buildMultiStop({ ...input, intent: { ...input.intent, activity: "rest", goal: "rest" }, fetchEdge: async r => mockEdge(r) });
    expect(result.routes.every(route => route.stops.length === 2)).toBe(true);
    expect(result.audit.thirdProposalsChecked).toBe(0);
  });
});
