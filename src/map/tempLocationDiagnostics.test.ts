import { describe, expect, it } from "vitest";
import { diagnosticDistance, observeLocation, readLocationDiagnostics } from "./tempLocationDiagnostics";

describe("TEMP DEBUG location diagnostics", () => {
  it("preserves reported SDK accuracy without inventing missing precision", () => {
    const point = { latitude: 0, longitude: 0 };
    observeLocation("sdk", point, "SDK", 80);
    expect(readLocationDiagnostics().sdk?.accuracyMeters).toBe(80);
    observeLocation("sdk", point, "SDK");
    expect(readLocationDiagnostics().sdk?.accuracyMeters).toBeUndefined();
    observeLocation("sdk", point, "SDK", -1);
    expect(readLocationDiagnostics().sdk?.accuracyMeters).toBeUndefined();
  });
  it("reports missing values and calculates distances without mutating inputs", () => {
    const a = Object.freeze({ latitude: 0, longitude: 0 });
    expect(diagnosticDistance(a, undefined)).toBeUndefined();
    expect(diagnosticDistance(a, a)).toBe(0);
    expect(diagnosticDistance(a, { latitude: 0, longitude: 1 })).toBeCloseTo(111195.08, 1);
  });
  it("copies observations and keeps legacy visible origin separate from route origin", () => {
    const origin = { latitude: 1, longitude: 2 };
    observeLocation("route", origin, "actual snapshot");
    observeLocation("planner", null, "discovery");
    origin.latitude = 3;
    observeLocation("sdk", origin, "legacy SDK");
    observeLocation("visible", null, "legacy");
    const state = readLocationDiagnostics();
    expect(state.route?.latitude).toBe(1);
    expect(state.sdk?.latitude).toBe(3);
    expect(state.plannerSource).toBe("discovery");
    expect(state.visibleSource).toBe("legacy");
  });
});
