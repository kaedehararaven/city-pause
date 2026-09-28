import { describe, expect, it, vi } from "vitest";
import { multiCapture, replayMultiData } from "./multiReplay";
import { replayData, replayInterStopEdges } from "./replayData";
import { parseUserIntent } from "../recommendation/intent";
import { buildDecisionResult } from "../recommendation/engine";
import { buildMultiWithSupply } from "../route-builder/supplement";
import { sameEndpoint, validEdge } from "../route-builder/edges";

describe("captured public inter-stop replay", () => {
  it("compact rest180 uses genuinely classified cafes with extended dwell and no large spare window", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const intent = parseUserIntent({ minutes: 180, activity: "rest", text: "", avoidCost: false, nearby: false });
      const context = replayMultiData(intent);
      const result = await buildMultiWithSupply({ intent, singles: buildDecisionResult(intent, replayData(intent)).recommendations, ...context });
      expect(result.routes).toHaveLength(3);
      for (const route of result.routes) {
        expect(route.stops[0].poi.classifiedPoiTag).toBe("美食;咖啡厅");
        expect(route.stops[0].range.max).toBe(120);
        expect(route.exactDwell[0]).toBeGreaterThan(60);
        expect(route.remainingMinutes).toBeLessThan(10);
        expect(route.totalMinutes).toBeLessThanOrEqual(180);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("stores only real canonical directed edges between recorded public endpoints", () => {
    expect(multiCapture.capturedAt).toBeTruthy();
    expect(multiCapture.requests.search).toBe(0);
    expect(multiCapture.requests.routes).toBe(52);
    expect(multiCapture.edges.length).toBeGreaterThan(0);
    const intent = parseUserIntent({ minutes: 180, activity: "explore", text: "", avoidCost: false, nearby: false });
    const record = replayMultiData(intent);
    const endpoints = [record.data.origin, ...record.storedPois.map(p => ({ id: p.providerId, location: p.location }))];
    for (const edge of replayInterStopEdges) {
      expect(validEdge(edge, { from: edge.from, to: edge.to, destinationUid: edge.to.id }, "real")).toBe(true);
      expect(endpoints.some(p => sameEndpoint(p, edge.from))).toBe(true);
      expect(endpoints.some(p => sameEndpoint(p, edge.to))).toBe(true);
    }
  });

  it("replays both origins without network; compact has verified multi routes at90+", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden in public replay"); });
    vi.stubGlobal("fetch", fetch);
    try {
      for (const scenario of ["compact", "original"] as const) for (const activity of ["rest", "walk", "explore"] as const) for (const minutes of [30, 45, 60, 90, 120, 150, 180]) {
        const intent = parseUserIntent({ minutes, activity, text: "", avoidCost: false, nearby: false });
        const base = replayData(intent, scenario), singles = buildDecisionResult(intent, base).recommendations;
        const before = JSON.stringify(singles), context = replayMultiData(intent, scenario);
        const result = await buildMultiWithSupply({ intent, singles, ...context });
        expect(result.audit.requests).toBe(0);
        expect(JSON.stringify(singles)).toBe(before);
        if (minutes >= (scenario === "compact" ? 90 : 120)) expect(result.routes.length).toBeGreaterThan(0);
        const ranks = result.routes.map(route => route.stops[0].rank);
        expect(new Set(ranks).size).toBe(ranks.length);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        for (const route of result.routes) {
          expect(route.source).toBe("real");
          expect(route.totalMinutes).toBeLessThanOrEqual(minutes);
          expect(new Set(route.stops.map(s => s.family)).size).toBe(route.stops.length);
          expect(sameEndpoint(route.edges[0].from, base.origin)).toBe(true);
          expect(route.stops.every(stop => stop.poi.providerId !== base.origin.id)).toBe(true);
          expect(route.edges.every(edge => replayInterStopEdges.some(record => sameEndpoint(record.from, edge.from) && sameEndpoint(record.to, edge.to)) || base.routes.some(record => sameEndpoint(record.from, edge.from) && sameEndpoint(record.to, edge.to)))).toBe(true);
        }
        if (minutes === 180 && activity === "explore") {
          expect(Object.keys(result.audit.familyCounts).length).toBeGreaterThanOrEqual(3);
        }
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
