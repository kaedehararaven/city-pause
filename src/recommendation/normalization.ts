import type { UserIntent } from "./model";
import type { Goal, NormalizedIntent } from "./decisionTypes";
const goals = { rest: "rest", walk: "walk", explore: "discover" } as const;

export function normalizeIntent(intent: UserIntent): NormalizedIntent {
  const explicitActivity = ["button", "form", "text-rule"].includes(intent.source.activity);
  return {
    goal: intent.goal ?? (explicitActivity ? goals[intent.activity] : "flexible"),
    goalSource: intent.goal ? "UserIntent.goal" : explicitActivity ? `activity:${intent.source.activity}` : "default",
    availableMinutes: intent.availableMinutes,
    returnMode: intent.returnMode ?? "open_ended",
    preferences: {
      lowCost: intent.preferences?.lowCost ?? (intent.avoidCost ? "PREFER" : "DONT_CARE"),
      lowWalking: intent.preferences?.lowWalking ?? (intent.nearby ? "PREFER" : "DONT_CARE"),
      quiet: intent.preferences?.quiet ?? "DONT_CARE",
      indoor: intent.preferences?.indoor ?? "DONT_CARE",
      novelty: intent.preferences?.novelty ?? "DONT_CARE",
    },
    ...(intent.maxWalkingMinutes ? { maxWalkingMinutes: { ...intent.maxWalkingMinutes } } : {}),
  };
}

export function validIntent(intent: NormalizedIntent): boolean {
  const max = intent.maxWalkingMinutes;
  return Number.isInteger(intent.availableMinutes) && intent.availableMinutes >= 5 && intent.availableMinutes <= 180 &&
    ["flexible", "rest", "walk", "discover"].includes(intent.goal) &&
    ["open_ended", "return_to_start"].includes(intent.returnMode) &&
    Object.values(intent.preferences).every(value => ["MUST", "PREFER", "DONT_CARE"].includes(value)) &&
    (!max || (max.strength === "MUST" && Number.isFinite(max.value) && max.value >= 0));
}
