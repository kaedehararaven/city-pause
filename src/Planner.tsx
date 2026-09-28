import { useEffect, useRef, useState, type FormEvent } from "react";
import { buildDecisionResult } from "./recommendation/engine";
import { recommendationAudit } from "./recommendation/audit";
import { parseUserIntent } from "./recommendation/intent";
import { createMockCandidateProvider } from "./recommendation/mock";
import { merchantPrice } from "./recommendation/factors";
import { buildGoalSupplyPolicy, type GoalSupplyPolicy } from "./recommendation/goalCandidateSupply";
import type { Activity, CandidateData, Recommendation, ReturnMode, UserIntent } from "./recommendation/model";
import "./planner.css";
import { ForestHero } from "./ForestHero";
import { JourneySheet } from "./JourneySheet";
import "./forest.css";

const mockData = createMockCandidateProvider().getCandidateData();
const activities = [
  ["auto", "随心安排"], ["rest", "歇一会儿"],
  ["walk", "散散步"], ["explore", "逛点新鲜的"],
] as const;
const activityNames: Record<Activity, string> = { rest: "休息片刻", walk: "短距离散步", explore: "附近探索" };

// Display only; feasibility and timeline accumulation retain exact values.
const displayMinutes = (value: number) => Number(value.toFixed(1));

function planText(plan: Recommendation) {
  let elapsed = 0;
  return [
    `城市暂停键 · ${plan.title}`,
    plan.source === "mock" ? "Demo：地点、路线与时间均为模拟数据。" : "路线时间来源：已验证地图数据。",
    ...plan.steps.map((step) => {
      const start = elapsed;
      elapsed += step.minutes;
      return `第 ${displayMinutes(start)}～${displayMinutes(elapsed)} 分钟｜${step.kind}：${step.label}`;
    }),
    ...(plan.costCaveat ? [plan.costCaveat] : []),
    `总耗时 ${displayMinutes(plan.totalMinutes)} 分钟（含 ${displayMinutes(plan.bufferMinutes)} 分钟缓冲），预算剩余 ${displayMinutes(plan.remainingMinutes)} 分钟。`,
    (plan.returnMode === "return_to_start") ? `终点：${plan.originName}（返回起点）` : `终点：${plan.places.at(-1)?.name}`,
  ].join("\n");
}

