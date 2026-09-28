import { useState } from "react";
import { Planner } from "./Planner";
import { replayCapture, replayData, replayPoolSummary } from "./demo/replayData";
import type { ReturnMode } from "./recommendation/model";

const noop = () => {};
const noNetwork = async () => { throw new Error("离线模式不请求实时接口"); };

export function PublicReplay() {
  const [returnMode, setReturnMode] = useState<ReturnMode>("open_ended");
  return <section aria-label="公开区域历史案例">
    <div className="map-development-access">
      <h1>公开区域离线 Demo</h1>
      <p>采集日期 {replayCapture.capturedAt.slice(0, 10)} · {replayCapture.routes.length} 个真实地点及去程路线 · 按当前 v3 规则推荐</p>
      <p>历史数据不保证当前营业或通行状态；地点详情、排序与行程单均可离线查看。</p>
      <details><summary>历史候选分类分布</summary>
        <p>随心安排在没有文字需求时默认附近探索。下列候选按每个完整分类标签最多5个保留；使用已采集的分页历史记录，延长预算不会发起新搜索。历史记录尚无地点之间的路线。</p>
        {replayPoolSummary.map(pool => <div key={pool.goal}>
          <h2>{{ rest: "歇一会儿", walk: "散散步", discover: "逛点新鲜的" }[pool.goal]} · {pool.count} 个候选</h2>
          <ul>{Object.entries(pool.tags).map(([tag, count]) => <li key={tag}>{tag.replaceAll(";", " > ")}：{count}</li>)}</ul>
        </div>)}
      </details>
    </div>
    <Planner returnMode={returnMode} onReturnModeChange={setReturnMode} onSearchPolicyChange={noop}
      prepareReal={noNetwork} cancelReal={noop} realRevision={0} realStatus="ready"
      realMessage="公开测试起点 · 历史真实候选 · 不调用在线接口"
      replay={{ capturedAt: replayCapture.capturedAt, prepare: replayData }} />
  </section>;
}
