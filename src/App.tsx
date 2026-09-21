import { useMemo, useState } from "react";
import { BaiduMap, type RealMapIntegrationState } from "./map/BaiduMap";
import { Planner } from "./Planner";
import { createRealCandidateProvider } from "./recommendation/realProvider";

import type { ReturnMode } from "./recommendation/model";

export function App() {
  const [returnMode, setReturnMode] = useState<ReturnMode>("open_ended");
  const [showMapProbe, setShowMapProbe] = useState(false);
  const [realIntegration, setRealIntegration] = useState<RealMapIntegrationState>({
    status: "idle",
    message: "请先打开页面底部的真实地图探测并获取当前位置。",
  });
  const realData = useMemo(() =>
    realIntegration.status === "ready"
      ? createRealCandidateProvider({
          origin: realIntegration.origin,
          poi: realIntegration.poi,
          routes: realIntegration.routes,
        }).getCandidateData()
      : undefined, [realIntegration]);

  return (
    <>
      <Planner
        returnMode={returnMode}
        onReturnModeChange={(mode) => {
          setReturnMode(mode);
          setRealIntegration({ status: "idle", message: "时间模式已更新，请获取当前模式所需路线。" });
        }}
        realData={realData}
        realStatus={realIntegration.status}
        realMessage={realIntegration.message}
      />
      <section className="map-development-access">
        <button type="button" onClick={() => setShowMapProbe((value) => !value)}>
          {showMapProbe ? "收起真实地图探测" : "打开真实地图探测（开发功能）"}
        </button>
        {showMapProbe && (
          <BaiduMap returnMode={returnMode} onRealIntegrationChange={setRealIntegration} />
        )}
      </section>
    </>
  );
}
