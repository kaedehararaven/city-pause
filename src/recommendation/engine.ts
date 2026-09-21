import { isSuccessfulRoute, walkingMinutesFromSeconds } from "../contracts/map";
import type { SuccessfulRouteResult } from "../contracts/map";
import type { CandidateData, CandidatePlace, CandidatePlan, Recommendation, UserIntent, PlanStep } from "./model";

type StrategyId = Recommendation["strategyId"];
const strategies: { id: StrategyId; label: string; reason: string }[] = [
  { id: "easy", label: "轻松一点", reason: "先比较步行时间，再比较可停留时间" },
  { id: "balanced", label: "松弛漫步", reason: "优先两站且步行与停留都留有空间" },
  { id: "explore", label: "多看一眼", reason: "优先不同类别的两个地点，再比较步行时间" },
];
const restStrategies = [
  { id: "easy", label: "轻松一点", reason: "先比较步行时间，少移动优先" },
  { id: "balanced", label: "多待一会儿", reason: "先比较可停留时间，能休息更久优先" },
  { id: "explore", label: "换个角落", reason: "仍只安排一个地点，提供另一处可行选择" },
] satisfies typeof strategies;

export function buildRecommendations(intent: UserIntent, data: CandidateData): Recommendation[] {
  const budget = intent.availableMinutes;
  if (!Number.isInteger(budget) || budget < 5 || budget > 180) return [];
  if (data.source !== "mock" && data.source !== "real") return [];
  const { origin } = data;
  const routeCache = new Map<string, SuccessfulRouteResult | null>();
  const routeFor = (from: string, to: string) => {
    const key = JSON.stringify([from, to]);
    if (!routeCache.has(key)) {
      const route = data.routes.find(
        (candidate) => candidate.from.id === from && candidate.to.id === to,
      );
      routeCache.set(
        key,
        route && isSuccessfulRoute(route) &&
          route.source === data.source &&
          Number.isFinite(route.walkingDistanceMeters) &&
          Number.isFinite(route.walkingDurationSeconds) &&
          Number.isFinite(route.walkingMinutes) &&
          route.walkingDistanceMeters >= 0 &&
          route.walkingDurationSeconds >= 0 &&
          route.walkingMinutes ===
            walkingMinutesFromSeconds(route.walkingDurationSeconds)
          ? route
          : null,
      );
    }
    return routeCache.get(key) ?? null;
  };
  const places = data.places.filter((place) => {
    if (place.source !== data.source || !place.providerId || !place.name || !Number.isInteger(place.minimumStayMinutes) ||
        !Number.isInteger(place.suggestedStayMinutes) || place.minimumStayMinutes < 0 ||
        place.suggestedStayMinutes < place.minimumStayMinutes) return false;
    if (
      intent.excludedKinds.length > 0 &&
      (place.kind === undefined || intent.excludedKinds.includes(place.kind))
    ) return false;
    // Unknown cost is kept unknown. A no-spend guarantee requires confirmed non-payment.
    if (intent.avoidCost && place.costRequired !== false) return false;
    if (intent.nearby) {
      const route = routeFor(origin.id, place.providerId);
      if (!route || route.walkingMinutes > 5) return false;
    }
    return true;
  });
  const candidates: CandidatePlan[] = [];

  function add(stops: CandidatePlace[]) {
    let moving = 0;
    let previous = origin.id;
    const usedRoutes: SuccessfulRouteResult[] = [];
    for (const place of stops) {
      const route = routeFor(previous, place.providerId);
      if (!route) return;
      moving += route.walkingMinutes;
      usedRoutes.push(route);
      previous = place.providerId;
    }
    const outboundWalkingMinutes = moving;
    const returnRoute = (intent.returnMode === "return_to_start") ? routeFor(previous, origin.id) : null;
    if ((intent.returnMode === "return_to_start") && !returnRoute) return;
    const returnMinutes = returnRoute?.walkingMinutes ?? 0;
    moving += returnMinutes;
    if (returnRoute) usedRoutes.push(returnRoute);
    const buffer = 3;
    const minimumStay = stops.reduce((sum, place) => sum + place.minimumStayMinutes, 0);
    if (moving + minimumStay + buffer > budget) return;
    const stays = stops.map((place) => place.minimumStayMinutes);
    let remaining = budget - moving - minimumStay - buffer;
    while (remaining > 0) {
      let added = false;
      for (let index = 0; index < stops.length && remaining > 0; index++) {
        if (stays[index] < stops[index].suggestedStayMinutes) {
          stays[index]++;
          remaining--;
          added = true;
        }
      }
      if (!added) break;
    }
    const steps: PlanStep[] = [];
    previous = origin.id;
    let previousName = origin.name;
    stops.forEach((place, index) => {
      const route = routeFor(previous, place.providerId);
      if (!route) return;
      steps.push({ kind: "步行", label: `${previousName} → ${place.name}`, minutes: route.walkingMinutes });
      steps.push({ kind: "停留", label: `在${place.name}自由停留`, minutes: stays[index] });
      previous = place.providerId;
      previousName = place.name;
    });
    if ((intent.returnMode === "return_to_start")) steps.push({ kind: "返程", label: `${previousName} → ${origin.name}`, minutes: returnMinutes });
    steps.push({ kind: "缓冲", label: "给找路与临时调整留一点余量", minutes: buffer });
    const stay = stays.reduce((sum, minutes) => sum + minutes, 0);
    const title = stops.length === 2 ? stops.map((place) => place.name).join("，再去") :
      `${stops[0].name}，${intent.activity === "rest" ? "歇一会儿" : stops[0].kind === "book" ? "翻几页书" : stops[0].kind === "cafe" ? "喝杯咖啡" : "慢慢逛"}`;
    candidates.push({
      id: stops.map((place) => place.providerId).join(">"), title, places: stops, routes: usedRoutes, steps,
      walkingMinutes: moving, stayMinutes: stay, totalMinutes: moving + stay + buffer,
      budgetMinutes: budget, returnMode: intent.returnMode,
      outboundWalkingMinutes, bufferMinutes: buffer,
      ...(returnRoute ? { returnWalkingMinutes: returnMinutes } : {}),
      remainingMinutes: budget - moving - stay - buffer,
      costStatus: stops.some((place) => place.costRequired === true) ? "required" :
        stops.every((place) => place.costRequired === false) ? "not-required" : "unknown",
      source: data.source, originName: origin.name,
      feasibility: "feasible",
      categoryCount: new Set(stops.flatMap((place) => place.kind ? [place.kind] : [])).size,
    });
  }
  places.forEach((place) => add([place]));
  if (intent.activity !== "rest") for (const first of places) for (const second of places) {
    if (first.providerId !== second.providerId) add([first, second]);
  }
  const order = (strategy: StrategyId, items: CandidatePlan[]) => items.slice().sort((first, second) => {
    const priority = (plan: CandidatePlan) => strategy === "easy" ?
      [plan.walkingMinutes, -plan.stayMinutes, plan.places.length] : strategy === "balanced" ?
      intent.activity === "rest" ? [-plan.stayMinutes, plan.walkingMinutes] :
        [plan.places.length === 2 ? 0 : 1, Math.abs(plan.walkingMinutes - plan.stayMinutes), plan.walkingMinutes] :
      intent.activity === "rest" ? [plan.walkingMinutes, -plan.stayMinutes] :
        [plan.categoryCount === 2 ? 0 : 1, plan.places.length === 2 ? 0 : 1, plan.walkingMinutes];
    const left = priority(first), right = priority(second);
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return left[index] - right[index];
    return first.id.localeCompare(second.id, "zh-CN");
  });
  const chosen: Recommendation[] = [];
  const used = new Set<string>();
  const combination = (plan: CandidatePlan) => JSON.stringify(plan.places.map(place => place.providerId).sort());
  for (const strategy of intent.activity === "rest" ? restStrategies : strategies) {
    const best = order(strategy.id, candidates.filter((plan) => !used.has(combination(plan))))[0];
    if (!best) continue;
    used.add(combination(best));
    const { categoryCount: _categoryCount, ...recommendation } = best;
    void _categoryCount;
    chosen.push({ ...recommendation, strategyId: strategy.id, strategyLabel: strategy.label, strategyReason: strategy.reason });
  }
  return chosen;
}
