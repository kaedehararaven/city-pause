import { useEffect, useRef, useState, type FormEvent } from "react";
import { buildRecommendations } from "./recommendation/engine";
import { parseUserIntent } from "./recommendation/intent";
import { createMockCandidateProvider } from "./recommendation/mock";
import { buildSearchPolicy } from "./recommendation/searchPolicy";
import type { SearchPolicy } from "./contracts/search";
import type { Activity, CandidateData, Recommendation, ReturnMode, UserIntent } from "./recommendation/model";
import "./planner.css";

const mockData = createMockCandidateProvider().getCandidateData();
const activities = [
  ["auto", "随心安排"], ["rest", "歇一会儿"],
  ["walk", "散散步"], ["explore", "逛点新鲜的"],
] as const;
const activityNames: Record<Activity, string> = { rest: "休息片刻", walk: "短距离散步", explore: "附近探索" };

function planText(plan: Recommendation) {
  let elapsed = 0;
  return [
    `城市暂停键 · ${plan.title}`,
    plan.source === "mock" ? "Demo：地点、路线与时间均为模拟数据。" : "路线时间来源：已验证地图数据。",
    ...plan.steps.map((step) => {
      const start = elapsed;
      elapsed += step.minutes;
      return `第 ${start}～${elapsed} 分钟｜${step.kind}：${step.label}`;
    }),
    `总耗时 ${plan.totalMinutes} 分钟（含 ${plan.bufferMinutes} 分钟缓冲），预算剩余 ${plan.remainingMinutes} 分钟。`,
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
}: {
  returnMode: ReturnMode;
  onReturnModeChange: (mode: ReturnMode) => void;
  onSearchPolicyChange: (policy: SearchPolicy | null) => void;
  prepareReal: (intent: UserIntent) => Promise<CandidateData>;
  cancelReal: () => void;
  realRevision: unknown;
  realStatus: "idle" | "loading" | "ready" | "error";
  realMessage: string;
}) {
  const [dataMode, setDataMode] = useState<"mock" | "real">("mock");
  const [minutes, setMinutes] = useState("30");
  const [activity, setActivity] = useState<Activity | "auto">("auto");
  const [text, setText] = useState("");
  const [avoidCost, setAvoidCost] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationRef = useRef(0);
  const [plans, setPlans] = useState<Recommendation[] | null>(null);
  const [lastIntent, setLastIntent] = useState<UserIntent | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [clarification, setClarification] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const budget = Number(minutes);
    onSearchPolicyChange(Number.isInteger(budget) && budget >= 5 && budget <= 180
      ? buildSearchPolicy(parseUserIntent({ minutes: budget, activity, text, avoidCost, nearby, returnMode }))
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
    if (dataMode === "real" && realStatus !== "ready") {
      setError("请先在下方真实地图面板定位并发现候选地点，再生成计划。");
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
    setGenerating(true);
    setStale(false);
    setLastIntent(intent);
    setError("");
    setPlans(null);
    try {
      const data = dataMode === "real" ? await prepareReal(intent) : mockData;
      if (generation !== generationRef.current) return;
      setPlans(buildRecommendations(intent, data));
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
    dialogRef.current?.showModal();
  }
  async function copy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(planText(selected));
      setCopyStatus("已复制，可粘贴到记事本保存。");
    } catch {
      copyRef.current?.focus();
      copyRef.current?.select();
      setCopyStatus("自动复制不可用，已选中文本，请按 Command/Ctrl+C 复制。");
    }
  }
  const summary = lastIntent && [
    `${lastIntent.availableMinutes} 分钟`, activityNames[lastIntent.activity],
    lastIntent.avoidCost ? "无需消费" : "消费不限",
    lastIntent.nearby ? "各地点距起点步行 ≤ 5 分钟" : "步行计入总时间",
    (lastIntent.returnMode === "return_to_start") ? "返回起点" : "无需返回",
    lastIntent.excludedKinds.length ? `排除：${lastIntent.excludedKinds.map(kind => mockData.places.find(place => place.kind === kind)?.categoryLabel ?? kind).join("、")}` : "",
  ].filter(Boolean).join(" · ");

  return <div className="planner">
    <header className="nav"><a className="brand" href="#planner-input"><span className="logo">Ⅱ</span> 城市暂停键</a><span className="demo">{dataMode === "real" ? "REAL · 百度地图事实" : "MOCK / DEMO · 模拟数据"}</span></header>
    <main>
      <section className="hero"><div><p className="eyebrow">A LITTLE TIME, JUST FOR YOU</p><h1>现在有点空？<br/><span>把这一刻，留给自己。</span></h1><p className="intro">不用安排一整天。散散步、翻几页书，或只是歇一会儿。<br/>你的小小空档，也可以有一个好去处。</p><div className="location"><span className="dot"/> {dataMode === "real" ? "真实搜索起点" : "示例街区 · 中心广场"} <small>{dataMode === "real" ? realStatus === "ready" ? "REAL · 真实候选已就绪" : "REAL 数据尚未就绪" : "演示起点，非实时定位"}</small></div></div><div className="hero-art" aria-hidden="true"><div className="orbit o1"/><div className="orbit o2"/><div className="disc"><span>给自己</span><strong>暂停一下</strong><span>TAKE A LITTLE BREAK</span></div><span className="art-label l1">一小段散步</span><span className="art-label l2">一点自己的时间</span><i className="spark">✳</i></div></section>
      <div className="workspace"><section id="planner-input" className="input-panel" aria-labelledby="inputTitle"><div className="section-top"><span className="eyebrow">01 / 说说你的现在</span><span className="mini">随时可以调整</span></div><h2 id="inputTitle">这段时间，想怎么过？</h2>
        <form onSubmit={generate} noValidate>
          <fieldset><legend><label htmlFor="planner-data-source">数据来源</label></legend><select id="planner-data-source" className="source-select" value={dataMode} onChange={(event) => { setDataMode(event.target.value as "mock" | "real"); changed(); }}><option value="mock">MOCK / DEMO · 模拟数据</option><option value="real">REAL · 百度地图事实</option></select><p className="fine source-note">{dataMode === "mock" ? "使用虚构地点与路线，便于稳定测试。" : realMessage}</p></fieldset>
          <fieldset><legend>有多久空闲？</legend><div className="times">{[15,30,45,60].map(value => <button key={value} type="button" className={minutes === String(value) ? "active" : ""} aria-pressed={minutes === String(value)} onClick={() => { setMinutes(String(value)); changed(); }}>{value}<small>分钟</small></button>)}</div><div className="custom"><label htmlFor="planner-minutes">或者自定义</label><input id="planner-minutes" type="number" min="5" max="180" step="1" value={minutes} onChange={event => { setMinutes(event.target.value); changed(); }}/><span>分钟</span></div></fieldset>
          <fieldset><legend>现在更想……</legend><div className="moods">{activities.map(([value,label]) => <button key={value} type="button" className={activity === value ? "active" : ""} aria-pressed={activity === value} onClick={() => { setActivity(value); changed(); }}>{label}</button>)}</div></fieldset>
          <label className="field-label" htmlFor="planner-need">再说一点你的想法 <small>选填</small></label><textarea id="planner-need" rows={3} value={text} onChange={event => { setText(event.target.value); changed(); }} placeholder="比如：走累了，不想花钱，最后要回到这里。"/><div className="examples">{["走累了，不想花钱", "等朋友，不想走远"].map(example => <button key={example} type="button" onClick={() => { setText(example); changed(); }}>{example} ↗</button>)}</div>
          <div className="preferences"><label><input type="checkbox" checked={avoidCost} onChange={event => { setAvoidCost(event.target.checked); changed(); }}/> 不想花钱</label><label><input type="checkbox" checked={nearby} onChange={event => { setNearby(event.target.checked); changed(); }}/> 少走一点</label></div><label className="return-row"><input type="checkbox" checked={returnMode === "return_to_start"} onChange={event => { onReturnModeChange(event.target.checked ? "return_to_start" : "open_ended"); changed(); }}/><span>最后回到这里<small>默认无需返回起点；勾选后计入返程</small></span><span aria-hidden="true">↩</span></label>
          {error && <p className="error" role="alert">{error}</p>}<button type="submit" className="primary" disabled={generating}>{generating ? "正在核对真实路线…" : "看看我的暂停方案"} <span>→</span></button><p className="fine">{dataMode === "mock" ? "本模式使用规则匹配 · 地点与时间均为虚构演示" : realStatus === "ready" ? "生成时核对真实路线 · 停留和缓冲随时间预算调整" : "REAL 数据未就绪，不会偷偷使用 Mock 替代"}</p>
        </form>
      </section>
      <section className="results" aria-labelledby="resultsTitle"><div className="section-top"><span className="eyebrow">02 / 你的时间，你来选</span><span className="mini">{plans === null ? "等待你的灵感" : `${plans.length} 个可行方案`}</span></div><h2 id="resultsTitle">{plans === null ? "一小段空闲，也有很多可能。" : plans.length ? `给这 ${lastIntent?.availableMinutes} 分钟，一点好安排。` : "这次的条件，暂时安排不下。"}</h2>
        {summary && <div className="summary">{summary}</div>}
        {clarification && <p className="fine" role="status">{clarification}</p>}
        {stale && <div className="stale" role="status">条件已修改，请重新生成方案。<button type="button" onClick={() => generate()}>重新生成 →</button></div>}
        {plans === null ? <div className="empty"><div className="empty-symbol" aria-hidden="true">Ⅱ</div><h3>今天，想按下哪一种暂停？</h3><p>选好时间，我们会安排步行和停留，默认无需返回起点。<br/>不用赶路，也不用把每一分钟填满。</p><div className="possibilities"><span>歇一会儿</span><span>走一小圈</span><span>发现附近</span></div></div> : plans.length ? plans.map((plan, index) => <article key={plan.id} className={`plan${selected?.id === plan.id ? " selected" : ""}`}><div className="plan-top"><span className="plan-badge">{plan.source.toUpperCase()} · 0{index+1} / {plan.strategyLabel}</span><span className="total">{plan.totalMinutes}<small>分钟</small></span></div><h3>{plan.title}</h3><p className="route">{plan.originName} → {plan.places.map(place => place.name).join(" → ")}{(plan.returnMode === "return_to_start") ? ` → ${plan.originName}` : ""}</p><div className="metrics"><span>步行 {plan.walkingMinutes} 分</span><span>停留 {plan.stayMinutes} 分</span><span>缓冲 {plan.bufferMinutes} 分</span><span>{plan.costStatus === "required" ? "需要消费" : plan.costStatus === "not-required" ? "无需消费" : "消费信息未知"}</span></div><p className="reason">{plan.strategyReason}；{(plan.returnMode === "return_to_start") ? "已计入返程" : `终点是${plan.places.at(-1)?.name}`}，余量 {plan.remainingMinutes} 分钟。</p><div className="plan-actions"><details><summary>查看时间安排</summary><ol className="timeline">{(() => { let elapsed = 0; return plan.steps.map((step, stepIndex) => { const start = elapsed; elapsed += step.minutes; return <li key={stepIndex}><small>第 {start}～{elapsed} 分钟 · {step.kind}</small>{step.label}</li>; }); })()}</ol></details><button type="button" className="select" disabled={stale} onClick={() => choose(plan)}>就选这个 ↗</button></div></article>) : <div className="no-result"><h3>留一点更充裕的时间吧。</h3><p>{lastIntent?.avoidCost ? "真实地点的消费信息未知，无法保证无需消费；未把公园或其他地点推断为免费。" : lastIntent?.excludedKinds.length ? "当前地点类别信息不足以验证全部排除要求，未用搜索类别冒充地点事实。" : "当前候选的已验证路线无法同时满足时间、少走或返程要求。可调整条件或刷新附近地点。"}</p></div>}
        {plans && <p className="fine">{dataMode === "mock" ? "演示规则" : "当前推荐规则"}仅识别部分关键词，未识别的要求不会自动生效；具体以条件摘要为准。{plans.length > 0 && plans.length < 3 ? `当前仅找到 ${plans.length} 个可行方案。` : ""}</p>}
      </section></div><footer><span>城市暂停键 / 给日常留一点空白</span><span>{dataMode === "real" ? "REAL 地图事实 · DERIVED 推荐时间" : "MOCK：非真实定位、营业信息或导航"}</span></footer>
    </main>
    <dialog ref={dialogRef} onClose={() => setSelected(null)}><button type="button" className="close" aria-label="关闭" onClick={() => dialogRef.current?.close()}>×</button><p className="eyebrow">YOUR LITTLE BREAK</p><h2>就这样，暂停一下。</h2><p className="muted">安排已选好，复制下来，留作演示参考。</p><textarea ref={copyRef} readOnly aria-label="已选方案安排" value={selected ? planText(selected) : ""}/><button type="button" className="primary" onClick={copy}>复制安排</button><p role="status" className="fine">{copyStatus}</p></dialog>
  </div>;
}
