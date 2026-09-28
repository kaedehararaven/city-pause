import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicReplay } from "./PublicReplay";
import { replayCapture } from "./demo/replayData";

describe("public historical replay", () => {
  it("renders recorded results with date and version caveat without fetching", () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { search: "?replay=1" } });
    try {
      const html = renderToStaticMarkup(<PublicReplay />);
      expect(html).toContain("2026-09-28");
      expect(html).toContain("当前 v3 规则");
      expect(html).toContain(`${replayCapture.routes.length} 个真实地点`);
      expect(html).toContain("随身小行程");
      expect(html).toContain("历史候选分类分布");
      expect(html).toContain('value="180"');
      expect(html).toContain('value="90"');
      expect(html).not.toContain('>15<small>分钟');
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
