import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { CandidateDiscoveryResult, DiscoverySnapshot } from "../contracts/discovery";
import type { MapLocation } from "../contracts/map";
import type { GoalRefreshDiscovery, GoalSupplyPolicy } from "../recommendation/goalCandidateSupply";
import { discoverGoalCandidates } from "../recommendation/goalCandidateSupply";
import { validDiscoveryCenter } from "./discovery";
import { createWebPlaceSearch } from "./webPlaceSearch";
import { fetchBatchPlaceDetails } from "./capabilityClient";
import { DISCOVERY_LIMITS } from "./searchMapping";
import { PlaceDetails } from "./PlaceDetails";
import { discoveryEnvelope } from "./discoveryEnvelope";
import { loadPlaceDetails } from "./placeDetailLoader";
import { observeLocation } from "./tempLocationDiagnostics"; // TEMP DEBUG
import type { DiscoveryQueryResult } from "./discovery";
import { resolveDiscoveryOrigin } from "./discoveryOrigin";

function locate(api: typeof BMap, signal: AbortSignal): Promise<MapLocation> {
  return new Promise((resolve, reject) => {
    const options = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 };
    let settled = false;
    const finish = (location?: MapLocation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (location) resolve(location);
      else reject(new Error("定位未成功，请检查位置权限或重试。"));
    };
    const abort = () => finish();
    const timer = setTimeout(() => finish(), 12_000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { finish(); return; }
    try {
      const geolocation = new api.Geolocation(options);
      geolocation.getCurrentPosition(result => {
        if (import.meta.env.DEV && result?.point && geolocation.getStatus() === 0) observeLocation("sdk", { latitude: result.point.lat, longitude: result.point.lng }, "DiscoveryPanel: SDK result.point", result.accuracy);
        const location: MapLocation | undefined = result?.point ? {
          latitude: result.point.lat, longitude: result.point.lng, coordinateSystem: "BD-09",
        } : undefined;
        finish(geolocation.getStatus() === 0 && location && validDiscoveryCenter(location) ? location : undefined);
      }, options);
    } catch {
      finish();
    }
  });
}

