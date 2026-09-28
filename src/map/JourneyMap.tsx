import { useEffect, useRef, useState } from "react";
import type { JourneyPlan } from "../route-builder/MultiStopResults";
import { loadBaiduMap } from "./loadBaiduMap";
import { navigationUrl } from "./journeyNavigation";
import { routeMetrics } from "../contracts/map";

export function JourneyMap({ plan }: { plan: JourneyPlan }) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const focusRoute = useRef<(index: number) => void>(() => {});
  useEffect(() => { focusRoute.current(active); }, [active]);
  useEffect(() => {
    let disposed = false, map: BMap.Map | undefined;
    setError(""); setLoading(true);
    const ak = import.meta.env.VITE_BAIDU_BROWSER_AK?.trim();
    if (!ak) { setError("地图配置暂不可用，仍可打开分段导航。"); setLoading(false); return; }
    void loadBaiduMap(ak).then(api => {
      if (disposed || !container.current) return;
      map = new api.Map(container.current);
      map.enableScrollWheelZoom();
      const point = (p: { longitude: number; latitude: number }) => new api.Point(p.longitude, p.latitude);
      const origin = plan.routes[0]?.from;
      if (!origin) throw new Error("missing origin");
      const stops = [{ name: "起点", location: origin.location }, ...plan.places.map((p,i) => ({ name: `${i+1}. ${p.name}`, location: p.location }))];
      const lines: { line: BMap.Polyline; index: number; points: BMap.Point[] }[] = [];
      plan.routes.forEach((route, index) => {
        for (const segment of route.geometry ?? []) {
          if (segment.length < 2) continue;
          const points = segment.map(point);
          const line = new api.Polyline(points, { strokeColor: "#236e50", strokeWeight: 6, strokeOpacity: 0.9 });
          lines.push({ line, index, points }); map!.addOverlay(line);
        }
      });
      const labels = stops.map((stop, index) => {
        const label = new api.Label("", { position: point(stop.location), offset: new api.Size(-17, -17) });
        // Provider text never enters an SDK HTML label unescaped.
        const badge = document.createElement("span");
        badge.className = `journey-pin${index === 0 ? " origin" : ""}`;
        badge.textContent = index === 0 ? "起" : String(index);
        badge.title = stop.name;
        const caption = document.createElement("span"); caption.className = "journey-pin-caption"; caption.textContent = stop.name;
        label.setContent(badge.outerHTML + caption.outerHTML);
        label.setStyles({ border: "none", background: "transparent", padding: "0" });
        map!.addOverlay(label);
        return label;
      });
      focusRoute.current = index => {
        const visible = index < 0 ? stops.map(s => point(s.location)) : [point(plan.routes[index].from.location), point(plan.routes[index].to.location)];
        for (const entry of lines) {
          const highlighted = index < 0 || entry.index === index;
          entry.line.setStrokeColor(highlighted ? "#236e50" : "#a0aaa4");
          entry.line.setStrokeWeight(highlighted ? 6 : 3);
          entry.line.setStrokeOpacity(highlighted ? 0.95 : 0.4);
          if (highlighted) visible.push(...entry.points);
        }
        labels.forEach((label, stopIndex) => label.setStyles({ opacity: index < 0 || stopIndex === index || stopIndex === index + 1 ? "1" : "0.65" }));
        map!.setViewport(visible);
      };
      focusRoute.current(activeRef.current);
      setLoading(false);
    }).catch(() => { if (!disposed) { setError("地图加载失败，仍可打开分段导航。"); setLoading(false); } });
    return () => { disposed = true; focusRoute.current = () => {}; map?.destroy(); };
  }, [plan]);
  const name = (id: string) => plan.places.find(p => p.providerId === id)?.name ?? plan.originName;
  return <section className="journey-map" aria-label="行程地图与导航">
    <div className="journey-map-toolbar"><div><strong>沿途导航</strong><span>{plan.routes.length} 段行程 · {plan.places.length} 个地点</span></div>
      <button type="button" title="查看完整路线" onClick={() => setActive(-1)} aria-pressed={active === -1}>全程</button>
    </div>
    <div ref={container} className="journey-map-canvas" aria-label="百度地图" />
    {loading && <p role="status">地图加载中…</p>}
    {error && <p role="status">{error}</p>}
    {plan.previewCapturedAt && <p className="fine">历史路线 · {plan.previewCapturedAt.slice(0, 10)}</p>}
    {plan.routes.some(route => !route.geometry?.length) && <p className="fine">部分路段暂无预览，可打开百度导航。</p>}
    <ol className="journey-navigation">{plan.routes.map((route, index) => {
      const metrics = routeMetrics(route);
      return <li key={index} className={active === index ? "active" : ""}>
      <button type="button" className="journey-leg" aria-pressed={active === index} onClick={() => setActive(index)}>
        <span className="journey-leg-number" aria-hidden="true">{index+1}</span>
        <span className="journey-leg-copy"><strong>{name(route.from.id)} → {name(route.to.id)}</strong><small>{route.mode === "walking" ? "步行" : "骑行"} {Number((metrics.durationSeconds / 60).toFixed(1))} 分钟 · {Math.round(metrics.distanceMeters)} 米</small></span>
      </button>
      <a className="journey-navigate" aria-label={`打开百度导航：${name(route.from.id)}到${name(route.to.id)}`} href={navigationUrl(route, name(route.from.id), name(route.to.id))} target="_blank" rel="noopener noreferrer">打开百度导航 <span aria-hidden="true">↗</span></a>
    </li>; })}</ol>
    
  </section>;
}
