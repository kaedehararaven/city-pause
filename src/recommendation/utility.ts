import type { SearchCategory } from "../contracts/search";

// Compatibility metadata only. No legacy utility/gate/contribution is computed.
export type ScoreTrace = {
  legacy: true;
  version: "0.3";
  hardConstraints: "passed";
  categories: SearchCategory[];
  categorySource: "discovery" | "mock-rule" | "unknown";
};

// Sufficiency against the existing minimum-stay policy, not an experience rating.
// Feasible plans saturate; unallocated extra minutes are not a second mobility reward.
export function activityBenefit(minutes: number, minimumMinutes: number): number {
  return minutes >= minimumMinutes ? 1 : 0;
}
export function mobilityBurden(minutes: number, budget: number): number {
  return Math.min(1, Math.max(0, minutes / budget));
}
