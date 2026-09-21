import { useCallback, useRef, useState } from "react";
import { BaiduMap } from "./map/BaiduMap";
import { Planner } from "./Planner";
import { prepareRealPlan } from "./map/prepareRealPlan";
import type { ReturnMode, UserIntent } from "./recommendation/model";
import type { SearchPolicy } from "./contracts/search";
import type { DiscoverySnapshot } from "./contracts/discovery";
import type { RouteResult } from "./contracts/map";

export function App() {
  const [searchPolicy, setSearchPolicy] = useState<SearchPolicy | null>(null);
  const [returnMode, setReturnMode] = useState<ReturnMode>("open_ended");
  const [showMapProbe, setShowMapProbe] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoverySnapshot | null>(null);
  const cacheRef = useRef(new Map<string, RouteResult>());
  const requestRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const cancelReal = useCallback(() => requestRef.current?.abort(), []);
  const receiveDiscovery = useCallback((snapshot: DiscoverySnapshot | null) => {
    requestRef.current?.abort();
    cacheRef.current = new Map();
    setDiscovery(snapshot);
  }, []);
  const generateReal = useCallback(async (intent: UserIntent) => {
    requestRef.current?.abort();
    if (!discovery) throw new Error("请先在下方真实地图面板定位并发现候选地点。");
    const controller = new AbortController();
    requestRef.current = controller;
    const cache = cacheRef.current;
    const work = queueRef.current.then(() => prepareRealPlan(intent, discovery, cache, controller.signal));
    queueRef.current = work.then(() => undefined, () => undefined);
    return work;
  }, [discovery]);

  return <>
    <Planner
      onSearchPolicyChange={setSearchPolicy}
      returnMode={returnMode}
      onReturnModeChange={setReturnMode}
      prepareReal={generateReal}
      cancelReal={cancelReal}
      realRevision={discovery}
      realStatus={discovery ? "ready" : "idle"}
      realMessage={discovery
        ? `${discovery.origin.name} · ${discovery.result.candidates.length} 个真实候选；生成时查询所需路线。`
        : "请先打开下方真实地图，定位并发现候选地点。"}
    />
    <section className="map-development-access">
      <button type="button" onClick={() => setShowMapProbe(value => !value)}>
        {showMapProbe ? "收起真实地图" : "打开真实地图与附近地点"}
      </button>
      {showMapProbe && <BaiduMap
        searchPolicy={searchPolicy}
        returnMode={returnMode}
        onDiscoveryChange={receiveDiscovery}
      />}
    </section>
  </>;
}
