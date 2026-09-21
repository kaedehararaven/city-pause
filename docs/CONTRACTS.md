# 城市暂停键 Contract · v0.5

本文件记录 A/B 模块交界与事实语义。Canonical TypeScript 类型出现后，以本文件列出的唯一路径为准，不在地图侧和推荐侧复制同名业务类型。

## 总体数据流

`UserInput → UserIntent → Candidate Provider → MapPOI + RouteResult → CandidatePlan → Recommendation → Planner`

地图 API 原始响应只能进入 B 线 Adapter/Service。推荐核心只消费 shared Contract。Mock 与真实 Provider 使用相同 Contract，并以 `source` 明确区分；真实失败不得静默切换成 Mock。

## Canonical 类型位置

| 概念 | 唯一来源 | 责任 |
| --- | --- | --- |
| `MapPOI` | `src/contracts/map.ts` | REAL/MOCK 地点事实，不含路线时间。 |
| `RouteResult` | `src/contracts/map.ts` | 两个明确端点之间的有向步行路线事实或失败状态。 |
| `UserIntent` | `src/recommendation/model.ts` | A 线解析后的用户时间与约束。 |
| `CandidateData` / `CandidateProvider` | `src/recommendation/model.ts` | 向推荐核心注入 MapPOI、RouteResult 与 A 线政策。 |
| `CandidatePlan` | `src/recommendation/model.ts` | 已通过 hard constraints 的具体时间安排。 |
| `Recommendation` | `src/recommendation/model.ts` | CandidatePlan 加上确定性策略选择与解释。 |

## MapPOI v0.1

`MapPOI` 只描述“地点本身是什么”。

| 字段 | 语义 | 状态 |
| --- | --- | --- |
| `source` | `real` 或 `mock` | REQUIRED |
| `provider` | `baidu` 或 `mock` | REQUIRED |
| `providerId` | Provider 内稳定标识 | REAL，REQUIRED |
| `name` | 地点展示名称 | REAL，REQUIRED |
| `location` | latitude、longitude、`BD-09` | REAL，REQUIRED |
| `address` | 地址 | REAL，OPTIONAL |
| `categories` | Provider 分类/标签的归一化文本 | REAL，OPTIONAL |
| `openingHours` | Provider 返回的营业时间文本 | REAL，OPTIONAL |
| `rating` | Provider 返回且可解析的评分 | REAL，OPTIONAL |

`walkingDistanceMeters`、`walkingDurationSeconds` 和 `walkingMinutes` 禁止进入 `MapPOI`。同一地点从不同起点出发的路线不同。

`isFree`、`isQuiet`、`isCrowded`、`isIndoor`、`comfortable`、`suitableForRest` 不属于 v0.1。百度当前验证结果不能支持这些布尔事实。

## RouteResult v0.1

路线由 `from` 和 `to` 两个带 ID 与 BD-09 坐标的端点确定，并且是有方向的。需要返程时必须单独查询，不能假设对称。默认 open_ended 只查询去程，不为未来可能使用的返程消耗配额。

成功结果：

| 字段 | 语义 | 状态 |
| --- | --- | --- |
| `status: success` | 成功取得路线 | REAL |
| `walkingDistanceMeters` | 百度成功路线返回的米数 | REAL |
| `walkingDurationSeconds` | 百度成功路线返回的秒数 | REAL |
| `walkingMinutes` | `ceil(walkingDurationSeconds / 60)` | DERIVED |
| `coordinateSystem` | `BD-09` | REAL |

失败结果使用 `no_route`、`timeout` 或 `provider_error`，且不携带距离或时间。失败不能转换为 0、直线距离、无限远或假路线。

## CandidatePlan 边界

`CandidatePlan` 表示一个通过 hard constraints 的具体安排：引用所使用的 `MapPOI` 和成功 `RouteResult`，并包含 returnMode、去程步行、停留、可选返程、3 分钟缓冲、总耗时、剩余时间、预算、消费信息状态和 `feasibility: feasible`。

- 地点、路线米数和路线秒数：REAL MAP FACT 或明确 MOCK。
- `walkingMinutes`、停留分配、缓冲、总耗时：DERIVED / RECOMMENDATION LOGIC。
- 策略标签与排序原因：RECOMMENDATION LOGIC。
- 失败或缺失路线不会形成 CandidatePlan；时间超预算属于 INFEASIBLE hard constraint，不进入排序。

## Time Semantics v0.1

UserIntent 使用 `returnMode: "open_ended" | "return_to_start"`，取代原 returnToStart boolean；未指定时为 open_ended。当前表单返程开关显式选择模式，文字冲突仍由表单优先并提示。

