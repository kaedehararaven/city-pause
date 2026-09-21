import { useEffect, useRef, useState } from "react";
import type { CandidateDiscoveryResult, DiscoverySnapshot } from "../contracts/discovery";
import type { MapLocation } from "../contracts/map";
import type { SearchPolicy } from "../contracts/search";
import { discoverCandidates, validDiscoveryCenter } from "./discovery";
import { createBaiduDiscoverySearch } from "./localSearchDiscovery";
import { DISCOVERY_LIMITS } from "./searchMapping";

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

export function DiscoveryPanel({ api, policy, publicCenter, onDiscoveryChange }: {
  api: typeof BMap | null;
  policy: SearchPolicy | null;
  publicCenter: MapLocation;
  onDiscoveryChange: (snapshot: DiscoverySnapshot | null) => void;
}) {
  const [result, setResult] = useState<CandidateDiscoveryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("等待搜索。");
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    controllerRef.current?.abort();
    setBusy(false);
    setResult(null);
    setMessage("等待搜索。");
    return () => controllerRef.current?.abort();
  }, [api]);

  async function run(usePublicCenter: boolean) {
    if (!api || !policy || busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setResult(null);
    onDiscoveryChange(null);
    setMessage(usePublicCenter ? "正在搜索公开测试区域…" : "正在请求定位…");
    try {
      // Empty policy must not request location or expand to all categories.
      const center = usePublicCenter || policy.entries.length === 0 ? publicCenter : await locate(api, controller.signal);
      controller.signal.throwIfAborted();
      setMessage("正在发现候选地点…");
      const discovery = await discoverCandidates(
        { center, policy }, createBaiduDiscoverySearch(api, center), controller.signal,
      );
      if (controller.signal.aborted) return;
      setResult(discovery);
      onDiscoveryChange({
        origin: { id: "current-location", name: usePublicCenter ? "公开测试起点" : "当前位置", location: center },
        result: discovery,
        searchedCategories: discovery.categories.map(category => category.category),
      });
      setMessage(`${usePublicCenter ? "公开测试区域" : "当前位置"} · REAL · ${discovery.status} · ${discovery.candidates.length} 个候选`);
    } catch {
      if (!controller.signal.aborted) setMessage("定位或搜索未成功，请检查权限及网络后重试。");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="probe-card" aria-label="真实地点与计划">
    <div className="probe-card__heading"><div><p className="eyebrow">REAL · Candidate Discovery</p><h2>附近地点 · 五类共用</h2></div></div>
    <p>{policy ? `${policy.availableMinutes} 分钟 · ${policy.entries.map(entry => entry.category + " " + entry.priority).join(" · ") || "无搜索类别"}` : "时间输入无效"}</p>
    <p className="probe-meta">REAL · 半径 {DISCOVERY_LIMITS.radiusMeters} m · 候选上限 {DISCOVERY_LIMITS.poolSize} · 生成计划时评估路线</p>
    <button type="button" disabled={!api || !policy || busy} onClick={() => void run(false)}>定位并发现候选</button>{" "}
    <button type="button" disabled={!api || !policy || busy} onClick={() => void run(true)}>搜索公开测试区域</button>
    <p aria-live="polite">{message}</p>
    {result && <p>候选已就绪，可在上方选择 REAL 并生成计划。调整时间和偏好会重新安排；重新定位可刷新候选。</p>}
    {result && <>
      <ul className="poi-list">
        {result.categories.map(category => <li key={category.category}>
          <strong>{category.category} · {category.query} · {category.status}</strong>
          <span>总匹配 {category.totalReported ?? "unknown"} · 检查 {category.inspectedCount} · 有效 {category.validCount} · 新增 {category.retainedCount} · 重复 {category.duplicateCount}</span>
          {category.samples.map((sample, index) => <span key={index}>{sample.name} · 标识{sample.hasProviderId ? "有" : "无"} · 坐标{sample.hasLocation ? "有" : "无"} · 地址{sample.hasAddress ? "有" : "unknown"} · Provider 分类：{sample.providerCategories?.join(" / ") ?? "unknown"}</span>)}
        </li>)}
      </ul>
      <h3>候选池 · {result.candidates.length}</h3>
      <ol className="poi-list">{result.candidates.map(candidate => <li key={candidate.poi.provider + ":" + candidate.poi.providerId}>
        <strong>{candidate.poi.name}</strong>
        <span>REAL · {candidate.discoveryPriority} · 发现类别：{candidate.matchedSearchCategories.join(" / ")}</span>
        <span>Provider 分类：{candidate.poi.categories?.join(" / ") ?? "unknown"}</span>
      </li>)}</ol>
    </>}
  </section>;
}