export function DiscoveryPanel({ api, policy, publicCenter, onDiscoveryChange, requestRef }: {
  api: typeof BMap | null;
  policy: GoalSupplyPolicy | null;
  publicCenter: MapLocation;
  onDiscoveryChange: (snapshot: DiscoverySnapshot | null, refresh?: GoalRefreshDiscovery, internal?: boolean) => void;
  requestRef?: MutableRefObject<((signal: AbortSignal) => Promise<void>) | null>;
}) {
  const [result, setResult] = useState<CandidateDiscoveryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("等待搜索。");
  const controllerRef = useRef<AbortController | null>(null);
  const originRef = useRef<DiscoverySnapshot["origin"] | null>(null);
  const rawResults = useRef(new Map<string, DiscoveryQueryResult>());
  const searchAt = (center: MapLocation, minutes: number) => {
    const radius = discoveryEnvelope(minutes).radiusMeters;
    const search = createWebPlaceSearch(center, radius);
    return async (keywords: string | string[], signal: AbortSignal) => {
      signal.throwIfAborted();
      const key = JSON.stringify(["web-pages-v1", center, radius, keywords]);
      const cached = rawResults.current.get(key);
      if (cached) return cached;
      const response = await search(keywords, signal);
      signal.throwIfAborted();
      if (!response.errorCode && (response.status === "success" || response.status === "empty")) rawResults.current.set(key, response);
      return response;
    };
  };
  useEffect(() => {
    controllerRef.current?.abort();
    rawResults.current.clear();
    setBusy(false);
    setResult(null);
    setMessage("等待搜索。");
    return () => controllerRef.current?.abort();
  }, [api, policy?.goal]);

  useEffect(() => {
    if (!requestRef) return;
    requestRef.current = api && policy ? signal => run(undefined, signal) : null;
    return () => { requestRef.current = null; };
  });

  async function run(usePublicCenter?: boolean, parentSignal?: AbortSignal) {
    if (!api || !policy || busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const abort = () => controller.abort();
    parentSignal?.addEventListener("abort", abort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    const internal = !!parentSignal;
    if (!internal) rawResults.current.clear();
    setBusy(true);
    setResult(null);
    onDiscoveryChange(null, undefined, internal);
    setMessage(usePublicCenter ? "正在搜索公开测试区域…" : "正在请求定位…");
    try {
      controller.signal.throwIfAborted();
      // Empty policy must not request location or expand to all categories.
      const origin = await resolveDiscoveryOrigin(originRef.current,
        usePublicCenter === true || policy.s.length + policy.m.length === 0 ? "public" : usePublicCenter === false ? "locate" : "reuse",
        publicCenter, () => locate(api, controller.signal), controller.signal);
      const center = origin.location;
      controller.signal.throwIfAborted();
      setMessage("正在发现候选地点…");
      originRef.current = origin;
      const supply = await discoverGoalCandidates({ origin, policy, signal: controller.signal,
        search: searchAt(center, policy.availableMinutes),
        loadDetail: loadPlaceDetails, loadDetails: fetchBatchPlaceDetails });
      const snapshot = { origin, envelope: discoveryEnvelope(policy.availableMinutes), searchedCategories: supply.reports.map(report => report.layer), result: {
        source: "real" as const, status: supply.serviceError || supply.reports.some(r => r.status === "provider_error" || r.status === "timeout") ? (supply.candidates.length ? "partial_success" as const : "error" as const) : supply.candidates.length ? "success" as const : "empty" as const,
        candidates: supply.candidates, categories: supply.reports.map(report => ({
          failureReasons: report.reasons, category: report.layer, priority: report.layer === "S" ? "high" as const : "medium" as const, query: report.query, keywords: report.keywords,
          status: report.status, totalReported: report.rawResultCount, inspectedCount: report.adapterInputCount, validCount: report.valid,
          retainedCount: report.accepted, duplicateCount: report.dedupeCount, samples: [], rawResultCount: report.rawResultCount, rawResultSetCount: report.rawResultSetCount,
          adapterInputCount: report.adapterInputCount, detailSuccessCount: report.detailSuccessCount,
          classifiedTagAvailableCount: report.classifiedTagAvailableCount, tagMatchedCount: report.tagMatchedCount,
          subplaceFilteredCount: report.subplaceFilteredCount, matchedClassifiedPoiTags: report.matchedClassifiedPoiTags,
        })), observations: { searchedQueries: supply.reports.length, validCount: supply.candidates.length, sValidCount: supply.sCount, mTriggered: supply.mTriggered, finalClassifiedPoiTagCount: supply.finalClassifiedPoiTagCount, uniqueCandidates: supply.candidates },
      } };
      const discovery = snapshot.result;
      if (controller.signal.aborted) return;
      setResult(discovery);
      onDiscoveryChange(snapshot, async (nextPolicy, signal) => {
        setBusy(true);
        setMessage("正在按新的时间范围补充候选地点…");
        try {
          const nextSupply = await discoverGoalCandidates({ origin: snapshot.origin, policy: nextPolicy, signal,
            search: searchAt(snapshot.origin.location, nextPolicy.availableMinutes),
            loadDetail: loadPlaceDetails, loadDetails: fetchBatchPlaceDetails });
          const updated = { ...snapshot, envelope: discoveryEnvelope(nextPolicy.availableMinutes), result: { ...snapshot.result, candidates: nextSupply.candidates, categories: nextSupply.reports.map(report => ({ category: report.layer, priority: report.layer === "S" ? "high" as const : "medium" as const, query: report.query, keywords: report.keywords, status: report.status, totalReported: report.rawResultCount, inspectedCount: report.adapterInputCount, validCount: report.valid, retainedCount: report.accepted, duplicateCount: report.dedupeCount, samples: [], rawResultCount: report.rawResultCount, rawResultSetCount: report.rawResultSetCount, adapterInputCount: report.adapterInputCount, detailSuccessCount: report.detailSuccessCount, classifiedTagAvailableCount: report.classifiedTagAvailableCount, tagMatchedCount: report.tagMatchedCount, subplaceFilteredCount: report.subplaceFilteredCount, matchedClassifiedPoiTags: report.matchedClassifiedPoiTags })), observations: { searchedQueries: nextSupply.reports.length, validCount: nextSupply.candidates.length, sValidCount: nextSupply.sCount, mTriggered: nextSupply.mTriggered, finalClassifiedPoiTagCount: nextSupply.finalClassifiedPoiTagCount, uniqueCandidates: nextSupply.candidates } } };
          signal.throwIfAborted();
          updated.result.status = nextSupply.serviceError || nextSupply.reports.some(r => r.status === "provider_error" || r.status === "timeout") ? (nextSupply.candidates.length ? "partial_success" : "error") : nextSupply.candidates.length ? "success" : "empty";
          updated.result.categories.forEach((category, index) => { Object.assign(category, { failureReasons: nextSupply.reports[index].reasons }); });
          setResult(updated.result);
          setMessage(`${snapshot.origin.name} · REAL · ${updated.result.status} · ${updated.result.candidates.length} 个候选`);
          return updated;
        } catch (error) {
          setMessage(signal.aborted ? "搜索已取消。" : "补充候选未成功，请重试。");
          throw error;
        } finally {
          setBusy(false);
        }
      }, internal);
      setMessage(`${origin.name} · REAL · ${discovery.status} · ${discovery.candidates.length} 个候选${supply.serviceError ? ` · 地点详情服务暂不可用 (${supply.serviceError})` : ""}`);
    } catch {
      if (!controller.signal.aborted) setMessage("定位或搜索未成功，请检查权限及网络后重试。");
    } finally {
      parentSignal?.removeEventListener("abort", abort);
      if (controllerRef.current === controller) setBusy(false);
    }
  }

  return <section className="probe-card" aria-label="真实地点与计划">
    <div className="probe-card__heading"><div><p className="eyebrow">REAL · Goal-driven Candidate Supply v3</p><h2>附近地点 · 按目标召回</h2></div></div>
    <p>{policy ? `${policy.availableMinutes} 分钟 · ${policy.goal} · S ${policy.s.length} 个标签，M ${policy.m.length} 个标签（S 不足 12 个才触发 M）` : "时间输入无效"}</p>
    <p className="probe-meta">REAL · Web Search V3 · 搜索范围 {policy ? discoveryEnvelope(policy.availableMinutes).radiusMeters : "—"} m · S/M 每层最多一次 Search · 有效候选不足 12 时按批补分类</p>
    <button type="button" disabled={!api || !policy || busy} onClick={() => void run(false)}>定位并发现候选</button>{" "}
    <button type="button" disabled={!api || !policy || busy} onClick={() => void run(true)}>搜索公开测试区域</button>
    <p aria-live="polite">{message}</p>
    {originRef.current && <p>当前起点：{originRef.current.name}；切换目标保留此起点。</p>}
    {result && <p>{result.status === "error" ? "地点服务未成功，请查看错误类型；不会把数据失败当成时间不足。" : result.candidates.length ? "已验证候选可用于生成计划。增加时间会沿用当前起点补充搜索；重新定位可更换起点。" : "没有通过真实分类验证的候选，尚未计算路线。"}</p>}
    {result && <>
      <ul className="poi-list">
        {result.categories.map(category => <li key={category.category}>
          <strong>{category.category} · {category.query} · {category.status}</strong>
          {category.failureReasons && Object.keys(category.failureReasons).length > 0 && <span>过滤/错误：{Object.entries(category.failureReasons).map(([reason, count]) => `${reason}: ${count}`).join(" / ")}</span>}
          <span>关键词 {category.keywords?.join(" / ") ?? category.query} · 原始POI {category.rawResultCount ?? "unknown"} · 结果集 {category.rawResultSetCount ?? "unknown"} · adapter输入 {category.adapterInputCount ?? category.inspectedCount} · 去重 {category.duplicateCount} · 详情成功 {category.detailSuccessCount ?? "unknown"} · 分类可用 {category.classifiedTagAvailableCount ?? "unknown"} · tag命中 {category.tagMatchedCount ?? "unknown"} · 子地点过滤 {category.subplaceFilteredCount ?? 0} · 有效 {category.validCount}</span>
          <span>命中的 classified_poi_tag：{category.matchedClassifiedPoiTags?.join(" / ") || "无"}</span>
          {category.samples.map((sample, index) => <span key={index}>{sample.name} · 标识{sample.hasProviderId ? "有" : "无"} · 坐标{sample.hasLocation ? "有" : "无"} · 地址{sample.hasAddress ? "有" : "unknown"} · Provider 分类：{sample.providerCategories?.join(" / ") ?? "unknown"}</span>)}
        </li>)}
      </ul>
      <p>供给漏斗：S valid {result.observations?.sValidCount ?? "unknown"} · M triggered {result.observations?.mTriggered === undefined ? "unknown" : result.observations.mTriggered ? "true" : "false"} · S+M valid {result.candidates.length} · 最终不同 classified_poi_tag {result.observations?.finalClassifiedPoiTagCount ?? "unknown"}</p>
      <h3>候选池 · {result.candidates.length}</h3>
      <ol className="poi-list">{result.candidates.map(candidate => <li key={candidate.poi.provider + ":" + candidate.poi.providerId}>
        <strong>{candidate.poi.name}</strong>
        <span>REAL · Goal Match {candidate.goalMatch ?? "unknown"} · 来源层：{candidate.sourceLayer ?? "unknown"}</span>
        <span>classified_poi_tag：{candidate.classifiedPoiTag ?? "unknown"} · tag 验证：{candidate.tagValidation ?? "unknown"}</span>
        <PlaceDetails poi={candidate.poi} />
      </li>)}</ol>
    </>}
  </section>;
}
