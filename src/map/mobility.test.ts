import { describe, expect, it } from "vitest";
import { idealTravelLimitSeconds, passesTravelGate, travelLimitSeconds } from "../contracts/mobility";
describe("travel gate", () => {
  it("allows baseline through 120 percent for open-ended time", () => {
    const input = { availableMinutes: 30, returnMode: "open_ended" as const };
    expect(idealTravelLimitSeconds(input)).toBe(450);
    expect(travelLimitSeconds(input)).toBe(540);
    expect(passesTravelGate(input, 540)).toBe(true);
    expect(passesTravelGate(input, 541)).toBe(false);
  });
  it("keeps one-third baseline for return mode", () => {
    const input = { availableMinutes: 30, returnMode: "return_to_start" as const };
    expect(idealTravelLimitSeconds(input)).toBe(600);
    expect(travelLimitSeconds(input)).toBe(720);
    expect(passesTravelGate(input, 360, 360)).toBe(true);
    expect(passesTravelGate(input, 360, 360)).toBe(true);
    expect(passesTravelGate(input, 361, 360)).toBe(false);
    expect(passesTravelGate(input, 360, 360 + 360)).toBe(false);
  });
  it("requires a successful independent return route when requested", () => {
    expect(passesTravelGate({ availableMinutes: 30, returnMode: "return_to_start" }, 100)).toBe(false);
  });
});
