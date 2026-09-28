import { describe, expect, it } from "vitest";
import { needMatch } from "./evidence";
describe("recommendation factors", () => {
  it("keeps goal match unresolved until product supplies a verified mapping", () => {
    expect(needMatch("rest", ["cafe"])).toBeNull();
    expect(needMatch("walk", ["park"])).toBeNull();
  });
});
