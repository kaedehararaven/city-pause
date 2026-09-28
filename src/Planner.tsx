import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buildDecisionResult } from "./recommendation/engine";
import { recommendationAudit } from "./recommendation/audit";
import { parseUserIntent } from "./recommendation/intent";
import { merchantPrice } from "./recommendation/factors";
import { buildGoalSupplyPolicy, type GoalSupplyPolicy } from "./recommendation/goalCandidateSupply";
import type { Activity, CandidateData, Recommendation, ReturnMode, UserIntent } from "./recommendation/model";
import "./planner.css";
import { ForestHero } from "./ForestHero";
import { JourneySheet } from "./JourneySheet";
import { buildMultiWithSupply, type SupplementCache } from "./route-builder/supplement";
import { createWebPlaceSearch } from "./map/webPlaceSearch";
import { discoveryEnvelope } from "./map/discoveryEnvelope";
import { MultiStopResults, type JourneyPlan } from "./route-builder/MultiStopResults";
import type { BuildResult } from "./route-builder/model";
import type { EdgeCache } from "./route-builder/edges";
import { fetchWalkingRoute } from "./map/capabilityClient";
import "./forest.css";

const activities = [
  ["rest", "歇一会儿"],
  ["walk", "散散步"], ["explore", "逛点新鲜的"],
] as const;
const activityNames: Record<Activity, string> = { rest: "休息片刻", walk: "短距离散步", explore: "附近探索" };

// Display only; feasibility and timeline accumulation retain exact values.
const displayMinutes = (value: number) => Number(value.toFixed(1));

