import { passesTravelGate, travelLimitSeconds } from "../contracts/mobility";
import { isSuccessfulRoute, routeMetrics, validRouteMetrics } from "../contracts/map";
import type { RouteEndpoint, SuccessfulRouteResult } from "../contracts/map";
import type { CandidateData, CandidatePlace, CandidatePlan, Recommendation, UserIntent, PlanStep } from "./model";
import { normalizeIntent, validIntent } from "./normalization";
import { categoryEvidence, evaluateCandidate } from "./evidence";
import type { DecisionResult, HardCheck, NormalizedIntent } from "./decisionTypes";
import { merchantPrice, meaningfulMobilityDifference } from "./factors";

export const bufferForBudget = (minutes: number) => Math.max(3, Math.min(10, Math.round(minutes / 10)));
const explicitlyClosed = (place: CandidatePlace) => typeof place.openingHours === "string" && /闭店|已关闭|暂停营业|休息中|closed/i.test(place.openingHours);
const sameEndpoint = (a: RouteEndpoint, b: RouteEndpoint) => a.id === b.id && a.location.coordinateSystem === b.location.coordinateSystem && a.location.latitude === b.location.latitude && a.location.longitude === b.location.longitude;

function buildFeasiblePlans(intent: UserIntent, normalized: NormalizedIntent, data: CandidateData, result: DecisionResult) {
  const budget = intent.availableMinutes;
  if (!Number.isInteger(budget) || budget < 5 || budget > 180 || !["mock", "real"].includes(data.source)) return [];
  const mode = data.travelMode ?? "walking";
  const provider = data.source === "real" ? "baidu" : "mock";
  const routeFor = (from: RouteEndpoint, to: RouteEndpoint): SuccessfulRouteResult | null => {
    const routes = data.routes.filter(route => route.mode === mode && sameEndpoint(route.from, from) && sameEndpoint(route.to, to));
    if (routes.length !== 1) return null;
    const route = routes[0];
    return isSuccessfulRoute(route) && route.source === data.source && route.provider === provider && route.coordinateSystem === "BD-09" && validRouteMetrics(route) ? route : null;
  };
  const candidates: { plan: CandidatePlan; checks: HardCheck[] }[] = [];
  for (const place of data.places) {
    const id = place.providerId;
    const reject = (check: string, evidence: string) => result.rejected.push({ candidateId: id, checks: [{ check, result: "failed", evidence }] });
    if (place.source !== data.source || place.provider !== provider || !place.name || !Number.isInteger(place.minimumStayMinutes) || place.minimumStayMinutes < 0 || !Number.isInteger(place.suggestedStayMinutes) || place.suggestedStayMinutes < place.minimumStayMinutes) { reject("place_contract", "地点合同无效"); continue; }
    if (explicitlyClosed(place)) { reject("opening_status", "已知地点关闭，不进入推荐"); continue; }
    if (intent.excludedKinds.length && place.kind && intent.excludedKinds.includes(place.kind)) { reject("excludedKinds", "满足明确类别排除"); continue; }
    const destination = { id, location: place.location };
    const outbound = routeFor(data.origin, destination);
    if (!outbound) { reject("route", "缺少成功且端点一致的去程路线"); continue; }
    const back = normalized.returnMode === "return_to_start" ? routeFor(destination, data.origin) : null;
    if (normalized.returnMode === "return_to_start" && !back) { reject("return_route", "要求返回但缺少成功返程"); continue; }
    const outboundSeconds = routeMetrics(outbound).durationSeconds;
    const returnSeconds = back ? routeMetrics(back).durationSeconds : undefined;
    if (!passesTravelGate(normalized, outboundSeconds, returnSeconds)) { reject("travel_gate", `超过最大交通时间 ${travelLimitSeconds(normalized)} 秒`); continue; }
    const movement = (outboundSeconds + (returnSeconds ?? 0)) / 60;
    const buffer = bufferForBudget(budget);
    if (movement + place.minimumStayMinutes + buffer > budget) { reject("time_budget", "移动 + 最低停留 + 缓冲超过预算"); continue; }
    if (mode === "walking" && normalized.maxWalkingMinutes && outboundSeconds + (returnSeconds ?? 0) > normalized.maxWalkingMinutes.value * 60) { reject("maxWalkingMinutes", "超过明确步行 MUST 上限"); continue; }
    const stay = place.stayAllocation === "flexible" ? budget - movement - buffer :
      Math.max(place.minimumStayMinutes, Math.min(place.suggestedStayMinutes, budget - movement - buffer));
    const steps: PlanStep[] = [{ kind: mode === "walking" ? "步行" : "骑行", label: `${data.origin.name} → ${place.name}`, minutes: outboundSeconds / 60 }, { kind: "停留", label: `在${place.name}自由停留`, minutes: stay }];
    if (back) steps.push({ kind: "返程", label: `${place.name} → ${data.origin.name}`, minutes: returnSeconds! / 60 });
    steps.push({ kind: "缓冲", label: "给找路与临时调整留一点余量", minutes: buffer });
    const plan: CandidatePlan = {
      goalMatch: data.discoveredCandidates?.find(candidate => candidate.poi.providerId === place.providerId && candidate.poi.provider === place.provider && candidate.tagValidation === "matched")?.goalMatch,
      travelMode: mode, travelMinutes: movement, travelDurationSeconds: outboundSeconds + (returnSeconds ?? 0), outboundTravelSeconds: outboundSeconds, ...(returnSeconds !== undefined ? { returnTravelSeconds: returnSeconds } : {}),
      id, title: `${place.name}，自由停留`, places: [place], routes: [outbound, ...(back ? [back] : [])], steps,
      outboundWalkingMinutes: mode === "walking" ? outboundSeconds / 60 : 0, ...(back && mode === "walking" ? { returnWalkingMinutes: returnSeconds! / 60 } : {}), bufferMinutes: buffer, remainingMinutes: budget - movement - stay - buffer, walkingMinutes: mode === "walking" ? movement : 0, stayMinutes: stay, totalMinutes: movement + stay + buffer, budgetMinutes: budget, returnMode: normalized.returnMode,
      costStatus: place.costRequired === true ? "required" : place.costRequired === false ? "not-required" : "unknown", source: data.source, originName: data.origin.name, feasibility: "feasible", categoryCount: 1,
    };
    candidates.push({ plan, checks: [{ check: "travel_gate", result: "passed", evidence: `${outboundSeconds + (returnSeconds ?? 0)} 秒 <= ${travelLimitSeconds(normalized)} 秒` }, { check: "route", result: "passed", evidence: "成功有向路线" }, { check: "time_budget", result: "passed", evidence: `${movement} + ${stay} + ${buffer} <= ${budget}` }, { check: "opening_status", result: "passed", evidence: place.openingHours ? "未发现明确关闭状态" : "营业状态 UNKNOWN，未当作关闭" }] });
  }
  return candidates;
}

