import type { Recommendation } from "../recommendation/model";
import type { BuildResult, BuildStatus, MultiRoute } from "./model";

// Shared presentation shape only. A multi-stop result is not a single-place
// Recommendation and does not acquire its strategy or decision trace.
export type JourneyPlan = Pick<Recommendation, "id" | "title" | "source" | "steps" | "places" | "routes" | "totalMinutes" | "bufferMinutes" | "remainingMinutes" | "returnMode" | "originName" | "costCaveat"> & { previewCapturedAt?: string };
export function multiJourney(route: MultiRoute): JourneyPlan {
  return { id: route.id, title: route.title, source: route.source, steps: route.steps,
    places: route.stops.map(stop => stop.poi), routes: route.edges, totalMinutes: route.totalMinutes, bufferMinutes: route.bufferMinutes,
    remainingMinutes: route.remainingMinutes, returnMode: "open_ended", originName: route.originName,
    costCaveat: "各站百度商户价格不代表整条路线的实际总消费；营业时间及到达时可入场情况请自行核实。" };
}
const messages: Record<BuildStatus, string> = {
  ok: "",
  not_applicable: "当前时长保留单地点安排。",
  unsupported_mode: "多地点路线支持步行、不返程。",
  no_feasible_multi_stop: "暂未找到合适的多地点路线，可以先选单地点安排。",
  missing_candidate_facts: "地点或路线资料不足，暂无法生成多地点路线。",
  missing_offline_edges: "这个历史案例暂缺站间路线，请查看单地点安排。",
  provider_unavailable: "部分路线查询失败，请稍后重试。",
  search_incomplete: "暂未找到合适的多地点路线，可以先选单地点安排。",
  no_route_for_anchor: "暂未找到合适的多地点路线，试试增加时间。",
};
export function MultiStopResults({ result, loading, error, stale, replay, selectedId, onChoose, auditEnabled }: {
  result: BuildResult | null; loading: boolean; error: string; stale: boolean; replay: boolean;
  selectedId?: string; onChoose: (plan: JourneyPlan) => void; auditEnabled: boolean;
}) {
  if (!result && !loading && !error) return null;
  return <section className="multi-stop-results" aria-labelledby="multi-stop-title" aria-busy={loading}>
    <h3 id="multi-stop-title">多地点路线</h3>
    {loading && <p role="status">正在核对地点之间的路线…</p>}
    {error && <p role="status">多地点暂不可用，单地点安排不受影响。</p>}
    {result && messages[result.status] && <p role="status">{messages[result.status]}</p>}
    {result?.routes.map(route => <article key={route.id} className={`plan${selectedId === route.id ? " selected" : ""}`}>
      <div className="plan-top"><span className="plan-badge">{replay ? "历史案例" : route.source === "mock" ? "MOCK" : "附近"} · {route.stops.length} 站</span><span className="total">{Number(route.totalMinutes.toFixed(1))}<small>分钟</small></span></div>
      <h4>{route.title}</h4>
      <p className="route">{route.originName} → {route.stops.map(stop => stop.poi.name).join(" → ")}</p>
      <div className="metrics"><span>步行 {Number((route.travelSeconds / 60).toFixed(1))} 分</span><span>停留 {route.displayDwell.reduce((a, b) => a + b, 0)} 分</span><span>缓冲 {route.bufferMinutes} 分</span></div>
      <p>{route.stops.map(stop => stop.familyLabel).join(" · ")}；终点是{route.stops.at(-1)?.poi.name}。余量 {Number(route.remainingMinutes.toFixed(1))} 分钟。</p>
      
      <details><summary>查看时间安排</summary><ol className="timeline">{route.steps.map((step, index) => <li key={index}><small>{step.kind} · {Number(step.minutes.toFixed(1))} 分钟</small>{step.label}</li>)}</ol></details>
      <button type="button" className="select" disabled={stale} onClick={() => onChoose(multiJourney(route))}>就选这条路线 ↗</button>
    </article>)}
    {auditEnabled && result && <details><summary>多地点开发审计</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify({ status: result.status, ...result.audit, routes: result.routes.map(route => ({ weakestGoal: route.weakestGoal, strongProportion: route.strongProportion, travelSeconds: route.travelSeconds, geometry: route.geometry, minRating: route.minRating, meanMerchantPrice: route.meanMerchantPrice, exactDwell: route.exactDwell, displayDwell: route.displayDwell,
      families: route.stops.map(stop => stop.family), dwellRanges: route.stops.map(stop => stop.range), remainingMinutes: route.remainingMinutes,
      unusedAfterDwellMaxMinutes: route.unusedAfterDwellMaxMinutes, displayRoundingMinutes: route.displayRoundingMinutes })) }, null, 2)}</pre></details>}
  </section>;
}