- open_ended：去程移动 + 停留/活动 + buffer <= availableMinutes。
- return_to_start：去程移动 + 停留/活动 + 真实返程 + buffer <= availableMinutes。
- 去程移动包含已有多站方案的站间移动；不新增搜索或策略。
- open_ended 不要求返程 RouteResult，也不生成返程 step。
- return_to_start 必须有同来源、成功的有向返程；缺失/失败或超预算在 hard constraints 过滤。REAL 不可使用 MOCK 返程。
- CandidatePlan 的 returnMode、outboundWalkingMinutes、stayMinutes、bufferMinutes、可选 returnWalkingMinutes、totalMinutes、remainingMinutes 明确记录分段时间；walkingMinutes 保留为所有步行总和。
- 原最低/建议停留分配政策不变：固定 15 分钟活动应将 minimumStayMinutes 和 suggestedStayMinutes 均设为 15。6 + 15 + 3 = 24；加 7 分钟返程为 31，30 分钟预算不可行。
- 模式改变后清除旧推荐；REAL 使用当前模式所需路线重新准备 CandidateData。只复用同端点位置的成功路线，不推断反向路线。

## Mock-only 与 inference

| 字段/规则 | 当前处理 |
| --- | --- |
| `costRequired` | 仅 Mock 数据目前有值；真实 Provider 保持 unknown。`avoidCost` 要求下，unknown 不能证明免费，因此候选被 hard constraint 排除。 |
| `kind` | Mock 中用于稳定测试；真实 POI 当前保持 unknown。存在类别排除约束时，unknown 不能证明符合要求，因此候选被 hard constraint 排除。未来如从分类映射，应明确标记为 INFERENCE / A 线规则。 |
| `minimumStayMinutes` / `suggestedStayMinutes` | A 线通用停留政策，属于 RECOMMENDATION LOGIC，不是百度事实。 |
| quiet / crowded / indoor / comfort / rest-friendly | 当前不进入 Contract；需要未来可信数据源或显式 inference 规则。 |

禁止将 `park → free`、`library → quiet`、`bookstore → indoor` 写成 REAL MAP FACT。

## Provider 边界

`createMockCandidateProvider()` 提供完全虚构但符合 shared Contract 的稳定测试数据。

`createRealCandidateProvider()` 接收 B 线已经适配的一个 `MapPOI` 与有向 `RouteResult[]`。它不解析百度 raw response，不补造消费、安静、室内等属性。Planner 由用户明确选择 MOCK 或 REAL；REAL 未就绪或失败时显示状态，不自动伪装成成功的 Mock 推荐。

## 当前真实能力状态

**VERIFIED（已有 Phase 1B/1C 证据）：** JSAPI `uid`、`title`、BD-09 `point`；Direction v2 成功路线的米、秒和 steps；一个真实公园的 Place v3 分类、营业时间与评分。

**OPTIONAL / LIMITED EVIDENCE：** 地址、分类、营业时间与评分可以缺失；Place Detail 目前只有一个真实地点样本。

**UNKNOWN / NOT VERIFIED：** 详情字段跨类别稳定性、真实 `no_route` 响应、超时分支、营业状态高级权限、实际配额和缓存策略。

详细证据见 `docs/PHASE_1B_VALIDATION.md` 和 `docs/PHASE_1C_VALIDATION.md`。

## 密钥边界

Browser AK 只用于浏览器 JSAPI。需要 WebAPI 的路线和详情请求必须经过项目服务端；`SERVER_AK` 只从服务端运行环境读取，绝不能进入 Git、客户端源码、公开环境变量、API response 或客户端 bundle。日志和错误不得包含 AK、完整百度请求 URL或服务端配置对象。

## 变更约定

新增字段前必须记录来源、optional/unknown 表现和真实验证证据。跨模块语义变更由 A/B 共同确认；不得为了单线实现方便私自改变另一线依赖的 Contract。

## A2 Search Policy v0.1 — CONTRACT_PROPOSAL

A-owned canonical proposal 位于 `src/contracts/search.ts`，构建函数为 `src/recommendation/searchPolicy.ts` 的 `buildSearchPolicy(intent)`。
这是已实现、待 A/B 确认消费方式的发现策略，不是已接入的地图接口。当前 Planner / REAL pipeline 保持上面的实际数据流；本阶段不调用它触发搜索。

目标数据流：`UserIntent → SearchPolicy → [B Candidate Discovery] → MapPOI / RouteResult → hard constraints → scoring → Recommendation`。

- `SearchPolicy`：`version: "0.1"`、`availableMinutes`、`entries`。
- Entry 只有 `category`、`priority: high | medium | low`、确定性 `reason`。
- Category 仅为 `bookstore | mall | cafe | dessert | park`，是产品发现类别，不是百度分类、keyword 或 POI 属性。
- `availableMinutes` 传递用户预算，不表示搜索半径或允许移动时长；无位置、POI、路线或原始响应。
- entries 顺序固定以便稳定序列化，同级没有隐含名次；空数组合法，表示所有支持类别都被明确排除，不能回退成全部搜索。
- 高优先级只用于发现，不能覆盖推荐层的时间、消费或类别 hard constraints；搜索结果不自动获得 kind/free/quiet/indoor 等属性。
- 规则与已知限制见 `docs/PHASE_A2_SEARCH_POLICY.md`。未修改 UserIntent、MapPOI、RouteResult，也未修改默认 open_ended。

B 待确认：如何把产品类别映射到经过验证的搜索请求；同级检索的额度分配和失败处理；结果去重与类别来源的表示。此提案不承诺五类别已实测、不制定关键词/半径/并发数，也不要求现在查询真实 API。
