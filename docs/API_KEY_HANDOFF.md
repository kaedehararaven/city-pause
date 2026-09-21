# API Key 新对话交接说明

更新时间：2026-09-21

## 新对话应选择的项目

直接选择现有文件夹：

`/Users/raven/Documents/新手教程`

不要复制工程，不要重新 clone，不要创建新目录。当前修改、Git 工作区、ignored 的 `.env.local`、依赖和构建产物都在这个文件夹中。

## 安全边界

- `.env.local` 已包含本地运行所需配置并被 Git 忽略。
- 不要读取、打印、复述或要求用户再次提供任何真实 AK。
- `VITE_BAIDU_BROWSER_AK` 只允许进入浏览器端百度 JSAPI 链路。
- `SERVER_AK` 只能由服务端读取，绝不能进入客户端源码、客户端环境变量、API response、日志、Git 或客户端 bundle。
- `.env.example` 只能保留空值或明显占位符。

## 当前工作区状态

当前工作区包含尚未提交的 A1 合并和第一次 A/B Contract Integration。不要 reset、checkout 覆盖、重新解压 A1 包或从远端覆盖。

尚未执行：`git add`、commit、push。用户将人工审阅并决定 Git 操作。

先运行：

```bash
git status --short
git diff --check
```

## 必须先读

1. `.agents/skills/project-core/SKILL.md`
2. `.agents/skills/intelligence/SKILL.md`
3. `.agents/skills/baidu-map-integration/SKILL.md`
4. `docs/CONTRACTS.md`
5. `docs/CONTRACT_INTEGRATION_V0.1.md`
6. `docs/PHASE_1B_VALIDATION.md`
7. `docs/PHASE_1C_VALIDATION.md`
8. `docs/PHASE_A1_INTEGRATION.md`
9. `src/contracts/map.ts`
10. `src/recommendation/`
11. `src/map/`
12. `server/`
13. `src/Planner.tsx`
14. `src/App.tsx`

## 已完成架构

Canonical 类型：

- `MapPOI` / `RouteResult`：`src/contracts/map.ts`
- `UserIntent` / `CandidateData` / `CandidateProvider` / `CandidatePlan` / `Recommendation`：`src/recommendation/model.ts`

数据流：

`定位 → LocalSearch → MapPOI → Place Detail optional 合并 → 去程/返程 RouteResult → Real Candidate Provider → Hard Constraints → CandidatePlan → Recommendation → Planner`

同时保留 Mock Candidate Provider。Planner 允许明确选择 MOCK 或 REAL。REAL 失败或未就绪时显示错误，不会静默回退为 Mock。

## 事实边界

- REAL：POI 身份、名称、BD-09 坐标、成功路线米数和秒数。
- OPTIONAL：地址、分类、营业时间、评分。
- DERIVED：`ceil(seconds / 60)` 步行分钟、停留分配、缓冲、总耗时。
- MOCK-ONLY：当前 Mock 中的消费要求和业务 `kind`。
- UNKNOWN：真实消费要求、安静、拥挤、室内、舒适、适合休息等。
- 禁止将 `park → free`、`library → quiet`、`bookstore → indoor` 当作真实地图事实。

## 最近真实验证

真实浏览器中已验证：

- 百度地图加载成功；
- 真实定位成功；
- 附近搜索返回 1 个真实公园；
- 去程 786 米 / 672 秒，派生 12 分钟；
- 返程 404 米 / 345 秒，派生 6 分钟；
- 60 分钟预算生成 1 个标记为 REAL 的方案；
- 方案为步行 18 分钟、停留 15 分钟、缓冲 3 分钟，总计 36 分钟；
- 真实消费信息保持 unknown；
- 新页面 REAL 未就绪时显示明确错误，没有生成或回退成 Mock 方案；
- 浏览器 Console 无新增 warning/error。

本文件不保存用户精确位置、POI uid 或任何 AK。

## 最后一次自动检查

全部通过：

- `pnpm typecheck`
- `pnpm test`：5 个测试文件、36 项测试
- `pnpm build`
- 客户端 bundle Server AK 检查
- `git diff --check`

## 当前限制

尚未真实验证：

- 百度真实 `no_route` 响应；
- 真实超时分支；
- Place Detail 跨多个地点和类别的稳定性。

本阶段没有实现多类别搜索、LLM、Citywalk、正式路线绘制、数据库或登录。

## 新对话的第一步

1. 阅读上述文件并检查当前 Git diff。
2. 不要重新实现或覆盖已经完成的 A1 / Phase 1B / Phase 1C / Contract Integration。
3. 先向用户简短报告已正确恢复上下文、工作区是否完整、是否发现冲突。
4. 等待用户指定下一阶段；不要自行开始多类别、LLM、Citywalk、commit 或 push。