function planText(plan: JourneyPlan) {
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
  source, onSourceChange, sourceOptions, sourcePending = false, sourceRevision,
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
  source?: "real" | "replay";
  onSourceChange?: (source: "real" | "replay") => void;
  sourceOptions?: ReactNode;
  sourcePending?: boolean;
  sourceRevision?: string;
  replay?: { capturedAt: string; prepare: (intent: UserIntent) => CandidateData;
    mapPlan?: (plan: JourneyPlan) => JourneyPlan;
    selectMulti?: (result: BuildResult, intent: UserIntent, signal: AbortSignal) => Promise<BuildResult>;
    multi?: (intent: UserIntent) => { data: CandidateData; storedPois: import("./contracts/map").MapPOI[]; cache: EdgeCache } };
}) {
  const [started, setStarted] = useState(false);
  const [leavingHero, setLeavingHero] = useState(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(transitionTimer.current), []);
  const currentSource = source ?? (replay ? "replay" : "real");
  const [minutes, setMinutes] = useState(currentSource === "replay" ? "90" : "30");
  const [activity, setActivity] = useState<Activity>("rest");
  const [avoidCost, setAvoidCost] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationRef = useRef(0);
  const multiAbort = useRef<AbortController | null>(null);
  const multiCache = useRef<EdgeCache>(new Map());
  const multiSupplyCache = useRef<SupplementCache>(new Map());
  const [multi, setMulti] = useState<BuildResult | null>(null);
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiError, setMultiError] = useState("");
  const [plans, setPlans] = useState<Recommendation[] | null>(null);
  const [audit, setAudit] = useState<ReturnType<typeof recommendationAudit> | null>(null);
  const auditEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("audit") === "1";
  const [lastIntent, setLastIntent] = useState<UserIntent | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<JourneyPlan | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "distance" | "rating" | "price">("default");
  const [showAll, setShowAll] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const budget = Number(minutes);
    onSearchPolicyChange(Number.isInteger(budget) && budget >= 5 && budget <= 180
      ? buildGoalSupplyPolicy(parseUserIntent({ minutes: budget, activity, text: "", avoidCost, nearby, returnMode }))
      : null);
  }, [minutes, activity, avoidCost, nearby, returnMode, onSearchPolicyChange]);

  useEffect(() => {
    setPlans(null);
    setLastIntent(null);
    setSelected(null);
    setAudit(null); setError(""); setStale(false);
    dialogRef.current?.close();
    generationRef.current++;
    cancelReal();
    setGenerating(false);
    multiAbort.current?.abort();
    setMulti(null); setMultiLoading(false); setMultiError("");
  }, [realRevision, returnMode, cancelReal, sourceRevision]);

  useEffect(() => () => { generationRef.current++; multiAbort.current?.abort(); }, []);

  const changed = () => { generationRef.current++; cancelReal(); multiAbort.current?.abort(); setMulti(null); setMultiLoading(false); setMultiError(""); setGenerating(false); if (plans !== null) setStale(true); setSelected(null); setError(""); };
  async function generate(event?: FormEvent) {
    event?.preventDefault();
    if (sourcePending || (currentSource === "replay" && !replay)) return;
    const budget = Number(minutes);
    if (!minutes || !Number.isInteger(budget) || budget < 5 || budget > 180) {
      setError("请输入 5～180 之间的整数分钟。");
      return;
    }
    const intent = parseUserIntent({ minutes: budget, activity, text: "", avoidCost, nearby, returnMode });
    const generation = ++generationRef.current;
    multiAbort.current?.abort();
    const multiController = new AbortController();
    multiAbort.current = multiController;
    setMulti(null); setMultiLoading(false); setMultiError("");
    setAudit(null);
    setGenerating(true);
    setStale(false);
    setLastIntent(intent);
    setError("");
    setPlans(null);
    try {
      const data = replay ? replay.prepare(intent) : await prepareReal(intent);
      if (generation !== generationRef.current) return;
      const result = buildDecisionResult(intent, data);
      if (result.status === "unsupported_must") throw new Error(`UNSUPPORTED_VERIFIED_MUST: ${result.diagnostics[0].reason}`);
      if (auditEnabled) setAudit(recommendationAudit(intent, data, result));
      setPlans(result.recommendations);
      setLastIntent(intent);
      setStale(false);
      setSelected(null);
      // Publish singles first. Route Builder has independent results/errors and
      // never feeds its dwell/family/ranking back into the single-place engine.
      setGenerating(false);
      setMultiLoading(intent.availableMinutes >= 45);
      try {
        const historical = replay?.multi?.(intent);
        const multiResult = await buildMultiWithSupply({ intent, data: historical?.data ?? data, singles: result.recommendations,
          signal: multiController.signal,
          cache: historical?.cache ?? (replay || data.source === "mock" ? new Map() : multiCache.current),
          storedPois: historical?.storedPois,
          supplyCache: multiSupplyCache.current,
          search: !replay && data.source === "real" ? createWebPlaceSearch(data.origin.location, discoveryEnvelope(intent.availableMinutes).radiusMeters) : undefined,
          fetchEdge: !replay && data.source === "real" ? fetchWalkingRoute : undefined });
        const displayedMulti = replay?.selectMulti ? await replay.selectMulti(multiResult, intent, multiController.signal) : multiResult;
        if (generation === generationRef.current) setMulti(displayedMulti);
      } catch {
        if (generation === generationRef.current) setMultiError("multi_stop_unavailable");
      } finally {
        if (generation === generationRef.current) setMultiLoading(false);
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      setError(error instanceof Error ? error.message : "真实路线暂不可用，请重试。");
    } finally {
      if (generation === generationRef.current) setGenerating(false);
    }
  }
  function choose(plan: JourneyPlan) {
    setSelected(replay?.mapPlan ? replay.mapPlan(plan) : plan);
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
    lastIntent.excludedKinds.length ? `排除：${lastIntent.excludedKinds.join("、")}` : "",
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
    <header className="nav"><a className="brand" href="#home" onClick={event => { event.preventDefault(); setStarted(false); onStageChange?.(false); changed(); }}><span className="logo">Ⅱ</span> 城市暂停键</a><span className="demo">{currentSource === "replay" ? "Demo · 历史案例" : "附近出走"}</span></header>
    <main>
      {!started && <div className={leavingHero ? "hero-transition leaving" : "hero-transition"}><ForestHero onStart={() => {
        if (leavingHero) return;
        setLeavingHero(true);
        transitionTimer.current = setTimeout(() => { setStarted(true); setLeavingHero(false); onStageChange?.(true); }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 240);
      }} /></div>}
      <div hidden={!started} className="planner-stage">
      <div className="location forest-location"><span className="dot"/> {currentSource === "replay" ? "公开区域" : "我的附近"} <small>{currentSource === "replay" ? "历史案例" : realStatus === "ready" ? "已就绪" : "生成时定位"}</small></div>
      <div className="workspace"><section id="planner-input" className="input-panel" aria-labelledby="inputTitle"><div className="section-top"><span className="eyebrow">01 / 说说你的现在</span><span className="mini">随时可以调整</span></div><h2 id="inputTitle">这段时间，想怎么过？</h2>
        <form onSubmit={generate} noValidate>
          <fieldset><legend><label htmlFor="planner-data-source">出走地点</label></legend><select id="planner-data-source" className="source-select" value={currentSource} onChange={event => { changed(); setPlans(null); setAudit(null); onSourceChange?.(event.target.value as "real" | "replay"); }}><option value="replay">Demo · 公开区域历史案例</option><option value="real">我附近的地点</option></select>{auditEnabled && <p className="fine source-note">{realMessage}</p>}{sourceOptions}</fieldset>
          <fieldset><legend>有多久空闲？</legend><div className="times">{[30,45,60].map(value => <button key={value} type="button" className={minutes === String(value) ? "active" : ""} aria-pressed={minutes === String(value)} onClick={() => { setMinutes(String(value)); changed(); }}>{value}<small>分钟</small></button>)}</div><div className="custom"><label htmlFor="planner-minutes">更多时间</label><select id="planner-minutes" value={Number(minutes) > 60 ? minutes : ""} onChange={event => { setMinutes(event.target.value); changed(); }}><option value="" disabled>60 分钟以上</option>{[90,120,150,180].map(value => <option key={value} value={value}>{value} 分钟</option>)}</select></div></fieldset>
          <fieldset><legend>现在更想……</legend><div className="moods">{activities.map(([value,label]) => <button key={value} type="button" className={activity === value ? "active" : ""} aria-pressed={activity === value} onClick={() => { setActivity(value); changed(); }}>{label}</button>)}</div></fieldset>
          <div className="preferences"><label><input type="checkbox" checked={avoidCost} onChange={event => { setAvoidCost(event.target.checked); changed(); }}/> 不想花钱</label><label><input type="checkbox" checked={nearby} onChange={event => { setNearby(event.target.checked); changed(); }}/> 少走一点</label></div><label className="return-row"><input type="checkbox" checked={returnMode === "return_to_start"} onChange={event => { onReturnModeChange(event.target.checked ? "return_to_start" : "open_ended"); changed(); }}/><span>最后回到这里<small>默认无需返回起点；勾选后计入返程</small></span><span aria-hidden="true">↩</span></label>
          {error && <p className="error" role="alert">{error}</p>}<button type="submit" className="primary" disabled={sourcePending || generating || multiLoading}>{sourcePending ? "正在加载样本库…" : generating ? "正在核对路线…" : multiLoading ? "正在核对多地点路线…" : "看看我的暂停方案"} <span>→</span></button>
        </form>
      </section>
      <section className="results" aria-labelledby="resultsTitle"><div className="section-top"><span className="eyebrow">02 / 你的时间，你来选</span><span className="mini">{plans === null ? "等待你的灵感" : `${plans.length} 个可行方案`}</span></div><h2 id="resultsTitle">{plans === null ? "一小段空闲，也有很多可能。" : plans.length ? `给这 ${lastIntent?.availableMinutes} 分钟，一点好安排。` : "这次的条件，暂时安排不下。"}</h2>
        {summary && <div className="summary">{summary}</div>}
        {auditEnabled && audit && <details><summary>开发审计</summary><pre data-testid="recommendation-audit" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(audit)}</pre></details>}
        {stale && <div className="stale" role="status">条件已修改，请重新生成方案。<button type="button" onClick={() => generate()}>重新生成 →</button></div>}
        {plans !== null && <h3>单地点安排</h3>}
        {plans === null ? <div className="empty"><div className="empty-symbol" aria-hidden="true">Ⅱ</div><h3>今天，想按下哪一种暂停？</h3><p>选好时间，我们会安排步行和停留，默认无需返回起点。<br/>不用赶路，也不用把每一分钟填满。</p><div className="possibilities"><span>歇一会儿</span><span>走一小圈</span><span>发现附近</span></div></div> : plans.length ? <>{<div className="sort-controls" aria-label="推荐排序"><button type="button" aria-pressed={sortMode === "default"} onClick={() => setSortMode("default")}>默认推荐</button><button type="button" aria-pressed={sortMode === "distance"} onClick={() => setSortMode("distance")}>距离优先</button><button type="button" aria-pressed={sortMode === "rating"} onClick={() => setSortMode("rating")}>评分优先</button><button type="button" aria-pressed={sortMode === "price"} onClick={() => setSortMode("price")}>价格优先</button></div>}{orderedPlans!.slice(0, showAll ? orderedPlans!.length : 6).map((plan, index) => <article key={plan.id} className={`plan${selected?.id === plan.id ? " selected" : ""}`}><div className="plan-top"><span className="plan-badge">{replay ? "历史案例" : plan.source === "mock" ? "MOCK" : "附近"} · 0{index+1} / {plan.strategyLabel}</span><span className="total">{displayMinutes(plan.totalMinutes)}<small>分钟</small></span></div><h3>{plan.title}</h3><p className="route">{plan.originName} → {plan.places.map(place => place.name).join(" → ")}{(plan.returnMode === "return_to_start") ? ` → ${plan.originName}` : ""}</p><div className="metrics"><span>步行 {displayMinutes(plan.walkingMinutes)} 分</span><span>停留 {displayMinutes(plan.stayMinutes)} 分</span><span>缓冲 {displayMinutes(plan.bufferMinutes)} 分</span><span>{plan.costStatus === "required" ? "需要消费" : plan.costStatus === "not-required" ? "无需消费" : plan.places[0].priceText ? `百度商户价格 ${plan.places[0].priceText}（人均）` : "暂无价格"}</span></div>{lastIntent?.avoidCost && plan.costCaveat && <p role="note">费用待确认</p>}<p className="reason">{(plan.returnMode === "return_to_start") ? "已计入返程" : `终点是${plan.places.at(-1)?.name}`}，余量 {displayMinutes(plan.remainingMinutes)} 分钟。</p>{plan.source === "real" && plan.places.map(place => <PlaceDetails key={place.provider + place.providerId} poi={place} offline={!!replay} />)}<div className="plan-actions"><details><summary>查看时间安排</summary><ol className="timeline">{(() => { let elapsed = 0; return plan.steps.map((step, stepIndex) => { const start = elapsed; elapsed += step.minutes; return <li key={stepIndex}><small>第 {displayMinutes(start)}～{displayMinutes(elapsed)} 分钟 · {step.kind}</small>{step.label}</li>; }); })()}</ol></details><button type="button" className="select" disabled={stale} onClick={() => choose(plan)}>就选这个 ↗</button></div></article>)}{orderedPlans!.length > 6 && <button type="button" className="select" onClick={() => setShowAll(value => !value)}>{showAll ? "收起" : "查看更多"}</button>}</> : <div className="no-result"><h3>留一点更充裕的时间吧。</h3><p>{lastIntent?.avoidCost ? "暂未找到合适的不消费方案，试试增加时间或调整条件。" : lastIntent?.excludedKinds.length ? "暂未找到符合地点要求的方案，试试调整条件。" : "暂未找到合适的路线，试试增加时间或重新搜索附近地点。"}</p></div>}

        <MultiStopResults result={multi} loading={multiLoading} error={multiError} stale={stale} replay={!!replay} selectedId={selected?.id} onChoose={choose} auditEnabled={auditEnabled} />
      </section><JourneySheet plan={selected} onSave={() => dialogRef.current?.showModal()} /></div><footer><span>城市暂停键 / 给日常留一点空白</span></footer>
      </div>
    </main>
    <dialog ref={dialogRef} onClose={() => setCopyStatus("")}><button type="button" className="close" aria-label="关闭" onClick={() => dialogRef.current?.close()}>×</button><p className="eyebrow">YOUR LITTLE BREAK</p><h2>就这样，暂停一下。</h2><p className="muted">把这段小小出走，留在手边。</p><textarea ref={copyRef} readOnly aria-label="已选方案安排" value={selected ? (replay ? `历史真实数据回放 · ${replay.capturedAt}\n` : "") + planText(selected) : ""}/><button type="button" className="primary" onClick={copy}>复制安排</button><p role="status" className="fine">{copyStatus}</p></dialog>
  </div>;
}
import { PlaceDetails } from "./map/PlaceDetails";
