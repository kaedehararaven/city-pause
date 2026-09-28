import type { TravelMode } from "../contracts/map";

// Search-only heuristics: generous speeds + slack, never route feasibility facts.
export const ENVELOPE_POLICY = { walkingMetersPerSecond: 2, cyclingMetersPerSecond: 6, slack: 1.25, minimumMeters: 400, capMeters: 12000 } as const;
export function discoveryEnvelope(availableMinutes: number, mode: TravelMode = "walking") {
  if (!Number.isInteger(availableMinutes) || availableMinutes < 5 || availableMinutes > 180) throw new RangeError("Invalid discovery budget");
  // Use the larger possible outbound allowance (return trip may be asymmetric).
  const seconds = availableMinutes * 60 / 3;
  const speed = mode === "walking" ? ENVELOPE_POLICY.walkingMetersPerSecond : ENVELOPE_POLICY.cyclingMetersPerSecond;
  return { mode, availableMinutes, radiusMeters: Math.min(ENVELOPE_POLICY.capMeters, Math.max(ENVELOPE_POLICY.minimumMeters, Math.ceil(seconds * speed * ENVELOPE_POLICY.slack))),
    heuristic: true as const, capped: seconds * speed * ENVELOPE_POLICY.slack >= ENVELOPE_POLICY.capMeters };
}
