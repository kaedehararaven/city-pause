// Synthetic fixtures only; no real location, provider identity or travel fact.
import type { CandidateData, CandidatePlace } from "../recommendation/model";
import type { GoalMatch } from "../recommendation/goalCandidateSupply";
import { parseUserIntent } from "../recommendation/intent";
import { buildDecisionResult } from "../recommendation/engine";
import type { EdgeRequest } from "./edges";
import type { SuccessfulRouteResult } from "../contracts/map";

export const tags = {
  park: "旅游景点;公园", book: "购物;商铺;书店", cafe: "美食;咖啡厅", mall: "购物;购物中心",
  art: "文化传媒;展览馆", street: "购物;商业街", craft: "休闲娱乐;手工制作", cat: "休闲娱乐;猫咖",
  shop: "购物;便利店", bookCafe: "休闲娱乐;书咖",
};
export function mockEdge(input: EdgeRequest, seconds = 120): SuccessfulRouteResult {
  return { source: "mock", provider: "mock", status: "success", mode: "walking", coordinateSystem: "BD-09", from: input.from, to: input.to,
    walkingDistanceMeters: seconds, walkingDurationSeconds: seconds, walkingMinutes: Math.ceil(seconds / 60) };
}
export function fixture(kinds: (keyof typeof tags)[], minutes = 120, levels?: GoalMatch[]) {
  const intent = parseUserIntent({ minutes, activity: "explore", text: "", nearby: false, avoidCost: false });
  const origin = { id: "synthetic-origin", name: "模拟起点", location: { latitude: 30, longitude: 110, coordinateSystem: "BD-09" as const } };
  const places: CandidatePlace[] = kinds.map((kind, index) => ({ source: "mock", provider: "mock", providerId: `synthetic-${index}`,
    name: `模拟${kind}${index}`, location: { ...origin.location, longitude: origin.location.longitude + (index + 1) * 0.001 },
    classifiedPoiTag: tags[kind], rating: 4, priceText: "20", minimumStayMinutes: 5, suggestedStayMinutes: 15, stayAllocation: "flexible" }));
  const data: CandidateData = { source: "mock", travelMode: "walking", origin, places,
    routes: places.map(poi => mockEdge({ from: origin, to: { id: poi.providerId, location: poi.location } })),
    discoveredCandidates: places.map((poi, index) => ({ poi, goalMatch: levels?.[index] ?? "S", tagValidation: "matched", classifiedPoiTag: poi.classifiedPoiTag, matchedSearchCategories: [], discoveryPriority: "high" })),
  };
  return { intent, data, singles: buildDecisionResult(intent, data).recommendations };
}
