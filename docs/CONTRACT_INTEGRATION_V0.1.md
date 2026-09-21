# A/B Contract Integration v0.1

本次整合建立 `src/contracts/map.ts` 作为 `MapPOI` 与 `RouteResult` 的唯一代码来源。B 线 LocalSearch Adapter 输出 `MapPOI`，客户端路线 Adapter 把服务端的受限响应包装为有端点、有方向和明确状态的 `RouteResult`。A 线通过 `CandidateProvider` 注入 Mock 或 REAL 数据。

## 映射

| A needs | Shared Contract | B provides |
| --- | --- | --- |
| 稳定地点引用、名称 | `MapPOI.providerId/name` | JSAPI `uid/title` |
| 路线输入位置 | `MapPOI.location` / `RouteEndpoint` | JSAPI BD-09 `point` |
| 可选展示信息 | `MapPOI.address/categories/openingHours/rating` | LocalSearch + Place v3，可缺失 |
| 有向步行时间 | `RouteResult.walkingDurationSeconds` | Direction v2 成功路线秒数 |
| 分钟预算 | `RouteResult.walkingMinutes` | 由秒数向上取整 |
| 路线失败 | `no_route/timeout/provider_error` | 服务端和客户端 Adapter 显式映射 |
| 消费保证 | 不属于 MapPOI v0.1 | 当前 B 线无法提供，REAL 保持 unknown |
| 停留时间 | Candidate Provider 的 A 线政策 | 不要求 B 线提供 |

## 最小真实闭环（Time Semantics 修订后）

`定位 → 公园 LocalSearch → MapPOI → Place Detail 合并 optional 字段 → 按 returnMode 请求所需路线 → RouteResult[] → Real Candidate Provider → hard constraints → CandidatePlan → Recommendation → Planner REAL 模式`

默认 open_ended 只请求去程，去程 success 即可发布 REAL CandidateData；明确选择 return_to_start 后才请求返程，且两段均须 success。模式切换清除旧推荐，同端点成功去程可复用。Place Detail 失败不会阻止基础 POI 进入推荐，可选详情保持 unknown。路线失败时不创建假路线，也不自动切换 Mock。

## 2026-09-21 真实浏览器验证（修订前的双向模式历史证据）

- 真实定位成功，附近搜索返回 1 个真实公园。
- 去程返回 786 米 / 672 秒，派生为 12 分钟。
- 返程返回 404 米 / 345 秒，派生为 6 分钟；验证了不能假设双向对称。
- 60 分钟预算进入相同 hard constraints 后生成 1 个 REAL 方案：步行 18 分钟、停留 15 分钟、缓冲 3 分钟，总计 36 分钟。
- 真实消费信息保持 unknown，没有把公园推断为免费。
- 新页面在 REAL 数据未就绪时显示明确错误，没有回退成 Mock 推荐。
- 浏览器控制台未观察到新增 error 或 warning。

本记录不保存用户精确位置、POI uid 或任何 AK。
