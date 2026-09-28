import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReplayOptions, replayConfiguration } from "./PublicReplay";
import { Planner } from "./Planner";
import { App } from "./App";
import { replayPools } from "./demo/replayData";

describe("public historical replay", () => {
  it("renders recorded results with date and version caveat without fetching", () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { search: "?replay=1" } });
    try {
      const html = renderToStaticMarkup(<Planner returnMode="open_ended" onReturnModeChange={() => {}} onSearchPolicyChange={() => {}}
        prepareReal={async () => { throw new Error("Network forbidden"); }} cancelReal={() => {}} realRevision={0} realStatus="ready" realMessage=""
        replay={replayConfiguration("compact")} sourceOptions={<ReplayOptions scenario="compact" onChange={() => {}} />} />);
      expect(html).toContain("2026-09-28");
      expect(html).not.toContain("当前 v3 规则");
      expect(html).toContain(`${new Set(Object.values(replayPools("compact")).flat().map(c => c.poi.providerId)).size} 个真实地点`);
      expect(html).toContain('value="compact" selected=""');
      expect(html).toContain("王府井商业街周边");
      expect(html).toContain("原公开测试起点");
      expect(html).toContain("随身小行程");
      expect(html).toContain("Demo · 公开区域历史案例");
      expect(html).not.toContain("非当前营业保证");
      expect(html).not.toContain("不消耗在线检索");
      expect(html).not.toContain("MOCK / DEMO");
      expect(html).not.toContain('value="mock"');
      expect(html).not.toContain("随心安排");
      expect(html).not.toContain("再说一点你的想法");
      expect(html).not.toContain('id="planner-need"');
      expect(html).toContain('aria-pressed="true">歇一会儿');
      expect(html).toContain("已记录有向路线");
      expect(html).toContain("历史候选分类分布");
      expect(html).toContain('value="180"');
      expect(html).toContain('value="90"');
      expect(html).toContain('value="90" selected=""');
      expect(html).not.toContain('>15<small>分钟');
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(["", "?replay=1"])("uses the same landing and planner for %s without a separate demo page", search => {
    vi.stubGlobal("window", { location: { search } });
    try {
      const html = renderToStaticMarkup(<App />);
      expect(html).toContain("找到我的小小出走");
      expect(html.match(/id="planner-data-source"/g)).toHaveLength(1);
      expect(html).not.toContain('href="/?replay=1"');
      expect(html).not.toContain("公开区域离线 Demo</h1>");
      if (search) expect(html).toContain("正在加载样本库…");
    } finally { vi.unstubAllGlobals(); }
  });
});
