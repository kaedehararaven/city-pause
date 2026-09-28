import { useCallback, useEffect, useRef, useState } from "react";
import { BaiduMap } from "./map/BaiduMap";
import { Planner } from "./Planner";
import { prepareRealPlan } from "./map/prepareRealPlan";
import type { GoalRefreshDiscovery, GoalSupplyPolicy } from "./recommendation/goalCandidateSupply";
import type { ReturnMode, UserIntent } from "./recommendation/model";
import type { DiscoverySnapshot } from "./contracts/discovery";
import type { RouteResult } from "./contracts/map";
import { discoveryEnvelope } from "./map/discoveryEnvelope";
import { observeLocation } from "./map/tempLocationDiagnostics"; // TEMP DEBUG

export function App() {
  const [searchPolicy, setSearchPolicy] = useState<GoalSupplyPolicy | null>(null);
  const [returnMode, setReturnMode] = useState<ReturnMode>("open_ended");
  const [showMapProbe, setShowMapProbe] = useState(false);
  const [mapMounted, setMapMounted] = useState(false);
  const [planning, setPlanning] = useState(false);
  const auditEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("audit") === "1";
  const [source, setSource] = useState<"real" | "replay">(() => new URLSearchParams(window.location.search).get("replay") === "1" ? "replay" : "real");
  const [scenario, setScenario] = useState<"compact" | "original">("compact");
  const [demo, setDemo] = useState<typeof import("./PublicReplay") | null>(null);
  const [demoError, setDemoError] = useState(false);
  useEffect(() => {
    if (source !== "replay" || demo) return;
    let disposed = false;
    setDemoError(false);
    void import("./PublicReplay").then(module => { if (!disposed) setDemo(module); })
      .catch(() => { if (!disposed) setDemoError(true); });
    return () => { disposed = true; };
  }, [source, demo]);
  const [discovery, setDiscovery] = useState<DiscoverySnapshot | null>(null);
  const discoveryRef = useRef<DiscoverySnapshot | null>(null);
  const refreshRef = useRef<GoalRefreshDiscovery | undefined>(undefined);
  const discoveryRequestRef = useRef<((signal: AbortSignal) => Promise<void>) | null>(null);
  const policyRef = useRef<GoalSupplyPolicy | null>(null);
  const [realRevision, setRealRevision] = useState(0);
  const cacheRef = useRef(new Map<string, RouteResult>());
  const requestRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const cancelReal = useCallback(() => requestRef.current?.abort(), []);
  const receiveDiscovery = useCallback((snapshot: DiscoverySnapshot | null, refresh?: GoalRefreshDiscovery, internal = false) => {
    if (!internal) requestRef.current?.abort();
    cacheRef.current = new Map();
    setDiscovery(snapshot);
    discoveryRef.current = snapshot;
    if (import.meta.env.DEV) observeLocation("planner", null, snapshot ? "Discovery snapshot.origin: " + snapshot.origin.name : "No discovery origin (last route marker is historical)");
    refreshRef.current = refresh;
    if (!internal) setRealRevision(value => value + 1);
  }, []);
  const receivePolicy = useCallback((policy: GoalSupplyPolicy | null) => {
    if (policyRef.current?.goal !== policy?.goal) {
      setDiscovery(null);
      discoveryRef.current = null;
      refreshRef.current = undefined;
      setRealRevision(value => value + 1);
    }
    policyRef.current = policy;
    setSearchPolicy(policy);
  }, []);
  const generateReal = useCallback(async (intent: UserIntent) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const work = queueRef.current.then(async () => {
      if (!discoveryRef.current || discoveryRef.current.result.status === "error") {
        setShowMapProbe(true);
        setMapMounted(true);
        for (let attempt = 0; !discoveryRequestRef.current && attempt < 100; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          controller.signal.throwIfAborted();
        }
        if (!discoveryRequestRef.current) throw new Error("地图尚未就绪，请稍后重试。");
        await discoveryRequestRef.current(controller.signal);
      }
      controller.signal.throwIfAborted();
      const currentPolicy = policyRef.current;
      if (!currentPolicy) throw new Error("当前需求尚未准备好，请重新选择目标和时间。");
      if (refreshRef.current && discoveryRef.current) {
        const requiredRadius = discoveryRef.current.envelope?.radiusMeters ?? 0;
        const targetRadius = discoveryEnvelope(currentPolicy.availableMinutes).radiusMeters;
        if (requiredRadius < targetRadius) {
          const refreshed = await refreshRef.current(currentPolicy, controller.signal);
          setDiscovery(refreshed);
          discoveryRef.current = refreshed;
        }
      }
      const snapshot = discoveryRef.current;
      if (!snapshot) throw new Error("候选发现未完成，请重试。");
      if (snapshot.result.status === "error") throw new Error("地点详情或搜索服务暂不可用，请查看候选审计中的错误类型后重试。");
      if (!snapshot.result.candidates.length) throw new Error("本次搜索未获得通过真实分类验证的候选；尚未查询路线，不代表时间不足。");
      return prepareRealPlan(intent, snapshot, cacheRef.current, controller.signal);
    });
    queueRef.current = work.then(() => undefined, () => undefined);
    return work;
  }, []);

  return <>
    <div>
    <Planner
      source={source}
      onSourceChange={setSource}
      sourceRevision={`${source}:${scenario}`}
      sourcePending={source === "replay" && !demo}
      sourceOptions={source === "replay" && (demo ? <demo.ReplayOptions scenario={scenario} onChange={setScenario} /> : <p role="status">{demoError ? "样本库加载失败，请切回真实模式后重试。" : "正在加载真实样本库…"}</p>)}
      replay={source === "replay" && demo ? demo.replayConfiguration(scenario) : undefined}
      onStageChange={setPlanning}
      onSearchPolicyChange={receivePolicy}
      returnMode={returnMode}
      onReturnModeChange={setReturnMode}
      prepareReal={generateReal}
      cancelReal={cancelReal}
      realRevision={realRevision}
      realStatus={discovery?.result.status === "error" ? "error" : discovery ? "ready" : "idle"}
      realMessage={discovery
        ? `${discovery.origin.name} · ${discovery.result.candidates.length} 个真实候选${discovery.result.status === "partial_success" ? "（详情服务部分失败，仅使用已验证候选）" : discovery.result.status === "error" ? "（服务失败，请重试）" : ""}；生成时查询所需路线。`
        : "点击生成时会自动定位，并按当前目标发现真实候选。"}
    />
    <section className="map-development-access" hidden={!auditEnabled || !planning || source === "replay"}>
      <button type="button" onClick={() => { setMapMounted(true); setShowMapProbe(value => !value); }}>
        {showMapProbe ? "收起真实地图" : "打开真实地图与附近地点"}
      </button>
      <div hidden={!showMapProbe}>{mapMounted && <BaiduMap
        searchPolicy={searchPolicy}
        returnMode={returnMode}
        onDiscoveryChange={receiveDiscovery}
        discoveryRequestRef={discoveryRequestRef}
      />}</div>
    </section>
    </div>
  </>;
}