export function Planner({
  returnMode,
  onReturnModeChange,
  onSearchPolicyChange,
  prepareReal,
  cancelReal,
  realRevision,
  realStatus,
  realMessage,
  onStageChange,
  replay,
}: {
  returnMode: ReturnMode;
  onReturnModeChange: (mode: ReturnMode) => void;
  onSearchPolicyChange: (policy: GoalSupplyPolicy | null) => void;
  prepareReal: (intent: UserIntent) => Promise<CandidateData>;
  cancelReal: () => void;
  realRevision: unknown;
  realStatus: "idle" | "loading" | "ready" | "error";
  realMessage: string;
  onStageChange?: (active: boolean) => void;
  replay?: { capturedAt: string; prepare: (intent: UserIntent) => CandidateData };
}) {
  const [started, setStarted] = useState(!!replay);
  const [dataMode, setDataMode] = useState<"mock" | "real">(replay ? "real" : "mock");
  const [minutes, setMinutes] = useState(replay ? "60" : "30");
  const [activity, setActivity] = useState<Activity | "auto">("auto");
  const [text, setText] = useState("");
  const [avoidCost, setAvoidCost] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationRef = useRef(0);
  const [plans, setPlans] = useState<Recommendation[] | null>(null);
  const [audit, setAudit] = useState<ReturnType<typeof recommendationAudit> | null>(null);
  const auditEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("audit") === "1";
  const [lastIntent, setLastIntent] = useState<UserIntent | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "distance" | "rating" | "price">("default");
  const [showAll, setShowAll] = useState(false);
  const [clarification, setClarification] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const budget = Number(minutes);
    onSearchPolicyChange(Number.isInteger(budget) && budget >= 5 && budget <= 180
      ? buildGoalSupplyPolicy(parseUserIntent({ minutes: budget, activity, text, avoidCost, nearby, returnMode }))
      : null);
  }, [minutes, activity, text, avoidCost, nearby, returnMode, onSearchPolicyChange]);

  useEffect(() => {
    setPlans(null);
    setLastIntent(null);
    setSelected(null);
    dialogRef.current?.close();
    generationRef.current++;
    cancelReal();
    setGenerating(false);
  }, [realRevision, returnMode, cancelReal]);

  const changed = () => { generationRef.current++; cancelReal(); setGenerating(false); if (plans !== null) setStale(true); setSelected(null); setError(""); };
  async function generate(event?: FormEvent) {
    event?.preventDefault();
    const budget = Number(minutes);
    if (!minutes || !Number.isInteger(budget) || budget < 5 || budget > 180) {
      setError("请输入 5～180 之间的整数分钟。");
      return;
    }
    const intent = parseUserIntent({ minutes: budget, activity, text, avoidCost, nearby, returnMode });
    const textTime = text.match(/(\d+)\s*分钟/);
    const noReturn = /不用回|不必回|不回|无需回/.test(text);
    const yesReturn = !noReturn && /回到|返回|回起点/.test(text);
    const notes: string[] = [];
    if (textTime && Number(textTime[1]) !== budget) notes.push(`文字时间与表单不同；本次按 ${budget} 分钟计算。`);
    if ((noReturn && returnMode === "return_to_start") || (yesReturn && returnMode === "open_ended")) notes.push("文字返程需求与开关不同；本次按返程开关计算。");
    if (activity !== "auto") notes.push("所选活动按钮优先于文字推断。");
    setClarification(notes.join(""));
    const generation = ++generationRef.current;
    setAudit(null);
    setGenerating(true);
    setStale(false);
    setLastIntent(intent);
    setError("");
    setPlans(null);
    try {
      const data = replay ? replay.prepare(intent) : dataMode === "real" ? await prepareReal(intent) : mockData;
      if (generation !== generationRef.current) return;
      const result = buildDecisionResult(intent, data);
      if (result.status === "unsupported_must") throw new Error(`UNSUPPORTED_VERIFIED_MUST: ${result.diagnostics[0].reason}`);
      if (auditEnabled) setAudit(recommendationAudit(intent, data, result));
      setPlans(result.recommendations);
      setLastIntent(intent);
      setStale(false);
      setSelected(null);
    } catch (error) {
      if (generation !== generationRef.current) return;
      setError(error instanceof Error ? error.message : "真实路线暂不可用，请重试。");
    } finally {
      if (generation === generationRef.current) setGenerating(false);
    }
  }
  function choose(plan: Recommendation) {
    setSelected(plan);
    setCopyStatus("");
  }
  async function copy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText((replay ? `历史真实数据回放 · ${replay.capturedAt}\n` : "") + planText(selected));
      setCopyStatus("已复制，可粘贴到记事本保存。");
    } catch {
      copyRef.current?.focus();
      copyRef.current?.select();
      setCopyStatus("自动复制不可用，已选中文本，请按 Command/Ctrl+C 复制。");
    }
  }
  const summary = lastIntent && [
    `${lastIntent.availableMinutes} 分钟`, activityNames[lastIntent.activity],
    lastIntent.avoidCost ? "优先不消费（费用待核实）" : "消费不限",
    lastIntent.nearby ? "优先少走（软偏好）" : "步行计入总时间",
    (lastIntent.returnMode === "return_to_start") ? "返回起点" : "无需返回",
    lastIntent.excludedKinds.length ? `排除：${lastIntent.excludedKinds.map(kind => mockData.places.find(place => place.kind === kind)?.categoryLabel ?? kind).join("、")}` : "",
  ].filter(Boolean).join(" · ");
  const orderedPlans = plans ? [...plans].sort((a, b) => {
    if (sortMode === "distance") return a.travelMinutes - b.travelMinutes || a.id.localeCompare(b.id);
    if (sortMode === "rating") return (b.places[0].rating ?? -Infinity) - (a.places[0].rating ?? -Infinity) || a.id.localeCompare(b.id);
    if (sortMode === "price") {
      const aPrice = merchantPrice(a.places[0].priceText);
      const bPrice = merchantPrice(b.places[0].priceText);
      if (aPrice !== null && bPrice !== null && aPrice !== bPrice) return aPrice - bPrice;
      if (aPrice !== null && bPrice === null) return -1;
      if (aPrice === null && bPrice !== null) return 1;
      return a.id.localeCompare(b.id);
    }
    return plans.indexOf(a) - plans.indexOf(b);
  }) : null;

  return <div className="planner forest-theme">
    <header className="nav"><a className="brand" href="#home" onClick={event => { event.preventDefault(); setStarted(false); onStageChange?.(false); changed(); }}><span className="logo">Ⅱ</span> 城市暂停键</a><span className="demo">{replay ? "REPLAY · 公开区域真实记录" : dataMode === "real" ? "REAL · 百度地图事实" : "MOCK / DEMO · 模拟数据"}</span></header>
    <main>
      {replay && <p role="note" className="replay-notice">历史真实数据 · {replay.capturedAt} · 当前 v3 规则重算 · 非实时定位或营业保证</p>}
      {!started && <ForestHero onStart={() => { setStarted(true); onStageChange?.(true); }} />}
      <div hidden={!started} className="planner-stage">
      <div className="location forest-location"><span className="dot"/> {dataMode === "real" ? "真实搜索起点" : "示例街区 · 中心广场"} <small>{dataMode === "real" ? realStatus === "ready" ? "REAL · 真实候选已就绪" : "REAL 数据尚未就绪" : "演示起点，非实时定位"}</small></div>
      <div className="workspace"><section id="planner-input" className="input-panel" aria-labelledby="inputTitle"><div className="section-top"><span className="eyebrow">01 / 说说你的现在</span><span className="mini">随时可以调整</span></div><h2 id="inputTitle">这段时间，想怎么过？</h2>
        <form onSubmit={generate} noValidate>
          <fieldset><legend><label htmlFor="planner-data-source">数据来源</label></legend><select id="planner-data-source" className="source-select" disabled={!!replay} value={dataMode} onChange={(event) => { setDataMode(event.target.value as "mock" | "real"); changed(); }}><option value="mock">MOCK / DEMO · 模拟数据</option><option value="real">{replay ? "REPLAY · 历史真实记录" : "REAL · 百度地图事实"}</option></select><p className="fine source-note">{dataMode === "mock" ? "使用虚构地点与路线，便于稳定测试。" : realMessage}</p></fieldset>
          <fieldset><legend>有多久空闲？</legend><div className="times">{[30,45,60].map(value => <button key={value} type="button" className={minutes === String(value) ? "active" : ""} aria-pressed={minutes === String(value)} onClick={() => { setMinutes(String(value)); changed(); }}>{value}<small>分钟</small></button>)}</div><div className="custom"><label htmlFor="planner-minutes">更多时间</label><select id="planner-minutes" value={Number(minutes) > 60 ? minutes : ""} onChange={event => { setMinutes(event.target.value); changed(); }}><option value="" disabled>60 分钟以上</option>{[90,120,150,180].map(value => <option key={value} value={value}>{value} 分钟</option>)}</select></div></fieldset>
          <fieldset><legend>现在更想……</legend><div className="moods">{activities.map(([value,label]) => <button key={value} type="button" className={activity === value ? "active" : ""} aria-pressed={activity === value} onClick={() => { setActivity(value); changed(); }}>{label}</button>)}</div></fieldset>
          <label className="field-label" htmlFor="planner-need">再说一点你的想法 <small>选填</small></label><textarea id="planner-need" rows={3} value={text} onChange={event => { setText(event.target.value); changed(); }} placeholder="比如：走累了，不想花钱，最后要回到这里。"/><div className="examples">{["走累了，不想花钱", "等朋友，不想走远"].map(example => <button key={example} type="button" onClick={() => { setText(example); changed(); }}>{example} ↗</button>)}</div>
          <div className="preferences"><label><input type="checkbox" checked={avoidCost} onChange={event => { setAvoidCost(event.target.checked); changed(); }}/> 不想花钱</label><label><input type="checkbox" checked={nearby} onChange={event => { setNearby(event.target.checked); changed(); }}/> 少走一点</label></div><label className="return-row"><input type="checkbox" checked={returnMode === "return_to_start"} onChange={event => { onReturnModeChange(event.target.checked ? "return_to_start" : "open_ended"); changed(); }}/><span>最后回到这里<small>默认无需返回起点；勾选后计入返程</small></span><span aria-hidden="true">↩</span></label>
          {error && <p className="error" role="alert">{error}</p>}<button type="submit" className="primary" disabled={generating}>{generating ? "正在核对真实路线…" : "看看我的暂停方案"} <span>→</span></button><p className="fine">{dataMode === "mock" ? "本模式使用规则匹配 · 地点与时间均为虚构演示" : realStatus === "ready" ? "生成时核对真实路线 · 停留和缓冲随时间预算调整" : "生成时自动定位和发现候选；失败时不会偷偷使用 Mock 替代"}</p>
        </form>
      </section>
      <section className="results" aria-labelledby="resultsTitle"><div className="section-top"><span className="eyebrow">02 / 你的时间，你来选</span><span className="mini">{plans === null ? "等待你的灵感" : `${plans.length} 个可行方案`}</span></div><h2 id="resultsTitle">{plans === null ? "一小段空闲，也有很多可能。" : plans.length ? `给这 ${lastIntent?.availableMinutes} 分钟，一点好安排。` : "这次的条件，暂时安排不下。"}</h2>
        {summary && <div className="summary">{summary}</div>}
        {clarification && <p className="fine" role="status">{clarification}</p>}
        {auditEnabled && audit && <details><summary>开发审计</summary><pre data-testid="recommendation-audit" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(audit)}</pre></details>}
        {stale && <div className="stale" role="status">条件已修改，请重新生成方案。<button type="button" onClick={() => generate()}>重新生成 →</button></div>}
        {plans === null ? <div className="empty"><div className="empty-symbol" aria-hidden="true">Ⅱ</div><h3>今天，想按下哪一种暂停？</h3><p>选好时间，我们会安排步行和停留，默认无需返回起点。<br/>不用赶路，也不用把每一分钟填满。</p><div className="possibilities"><span>歇一会儿</span><span>走一小圈</span><span>发现附近</span></div></div> : plans.length ? <>{<div className="sort-controls" aria-label="推荐排序"><button type="button" aria-pressed={sortMode === "default"} onClick={() => setSortMode("default")}>默认推荐</button><button type="button" aria-pressed={sortMode === "distance"} onClick={() => setSortMode("distance")}>距离优先</button><button type="button" aria-pressed={sortMode === "rating"} onClick={() => setSortMode("rating")}>评分优先</button><button type="button" aria-pressed={sortMode === "price"} onClick={() => setSortMode("price")}>价格优先</button></div>}{orderedPlans!.slice(0, showAll ? orderedPlans!.length : 6).map((plan, index) => <article key={plan.id} className={`plan${selected?.id === plan.id ? " selected" : ""}`}><div className="plan-top"><span className="plan-badge">{replay ? "REPLAY" : plan.source.toUpperCase()} · 0{index+1} / {plan.strategyLabel}</span><span className="total">{displayMinutes(plan.totalMinutes)}<small>分钟</small></span></div><h3>{plan.title}</h3><p className="route">{plan.originName} → {plan.places.map(place => place.name).join(" → ")}{(plan.returnMode === "return_to_start") ? ` → ${plan.originName}` : ""}</p><div className="metrics"><span>步行 {displayMinutes(plan.walkingMinutes)} 分</span><span>停留 {displayMinutes(plan.stayMinutes)} 分</span><span>缓冲 {displayMinutes(plan.bufferMinutes)} 分</span><span>{plan.costStatus === "required" ? "需要消费" : plan.costStatus === "not-required" ? "无需消费" : plan.places[0].priceText ? `百度商户价格 ${plan.places[0].priceText}（人均）` : "百度商户价格未知"}</span></div>{plan.costCaveat && <p role="note">{plan.costCaveat}</p>}<p className="reason">{plan.strategyReason}；{(plan.returnMode === "return_to_start") ? "已计入返程" : `终点是${plan.places.at(-1)?.name}`}，余量 {displayMinutes(plan.remainingMinutes)} 分钟。</p>{plan.source === "real" && plan.places.map(place => <PlaceDetails key={place.provider + place.providerId} poi={place} offline={!!replay} />)}<div className="plan-actions"><details><summary>查看时间安排</summary><ol className="timeline">{(() => { let elapsed = 0; return plan.steps.map((step, stepIndex) => { const start = elapsed; elapsed += step.minutes; return <li key={stepIndex}><small>第 {displayMinutes(start)}～{displayMinutes(elapsed)} 分钟 · {step.kind}</small>{step.label}</li>; }); })()}</ol></details><button type="button" className="select" disabled={stale} onClick={() => choose(plan)}>就选这个 ↗</button></div></article>)}{orderedPlans!.length > 6 && <button type="button" className="select" onClick={() => setShowAll(value => !value)}>{showAll ? "收起" : "查看更多"}</button>}</> : <div className="no-result"><h3>留一点更充裕的时间吧。</h3><p>{lastIntent?.avoidCost ? "当前没有路线和时间均合适的无需消费方案或待核实备选。可增加时间或重新搜索；不会把未知费用说成免费。" : lastIntent?.excludedKinds.length ? "当前地点类别信息不足以验证全部排除要求，未用搜索类别冒充地点事实。" : "当前候选的已验证路线无法同时满足时间、少走或返程要求。可调整条件或刷新附近地点。"}</p></div>}
        {plans && <p className="fine">{dataMode === "mock" ? "演示规则" : "当前推荐规则"}仅识别部分关键词，未识别的要求不会自动生效；具体以条件摘要为准。{plans.length > 0 && plans.length < 3 ? `当前仅找到 ${plans.length} 个可行方案。` : ""}</p>}
      </section><JourneySheet plan={selected} onSave={() => dialogRef.current?.showModal()} /></div><footer><span>城市暂停键 / 给日常留一点空白</span><span>{dataMode === "real" ? "REAL 地图事实 · DERIVED 推荐时间" : "MOCK：非真实定位、营业信息或导航"}</span></footer>
      </div>
    </main>
    <dialog ref={dialogRef} onClose={() => setCopyStatus("")}><button type="button" className="close" aria-label="关闭" onClick={() => dialogRef.current?.close()}>×</button><p className="eyebrow">YOUR LITTLE BREAK</p><h2>就这样，暂停一下。</h2><p className="muted">安排已选好，复制下来，留作演示参考。</p><textarea ref={copyRef} readOnly aria-label="已选方案安排" value={selected ? (replay ? `历史真实数据回放 · ${replay.capturedAt}\n` : "") + planText(selected) : ""}/><button type="button" className="primary" onClick={copy}>复制安排</button><p role="status" className="fine">{copyStatus}</p></dialog>
  </div>;
}
import { PlaceDetails } from "./map/PlaceDetails";
