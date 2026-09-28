import type { JourneyPlan } from "./route-builder/MultiStopResults";
import { JourneyMap } from "./map/JourneyMap";

export function JourneySheet({ plan, onSave }: { plan: JourneyPlan | null; onSave?: () => void }) {
  let elapsed = 0;
  return <aside className="journey-detail" aria-label="随身小行程">
    <p className="eyebrow">03 / 随身小行程</p>
    <h2>{plan?.title ?? "下一站，留给好心情。"}</h2>
    {plan ? <>
      <JourneyMap key={plan.id} plan={plan} />
      <div className="time-ribbon" aria-label="行程时间分配">{plan.steps.map((step, i) => <span key={i} className={`step-${step.kind}`} style={{ flexGrow: Math.max(0, step.minutes) }} title={`${step.kind} ${step.minutes.toFixed(1)} 分钟`} />)}</div>
      <ol className="timeline">{plan.steps.map((step, i) => {
        const start = elapsed; elapsed += step.minutes;
        return <li key={i}><small>{start.toFixed(1)}–{elapsed.toFixed(1)} 分钟 · {step.kind}</small>{step.label}</li>;
      })}</ol>
      <p>剩余 {plan.remainingMinutes.toFixed(1)} 分钟</p>
      {onSave && <button type="button" className="primary" onClick={onSave}>收好这张行程票 ↗</button>}
    </> : <p className="muted">等待选择行程</p>}
  </aside>;
}
