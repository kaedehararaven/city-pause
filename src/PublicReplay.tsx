import type { ComponentProps } from "react";
import type { Planner } from "./Planner";
import { replayCapture, replayData, replayPoolSummary, replayPools, replayOrigins, replayInterStopEdges, type ReplayScenario } from "./demo/replayData";
import { replayMultiData } from "./demo/multiReplay";
import { restShowcase } from "./demo/restShowcase";
import { demoMapPreview } from "./demo/mapPreview";

export function replayConfiguration(scenario: ReplayScenario): NonNullable<ComponentProps<typeof Planner>["replay"]> {
  return { capturedAt: replayCapture.capturedAt, mapPlan: demoMapPreview,
    prepare: intent => replayData(intent, scenario), multi: intent => replayMultiData(intent, scenario),
    selectMulti: (result, intent, signal) => restShowcase(result, intent, scenario, signal) };
}

export function ReplayOptions({ scenario, onChange }: { scenario: ReplayScenario; onChange: (value: ReplayScenario) => void }) {
  return <div className="replay-options">
    <label htmlFor="replay-area">公开演示区域</label>
    <select id="replay-area" value={scenario} onChange={event => onChange(event.target.value as ReplayScenario)}>
      <option value="compact">王府井商业街周边</option><option value="original">原公开测试起点</option>
    </select>
    <p className="fine">历史真实样本 · {replayCapture.capturedAt.slice(0, 10)}</p>
    <details><summary>样本库记录</summary>
      <p className="fine">{new Set(Object.values(replayPools(scenario)).flat().map(c => c.poi.providerId)).size} 个真实地点</p>
      <p className="fine">{replayOrigins[scenario].name} · {replayInterStopEdges.filter(edge => edge.status === "success").length} 条已记录有向路线</p>
      {scenario === "compact" && <p className="fine">休息精选案例：咖啡厅与甜品店各一条。</p>}
      <details><summary>历史候选分类分布</summary>{replayPoolSummary(scenario).map(pool => <div key={pool.goal}><p className="fine">{ { rest: "歇一会儿", walk: "散散步", discover: "逛点新鲜的" }[pool.goal]}：{pool.count} 个候选</p><ul>{Object.entries(pool.tags).map(([tag, count]) => <li key={tag}>{tag.replaceAll(";", " > ")}：{count}</li>)}</ul></div>)}</details>
    </details>
  </div>;
}
