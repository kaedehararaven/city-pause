import type { CandidatePlan } from "./model";

// Only the provider's numeric merchant-price field, never inferred ticket cost.
export function merchantPrice(text?: string): number | null {
  if (!text?.trim() || !/^\d+(?:\.\d+)?$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
export function ratingFor(plan: CandidatePlan): number | null {
  const value = plan.places[0]?.rating;
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
}
export function meaningfulMobilityDifference(a: number, b: number): boolean {
  const shorter = Math.min(a, b);
  return a !== b && (shorter === 0 || Math.abs(a - b) >= shorter * 0.2);
}
