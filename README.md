# 城市暂停键

B2 多类别候选发现已在底部地图开发面板接入当前表单的 A2 SearchPolicy。可定位搜索，也可使用明确标注的公开测试区域；发现池最多 10 个 REAL 候选，搜索串行。Planner 的 REAL 模式已接通五类候选：每次最多对 6 个候选串行查真实路线，默认只查去程，停留和缓冲按预算调整。旧单公园入口仅保留为独立诊断。见 [计划联调记录](docs/REAL_PLAN_INTEGRATION.md)及 [B2 历史验证](docs/PHASE_B2_VALIDATION.md)。

当前主页面包含用户需求输入、时间约束和三方案推荐 Prototype。推荐支持明确选择 MOCK 或 REAL 数据源：MOCK 用于稳定演示；REAL 需要先在页面底部完成定位和五类别候选发现，点击生成时才查询当前模式所需路线（默认无需返回起点；勾选返程后另查返程）。两种来源通过同一内部 Contract 进入推荐核心，真实失败不会静默伪装成 Mock 成功。AI 和 Citywalk 尚未实现。

## 本地运行

1. 安装依赖：`pnpm install`
2. 可选：复制 `.env.example` 为 `.env.local`，在本机填写已有凭证。不要提交 `.env.local`。
3. 同时启动前后端：`pnpm dev`
4. 打开 `http://127.0.0.1:5173`

后端健康检查位于 `http://127.0.0.1:3001/api/health`。开发前端通过 Vite 代理访问相同的 `/api/health` 路径。

## 检查

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

浏览器端配置名为 `VITE_BAIDU_BROWSER_AK`，只用于百度地图 JSAPI 4.0。`SERVER_AK` 只由 `server/` 代码读取，构建检查会拒绝包含服务端配置的客户端产物。

## A/B 当前边界

- A 线推荐模型、Provider 与规则位于 `src/recommendation/`，不直接读取百度原始响应。
- B 线地图、定位、POI 及真实路线探测位于 `src/map/` 与 `server/`。
- `MapPOI` / `RouteResult` 的 canonical 类型位于 `src/contracts/map.ts`，共享语义以 `docs/CONTRACTS.md` 为准；首次接口整合记录见 `docs/CONTRACT_INTEGRATION_V0.1.md`。
