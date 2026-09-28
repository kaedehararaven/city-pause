import type { DiscoveredCandidate } from "../contracts/discovery";
import type { MapPOI } from "../contracts/map";
import type { DiscoveryQueryResult, DiscoverySearch } from "../map/discovery";
import type { TemporaryPlaceDetail } from "../map/capabilityClient";
import { detailFailure } from "../map/capabilityClient";
import { mergeBaiduPlaceDetail } from "../map/poiAdapter";
import type { Goal } from "./decisionTypes";
import type { Activity, UserIntent } from "./model";

export type GoalMatch = "S" | "M" | "W";
export type SupplyLayer = "S" | "M";
export type GoalRule = { path: string; level: GoalMatch; query: string };
export type GoalSupplyPolicy = {
  version: "goal-v3";
  goal: Exclude<Goal, "flexible">;
  availableMinutes: number;
  s: GoalRule[];
  m: GoalRule[];
  w: GoalRule[];
};
export type GoalRefreshDiscovery = (policy: GoalSupplyPolicy, signal: AbortSignal) => Promise<import("../contracts/discovery").DiscoverySnapshot>;

const rule = (path: string, level: GoalMatch, query: string): GoalRule => ({ path, level, query });

const RULES: Record<Exclude<Goal, "flexible">, { s: GoalRule[]; m: GoalRule[]; w: GoalRule[] }> = {
  rest: {
    s: [rule("美食 > 咖啡厅", "S", "咖啡厅"), rule("休闲娱乐 > 书咖", "S", "书咖"), rule("休闲娱乐 > 猫咖", "S", "猫咖"), rule("休闲娱乐 > 茶馆", "S", "茶馆"), rule("美食 > 甜品店", "S", "甜品店"), rule("美食 > 饮品店", "S", "饮品店")],
    m: [rule("美食 > 糕点烘焙", "M", "糕点烘焙"), rule("购物 > 商铺 > 书店", "M", "书店"), rule("旅游景点 > 公园", "M", "公园"), rule("旅游景点 > 美术馆", "M", "美术馆"), rule("旅游景点 > 博物馆", "M", "博物馆"), rule("文化传媒 > 艺术馆", "M", "艺术馆"), rule("文化传媒 > 展览馆", "M", "展览馆")],
    w: [rule("购物 > 购物中心", "W", "购物中心"), rule("休闲娱乐 > 休闲广场", "W", "休闲广场")],
  },
  walk: {
    s: [rule("旅游景点 > 公园", "S", "公园"), rule("旅游景点 > 植物园", "S", "植物园"), rule("购物 > 商业街", "S", "商业街"), rule("旅游景点 > 人文景观 > 古村古镇", "S", "古村古镇")],
    m: [rule("购物 > 购物中心", "M", "购物中心"), rule("旅游景点 > 美术馆", "M", "美术馆"), rule("旅游景点 > 博物馆", "M", "博物馆"), rule("文化传媒 > 艺术馆", "M", "艺术馆"), rule("文化传媒 > 展览馆", "M", "展览馆")],
    w: [rule("休闲娱乐 > 休闲广场", "W", "休闲广场"), rule("购物 > 商铺 > 书店", "W", "书店"), rule("美食 > 咖啡厅", "W", "咖啡厅"), rule("休闲娱乐 > 书咖", "W", "书咖"), rule("休闲娱乐 > 猫咖", "W", "猫咖"), rule("休闲娱乐 > 茶馆", "W", "茶馆"), rule("美食 > 甜品店", "W", "甜品店"), rule("美食 > 饮品店", "W", "饮品店"), rule("美食 > 糕点烘焙", "W", "糕点烘焙")],
  },
  discover: {
    s: [rule("旅游景点 > 美术馆", "S", "美术馆"), rule("旅游景点 > 博物馆", "S", "博物馆"), rule("文化传媒 > 艺术馆", "S", "艺术馆"), rule("文化传媒 > 展览馆", "S", "展览馆"), rule("休闲娱乐 > 游乐游艺 > 新奇体验馆", "S", "新奇体验馆"), rule("休闲娱乐 > 手工制作", "S", "手工制作"), rule("购物 > 商业街", "S", "商业街"), rule("旅游景点 > 人文景观 > 古村古镇", "S", "古村古镇"), rule("旅游景点 > 植物园", "S", "植物园")],
    m: [rule("购物 > 商铺 > 动漫店", "M", "动漫店"), rule("购物 > 商铺 > 书店", "M", "书店"), rule("购物 > 购物中心", "M", "购物中心"), rule("休闲娱乐 > 书咖", "M", "书咖"), rule("休闲娱乐 > 猫咖", "M", "猫咖"), rule("美食 > 甜品店", "M", "甜品店"), rule("美食 > 饮品店", "M", "饮品店"), rule("美食 > 糕点烘焙", "M", "糕点烘焙")],
    w: [rule("购物 > 商铺 > 副食品店 > 零食店", "W", "零食店"), rule("美食 > 咖啡厅", "W", "咖啡厅"), rule("休闲娱乐 > 茶馆", "W", "茶馆"), rule("休闲娱乐 > 休闲广场", "W", "休闲广场"), rule("购物 > 超市", "W", "超市"), rule("购物 > 便利店", "W", "便利店"), rule("旅游景点 > 公园", "W", "公园")],
  },
};

