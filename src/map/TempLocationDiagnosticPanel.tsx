// TEMP DEBUG: removable diagnostic overlays; no production state setters or route APIs.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { diagnosticDistance, readLocationDiagnostics, subscribeLocationDiagnostics, type DebugPoint } from "./tempLocationDiagnostics";

export function TempLocationDiagnostics({ api, map }: { api: typeof BMap; map: BMap.Map }) {
  const observed = useSyncExternalStore(subscribeLocationDiagnostics, readLocationDiagnostics);
  const [enabled, setEnabled] = useState(false);
  const [raw, setRaw] = useState<(DebugPoint & { accuracy: number; timestamp: number })>();
  const [converted, setConverted] = useState<DebugPoint>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { generation.current++; clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!enabled) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const overlays: BMap.Marker[] = [];
    const points = [observed.sdk, raw, converted, observed.route];
    const names = ["SDK_CURRENT", "RAW_BROWSER", "BROWSER_TO_BAIDU", "ROUTE_ORIGIN"];
    const colors = ["#b42318", "#175cd3", "#067647", "#9333a3"];
    try {
      points.forEach((point, index) => {
        if (!point) return;
        const marker = new api.Marker(new api.Point(point.longitude, point.latitude));
        marker.setTitle(names[index]);
        const label = new api.Label(names[index], { offset: new api.Size(18, index * 26 - 52) });
        label.setStyles({ color: colors[index], backgroundColor: "white", border: `2px solid ${colors[index]}`, padding: "3px", fontSize: "12px" });
        marker.setLabel(label);
        overlays.push(marker);
        map.addOverlay(marker);
      });
    } catch { setMessage("诊断覆盖物显示失败；业务定位未改变。"); }
    return () => { for (const marker of overlays) { try { map.removeOverlay(marker); } catch { /* Map may have unmounted. */ } } };
  }, [api, map, enabled, observed, raw, converted]);

  function sampleBrowser() {
    const run = ++generation.current;
    clearTimeout(timer.current);
    setRaw(undefined); setConverted(undefined); setBusy(true);
    setMessage("正在单独获取浏览器位置（定位等待上限 30 秒）…");
    const fail = (message: string) => {
      if (run !== generation.current) return;
      generation.current++; clearTimeout(timer.current); setBusy(false); setMessage(message);
    };
    timer.current = setTimeout(() => fail("诊断原生定位等待超过 35 秒；未使用替代坐标。"), 35000);
    if (!navigator.geolocation) { fail("浏览器不支持原生定位。"); return; }
    navigator.geolocation.getCurrentPosition(position => {
      if (run !== generation.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fail("百度坐标转换等待超过 15 秒；原生位置已取得，未生成替代转换坐标。"), 15000);
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setRaw({ ...point, accuracy: position.coords.accuracy, timestamp: position.timestamp });
      setNow(Date.now()); setMessage("正在调用百度 Convertor：WGS84 → BD-09…");
      try {
        new api.Convertor().translate([new api.Point(point.longitude, point.latitude)], 1, 5, result => {
          if (run !== generation.current) return;
          const p = result.points?.[0];
          if (result.status !== 0 || !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
            fail("百度转换失败；BROWSER_TO_BAIDU 未生成。"); return;
          }
          setConverted({ latitude: p.lat, longitude: p.lng });
          clearTimeout(timer.current); setBusy(false); setMessage("诊断采样完成。RAW 直接投到百度地图仅作对照，未预设哪个点正确。");
        });
      } catch { fail("百度转换不可用；未使用自制转换或替代坐标。"); }
    }, error => fail(`原生定位失败（code ${error.code}${error.code === 3 ? "：超时，定位等待上限 30 秒" : ""}）。`), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  const coords = (p?: DebugPoint) => p ? `${p.latitude.toFixed(7)} / ${p.longitude.toFixed(7)}` : "尚未取得";
  const distance = (a?: DebugPoint, b?: DebugPoint) => {
    const value = diagnosticDistance(a, b);
    return value === undefined ? "尚未取得" : `${value.toFixed(1)} m`;
  };
  return <section aria-label="TEMP DEBUG 定位诊断" style={{ borderTop: "1px solid #999", padding: 12, overflowWrap: "anywhere" }}>
    <h3>TEMP DEBUG · 定位坐标诊断</h3>
    <label><input type="checkbox" checked={enabled} onChange={event => {
      setEnabled(event.target.checked);
      if (!event.target.checked) { generation.current++; clearTimeout(timer.current); setBusy(false); setRaw(undefined); setConverted(undefined); }
    }} />显示诊断面板与 Marker</label>
    {enabled && <>
      <p>仅本地开发诊断，不进入计划。采样会向百度转换服务发送浏览器坐标；不写入日志或存储。</p>
      <button type="button" disabled={busy} onClick={sampleBrowser}>采样原生定位并转换（仅诊断）</button>
      <p role="status">{message}</p>
      <p>SDK_CURRENT lat/lng: {coords(observed.sdk)}<br />source: {observed.sdk?.source ?? "等待正常定位或旧入口定位"}<br />SDK accuracyMeters: {observed.sdk?.accuracyMeters ?? "unknown"}（SDK 返回值，不等同于原生浏览器精度）</p>
      <p>RAW_BROWSER lat/lng: {coords(raw)}<br />accuracyMeters: {raw?.accuracy ?? "unknown"}<br />timestamp: {raw ? new Date(raw.timestamp).toISOString() : "unknown"}<br />positionAgeSeconds: {raw ? Math.max(0, (now - raw.timestamp) / 1000).toFixed(1) : "unknown"}</p>
      <p>BROWSER_TO_BAIDU lat/lng: {coords(converted)}<br />conversion: BMap.Convertor.translate(points, 1, 5), WGS84 → BD-09</p>
      <p>ROUTE_ORIGIN lat/lng: {coords(observed.route)}<br />source: {observed.route?.source ?? "尚未开始路线计算"}<br />lastObserved: {observed.route ? new Date(observed.route.observedAt).toISOString() : "unknown"}</p>
      <p>VISIBLE_MARKER_SOURCE: {observed.visibleSource ?? "尚未观察"}<br />PLANNER_ORIGIN_SOURCE: {observed.plannerSource ?? "尚未观察"}</p>
      <p>SDK_CURRENT ↔ BROWSER_TO_BAIDU: {distance(observed.sdk, converted)}<br />SDK_CURRENT ↔ ROUTE_ORIGIN: {distance(observed.sdk, observed.route)}<br />BROWSER_TO_BAIDU ↔ ROUTE_ORIGIN: {distance(converted, observed.route)}</p>
      <p>ROUTE_ORIGIN 保留最近实际进入路线计算的起点（含缓存命中），并非仅发现候选后的预期起点。标签有显示偏移，Marker 锚点未移动。</p>
    </>}
  </section>;
}
