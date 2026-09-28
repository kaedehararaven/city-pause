export function ForestHero({ onStart }: { onStart: () => void }) {
  return <section className="forest-hero" aria-labelledby="forest-title">
    <div className="forest-copy">
      <p className="forest-kicker">A MOMENT OF YOUR OWN</p>
      <h1 id="forest-title">城市暂停键</h1>
      <p className="forest-question">去城市里走走，<br/>把这一刻留给自己。</p>
      <p className="forest-description">一段散步，一间小店，一会儿发呆。<br/>不用走远，也能从日常里轻轻出走。</p>
      <button type="button" className="forest-start" onClick={onStart}>找到我的小小出走 <span aria-hidden="true">↗</span></button>
      <span className="forest-footnote">半小时也好，慢慢来就好。</span>
    </div>
  </section>;
}