const normalizePath = (value?: string) => String(value ?? "").replace(/[;；/／,，]/g, ">").replace(/\s*>\s*/g, ">").replace(/\s+/g, "").trim();
export const MAX_CANDIDATES_PER_TAG = 5;
export function limitCandidatesPerTag(candidates: DiscoveredCandidate[]): DiscoveredCandidate[] {
  const counts = new Map<string, number>(), seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.poi.provider}:${candidate.poi.providerId}`;
    const tag = normalizePath(candidate.classifiedPoiTag);
    if (!tag || candidate.tagValidation !== "matched" || seen.has(key)) return false;
    seen.add(key);
    const count = counts.get(tag) ?? 0;
    if (count >= MAX_CANDIDATES_PER_TAG) return false;
    counts.set(tag, count + 1);
    return true;
  });
}
const pathMatches = (actual: string, expected: string) => actual === expected || actual.startsWith(`${expected}>`);
const NAVIGATION_PREFIXES = ["交通设施>停车场", "出入口", "门", "检票口", "厕所", "电梯"];

export function goalForActivity(activity: Activity): Exclude<Goal, "flexible"> {
  return activity === "rest" ? "rest" : activity === "walk" ? "walk" : "discover";
}

export function buildGoalSupplyPolicy(intent: UserIntent): GoalSupplyPolicy {
  const goal = goalForActivity(intent.activity);
  const source = RULES[goal];
  return { version: "goal-v3", goal, availableMinutes: intent.availableMinutes, s: source.s.map(x => ({ ...x })), m: source.m.map(x => ({ ...x })), w: source.w.map(x => ({ ...x })) };
}

export function compositeGoalQuery(rules: readonly GoalRule[]) {
  return rules.map(item => item.query);
}

export type GoalSupplyReport = {
  layer: SupplyLayer;
  keywords: string[];
  query: string;
  status: DiscoveryQueryResult["status"];
  rawResultCount: number;
  rawResultSetCount: number;
  adapterInputCount: number;
  dedupeCount: number;
  detailSuccessCount: number;
  classifiedTagAvailableCount: number;
  tagMatchedCount: number;
  subplaceFilteredCount: number;
  valid: number;
  accepted: number;
  rejected: number;
  reasons: Record<string, number>;
  matchedClassifiedPoiTags: string[];
};

export type GoalSupplyResult = {
  serviceError?: string;
  candidates: DiscoveredCandidate[];
  reports: GoalSupplyReport[];
  sCount: number;
  mTriggered: boolean;
  wNaturalCount: number;
  finalClassifiedPoiTagCount: number;
};

function addReason(reasons: Record<string, number>, reason: string) { reasons[reason] = (reasons[reason] ?? 0) + 1; }

export function matchingRule(tag: string | undefined, policy: GoalSupplyPolicy): { level: GoalMatch; path: string } | undefined {
  const actual = normalizePath(tag);
  if (!actual) return undefined;
  const matches = [...policy.s, ...policy.m, ...policy.w].filter(item => pathMatches(actual, normalizePath(item.path)));
  const best = matches.sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)[0];
  return best ? { level: best.level, path: best.path } : undefined;
}

export function isNavigation(tag?: string) {
  const actual = normalizePath(tag);
  return NAVIGATION_PREFIXES.some(prefix => pathMatches(actual, prefix));
}

export async function discoverGoalCandidates(input: {
  origin: { location: MapPOI["location"] };
  policy: GoalSupplyPolicy;
  search: DiscoverySearch;
  loadDetail: (poi: MapPOI) => Promise<TemporaryPlaceDetail>;
  loadDetails?: (pois: MapPOI[]) => Promise<{ places: TemporaryPlaceDetail[]; providerStatus?: number }>;
  signal?: AbortSignal;
}): Promise<GoalSupplyResult> {
  const signal = input.signal ?? new AbortController().signal;
  const candidates = new Map<string, DiscoveredCandidate>();
  const tagCounts = new Map<string, number>();
  const reports: GoalSupplyReport[] = [];
  let wNaturalCount = 0, serviceError: string | undefined;
  async function runLayer(layer: SupplyLayer, rules: readonly GoalRule[]) {
    const keywords = compositeGoalQuery(rules);
    const response = await input.search(keywords, signal);
    signal.throwIfAborted();
    const reasons: Record<string, number> = {};
    if (response.errorCode || response.status === "provider_error" || response.status === "timeout") {
      serviceError = response.errorCode ?? `search_${response.status}`; addReason(reasons, serviceError);
    }
    let accepted = 0, dedupeCount = 0, detailSuccessCount = 0, classifiedTagAvailableCount = 0, tagMatchedCount = 0, subplaceFilteredCount = 0;
    const matchedTags = new Set<string>(), layerSeen = new Set<string>();
    const missing: MapPOI[] = [];
    function accept(poi: MapPOI) {
      const tag = poi.classifiedPoiTag;
      if (tag) classifiedTagAvailableCount++;
      const match = matchingRule(tag, input.policy);
      if (match && !isNavigation(tag)) {
        tagMatchedCount++; matchedTags.add(normalizePath(tag));
        const key = `${poi.provider}:${poi.providerId}`;
        if (!candidates.has(key)) {
          const tagKey = normalizePath(tag);
          if ((tagCounts.get(tagKey) ?? 0) >= MAX_CANDIDATES_PER_TAG) addReason(reasons, "tag_capacity_reached");
          else {
            tagCounts.set(tagKey, (tagCounts.get(tagKey) ?? 0) + 1);
            candidates.set(key, { poi, matchedSearchCategories: [], discoveryPriority: layer === "S" ? "high" : "medium",
              goalMatch: match.level, sourceLayer: match.level === "W" ? "W-natural" : layer, classifiedPoiTag: tag, tagValidation: "matched" });
            accepted++; if (match.level === "W") wNaturalCount++;
          }
        }
      } else addReason(reasons, isNavigation(tag) ? "navigation_poi" : tag ? "not_in_goal_whitelist" : "classified_tag_missing");
      for (const child of poi.subPlaces ?? []) {
        if (!child.location || !child.classifiedPoiTag || isNavigation(child.classifiedPoiTag) || !matchingRule(child.classifiedPoiTag, input.policy)) { subplaceFilteredCount++; continue; }
        accept({ source: "real", provider: "baidu", providerId: child.providerId, name: child.name, location: child.location,
          address: child.address, categories: child.categories, classifiedPoiTag: child.classifiedPoiTag });
      }
    }
    if ("pois" in response) {
      for (const poi of response.pois) {
        if (poi.source !== "real" || poi.provider !== "baidu" || !poi.providerId || !poi.name) { addReason(reasons, "invalid_poi"); continue; }
        const key = `${poi.provider}:${poi.providerId}`;
        if (layerSeen.has(key) || candidates.has(key)) { dedupeCount++; continue; }
        layerSeen.add(key);
        if (poi.classifiedPoiTag) accept(poi); else missing.push(poi);
      }
      // Classify every search result first. Rescue only absent classifications,
      // never known mismatches, and never just to obtain rating or price.
      let offset = 0, consecutiveFailures = 0;
      while (candidates.size < 12 && offset < missing.length && !serviceError) {
        signal.throwIfAborted();
        const batch = missing.slice(offset, offset + (input.loadDetails ? 10 : 1));
        offset += batch.length;
        try {
          const response = input.loadDetails ? await input.loadDetails(batch) : { places: [await input.loadDetail(batch[0])] };
          signal.throwIfAborted();
          consecutiveFailures = 0;
          for (const poi of batch) {
            const detail = response.places.find(item => item.providerId === poi.providerId);
            if (detail) { detailSuccessCount++; accept(mergeBaiduPlaceDetail(poi, detail)); }
            else addReason(reasons, "detail_missing");
          }
          if (response.providerStatus !== undefined) { serviceError = `provider_${response.providerStatus}`; addReason(reasons, serviceError); }
        } catch (error) {
          signal.throwIfAborted();
          const failure = detailFailure(error);
          addReason(reasons, `detail_${failure.code}`);
          if (failure.serviceFailure || ++consecutiveFailures >= 3) serviceError = failure.code;
        }
      }
      if (offset < missing.length) reasons.classification_rescue_skipped = missing.length - offset;
    }
    reports.push({ layer, keywords, query: keywords.join("$"), status: response.errorCode ? "provider_error" : response.status,
      rawResultCount: "pois" in response ? response.rawResultCount ?? response.pois.length : 0,
      rawResultSetCount: "pois" in response ? response.rawResultSetCount ?? 1 : 0,
      adapterInputCount: "pois" in response ? response.adapterInputCount ?? response.pois.length : 0,
      dedupeCount, detailSuccessCount, classifiedTagAvailableCount, tagMatchedCount, subplaceFilteredCount,
      valid: accepted, accepted, rejected: Object.values(reasons).reduce((a, b) => a + b, 0), reasons,
      matchedClassifiedPoiTags: [...matchedTags] });
  }
  await runLayer("S", input.policy.s);
  const sCount = candidates.size;
  let mTriggered = false;
  if (!serviceError && sCount < 12 && input.policy.m.length) { mTriggered = true; await runLayer("M", input.policy.m); }
  return { serviceError, candidates: [...candidates.values()], reports, sCount, mTriggered, wNaturalCount,
    finalClassifiedPoiTagCount: new Set([...candidates.values()].map(candidate => normalizePath(candidate.classifiedPoiTag)).filter(Boolean)).size };
}