function compareRecommendations(a: Recommendation, b: Recommendation) {
  const levels = { S: 3, M: 2, W: 1 };
  const goalDifference = (b.goalMatch ? levels[b.goalMatch] : 0) - (a.goalMatch ? levels[a.goalMatch] : 0);
  if (goalDifference) return goalDifference;
  const am = a.travelMinutes, bm = b.travelMinutes;
  if (meaningfulMobilityDifference(am, bm)) return am - bm;
  const ar = a.places[0].rating, br = b.places[0].rating;
  if (ar !== undefined && br !== undefined && ar !== br && !(ar > 4.5 && br > 4.5)) return br - ar;
  const ap = merchantPrice(a.places[0].priceText), bp = merchantPrice(b.places[0].priceText);
  if (ap !== null && bp !== null && ap !== bp) return ap - bp;
  if (ap !== null && bp === null) return -1;
  if (ap === null && bp !== null) return 1;
  return a.id.localeCompare(b.id);
}

export function buildDecisionResult(intent: UserIntent, data: CandidateData): DecisionResult {
  const normalized = normalizeIntent(intent);
  const result: DecisionResult = { supplyAudit: { travelMode: data.travelMode ?? "walking", candidateCount: data.places.length, feasibleCount: 0, paretoCount: 0, collapse: false }, status: "ok", recommendations: [], candidates: [], rejected: [], diagnostics: [] };
  if (!validIntent(normalized)) { result.status = "invalid_intent"; result.diagnostics.push({ code: "INVALID_INTENT", reason: "时间、返程或显式 MUST 数字约束无效" }); return result; }
  const built = buildFeasiblePlans(intent, normalized, data, result);
  result.candidates = built.map(({ plan, checks }) => evaluateCandidate(plan, normalized, data, checks));
  const front = result.candidates;
  result.supplyAudit.feasibleCount = result.candidates.length; result.supplyAudit.paretoCount = front.length;
  result.supplyAudit.collapse = result.candidates.length > 1 && front.length === 1;
  if (front.some(item => !item.plan.goalMatch)) result.diagnostics.push({ code: "GOAL_MATCH_UNKNOWN", reason: "部分候选缺少已验证的 v3 分类等级，不使用旧类别或名称推断。" });
  result.recommendations = front.map(item => {
    const { categoryCount: _ignored, ...plan } = item.plan;
    void _ignored;
    const rec: Recommendation = { ...plan, strategyId: "default", strategyLabel: "默认推荐", strategyReason: `Goal Match ${plan.goalMatch ?? "UNKNOWN"}；按需求匹配、移动、评分和百度商户价格排序`, decisionTrace: item.trace, scoreTrace: { legacy: true, version: "0.3", hardConstraints: "passed", categories: item.categories, categorySource: item.categorySource } };
    if (item.trace.evidence.lowCost?.state === "UNKNOWN" && !item.plan.places[0].priceText) {
      rec.costCaveat = "百度商户价格未知，请先查看详情或电话确认。";
    }
    return rec;
  }).sort(compareRecommendations);
  return result;
}

export function buildRecommendations(intent: UserIntent, data: CandidateData): Recommendation[] {
  return buildDecisionResult(intent, data).recommendations;
}
export function buildMobilityDecisions(intent: UserIntent, pools: Record<import("../contracts/map").TravelMode, CandidateData>) {
  return { walking: buildDecisionResult(intent, { ...pools.walking, travelMode: "walking" }), cycling: buildDecisionResult(intent, { ...pools.cycling, travelMode: "cycling" }) };
}
