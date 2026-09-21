# A1 主工程整合记录（历史阶段）

日期：2026-09-21。A1 变更包已按清单审查后合并到当前主工程。新增推荐模块按包内容引入；入口、共享样式、README 与 Contract 采用手工合并，保留 B 线较新的 Phase 1C 实现和文档。变更包不含真实密钥，本次没有修改本地环境文件。

## 1. Prototype 审计

用户输入包括时间、活动按钮、补充文字、消费/少走偏好和返程开关。时间和返程以表单为准，文字冲突会在结果旁提示。

推荐引擎计算逐段步行、停留分配、3 分钟缓冲、剩余时间与排序。当前地点名称、类别、消费标记及步行时间均来自明确标记的 Mock。活动最低/建议停留时间属于 A 线政策，不是地图返回字段。

## 2. UserIntent v0

唯一代码定义位于 `src/recommendation/model.ts`，解析位于 `src/recommendation/intent.ts`。

| 字段 | 用途 |
| --- | --- |
| `availableMinutes` | 总时间硬约束，接受 5–180 分钟整数。 |
| `activity` | 休息、散步、探索方向；明确按钮优先于文字规则。 |
| `returnToStart` | 是否计入末段返程，以表单状态为准。 |
| `avoidCost` | 是否要求无需消费；`false` 只表示没有该要求。 |
| `nearby` | 是否要求每个地点距起点步行不超过 5 分钟。 |
| `excludedKinds` | 从否定词句提取的业务类别，独立于具体 POI ID。 |
| `rawText` | 保留补充原文，未识别内容不会自动变成约束。 |
| `source` | 记录各字段来自表单、按钮、勾选、文字规则、默认或未指定。 |

## 3. 三策略与硬约束

“轻松一点”先比较步行时间；“松弛漫步”优先两站并平衡移动与停留；“多看一眼”优先两个已知不同类别的地点。使用稳定 ID 作为最终平局规则，没有随机数或尚未验证的复杂权重。

推荐先执行消费、附近、类别、路线可用性和总时间等硬约束，再排序。A→B 与 B→A 的路线均可参与比较，但同一地点组合不会作为多个策略的重复结果。路线缺失时不会宣称时间可行。

## 4. 数据流与边界

`表单 → parseUserIntent → UserIntent → CandidateData(Mock) → 硬约束 → CandidatePlan → 三策略 → Recommendation → React 页面`

计算过程不导入 `src/map/`，不请求百度地图或大模型。Mock 顶层来源会传到输出，页面与复制文本均提示演示来源。真实路线不得沿用 Mock 的对称假设，`unknown` 不得解释为 false/no。

## 5. CONTRACT_PROPOSAL

A1 变更包原说明只掌握 Phase 1B 状态；合并时 B 线已经完成 Phase 1C。现有真实证据包括 JSAPI POI 的 `uid`、`title`、BD-09 `point`，成功步行路线的米制距离、秒制耗时和 steps，以及一个真实公园的 Place v3 分类、营业时间和评分。详情字段的跨地点稳定性与路线失败语义仍未确认。

| 所需业务事实 | 原因 | 当前证据 | 共同确认项 |
| --- | --- | --- | --- |
| 稳定标识、名称、坐标 | 引用、展示与算路 | 已验证 `uid`、`title`、BD-09 `point` | 正式 `MapPOI` 字段名、坐标表达和来源标识。 |
| 地点类别（允许 unknown） | 排除类别与多样性 | 一个 Place v3 响应观察到分类字段；稳定性未验证 | 原始分类到业务 `kind` 的映射规则；缺失时保持 unknown。 |
| 有向路段距离、耗时及失败状态 | 总预算、返程、少走约束 | 已验证 Direction v2 返回米和秒；分钟可由秒向上取整 | 点到点查询接口、缓存、失败/无路线/超时的区别。 |
| 是否必须消费（允许 unknown） | 保证无需消费 | 当前无可靠地图证据 | 不根据名称或类别推断免费；无证据时保持 unknown。 |
| 详情字段 | 后续解释与筛选 | 一个地点观察到营业时间、评分等字段 | optional 语义、缺失展示和跨地点验证范围。 |
| 事实来源 | 区分 Mock 与真实结果 | Mock 已有顶层来源；B 线已有真实探测链路 | 真实 Adapter 的来源与能力标识。 |

最低/建议停留时间是 A 线活动政策，不要求百度提供。`CandidateData` 是 A1 临时输入，不等于正式 `MapPOI` / `RouteResult`，也没有改变 B 线 Adapter 字段。

## 6. 合并文件

新增：`src/recommendation/{model,intent,mock,engine,engine.test}.ts`、`src/Planner.tsx`、`src/planner.css` 和本报告。

修改：`src/App.tsx`（加入 Prototype，地图探测按需打开）、`src/styles.css`（仅追加入口样式）、`README.md` 和 `docs/CONTRACTS.md`（记录 A 线 canonical 类型位置与临时边界）。

`src/map/`、`server/`、package/lock、Vite/TS 配置和构建脚本均未被 A1 包覆盖。压缩包文件已与其 SHA-256 清单核对一致。

## 7. 后续状态

该阶段提出的最小 `MapPOI` / `RouteResult`、unknown、失败语义和 Candidate Provider 边界已在 `docs/CONTRACT_INTEGRATION_V0.1.md` 落地。Mock 继续保留，REAL 公园数据现可通过相同推荐核心处理；本文件不再代表当前接口状态。
