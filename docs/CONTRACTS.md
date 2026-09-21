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

`CandidatePlan` 表示一个通过 hard constraints 的具体安排：引用所使用的 `MapPOI` 和成功 `RouteResult`，并包含 returnMode、去程步行、停留、可选返程、按预算派生的缓冲、总耗时、剩余时间、预算、消费信息状态和 `feasibility: feasible`。

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
- 固定停留的候选继续受 minimumStayMinutes / suggestedStayMinutes 限制；真实地点采用下述 Time Allocation v0.2 的 flexible 政策。30 分钟时缓冲仍为 3，因此固定 15 分钟活动的 6 + 15 + 3 = 24、加 7 分钟返程为 31 的硬约束案例仍成立。
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

## B2 Candidate Discovery v0.1（发现层边界）

A2 提案已由 B2 消费，以上“待确认/未接入”是 A2 交付时状态。A-owned canonical 类型保持在 `src/contracts/search.ts`；实际类型名为 `SearchCategory`，不另建 ProductSearchCategory 副本。B 不改 A 的优先级或产品语义。

新增 canonical 类型位于 `src/contracts/discovery.ts`：

- `DiscoveryRequest`：A 的 SearchPolicy + B 提供的 BD-09 center。availableMinutes 不转成地理半径；v0.1 固定搜索半径 1500m。
- `DiscoveredCandidate`：poi: MapPOI、matchedSearchCategories、discoveryPriority。后两项是发现元数据，不属于地图事实或推荐评分；priority 取该身份被发现的最高优先级。
- `CandidateDiscoveryResult`：source: real、status、candidates、逐类别 categories 结果。候选池最多 10 个，不含路线或时间可行性承诺。
- 单类别状态为 success / empty / provider_error / timeout；总体为 success / empty / partial_success / error。某类别空结果不算失败，有类别失败但其他类别成功或 empty 时为 partial_success。全部失败为 error。取消会终止当前批次并忽略旧回调。
- category reports 仅保存查询、数量、规范化名称、字段可用性和 provider categories，不输出 raw provider 对象。retainedCount 是该类别实际分配的新增唯一候选数；duplicateCount 是其首页内或之前类别已经观察过的身份数。

地图查询映射集中于 `src/map/searchMapping.ts`：书店、购物中心、咖啡厅、甜品店、公园。未知类别或无效策略在请求前拒绝；空 entries 不定位、不搜索、不扩大为五类。

LocalSearch 串行（每个 B2 批次应用层最多 1 个在途请求），相邻请求发起至少间隔 400ms；400ms 是额外节奏控制，不是对百度 QPS 权益的推断。用户确认 JS 地点检索服务并发上限为 3。每批最多五次检索，不翻页、不自动重试，每次最多检查首页 5 个结果；每类新增候选上限 high=3 / medium=2 / low=1。按 high→medium→low 查询，同级用 canonical 枚举顺序作为确定性调度。汇总后分轮分配，每轮每类最多增加一个唯一候选，避免先查类别直接耗尽全部 10 个位置。同级枚举顺序不是推荐排名。

用 provider + providerId 去重，不按名称；对全部检查过的重复身份合并 matchedSearchCategories，即使候选池已满，也不丢失已发现的类别来源。Provider 分类只清理已观察到的 font 展示标记并归一化分隔，不把搜索类别写入 categories，不新增 kind/free/quiet 等推断。

Cheap filter 仅校验身份与坐标、去重、按发现额度截断；没有几何距离或 walking 估算。B2 UI 通过 `Planner 表单 → UserIntent → buildSearchPolicy → App → DiscoveryPanel → LocalSearch → Adapter → MapPOI → 去重/分轮分配 → CandidateDiscoveryResult` 展示候选池，发现层自身到此停止。后续真实计划整合见下一节；旧单公园探测现收进独立诊断区，不再向 Planner 提供数据。

B2 阶段真实证据与限制见 `docs/PHASE_B2_VALIDATION.md`。本次联调继续保留 MapPOI、RouteResult 和 A2 SearchPolicy 定义，扩展推荐侧停留政策及候选 Provider。

## 多类别真实计划与 Time Allocation v0.2

本次由用户明确要求打通候选到计划，并修复固定总时长：

- DiscoverySnapshot 保存 origin、CandidateDiscoveryResult 和实际尝试的类别，向 App 提供完整发现上下文。旧单公园诊断回调不再连接 Planner。
- Planner 点击生成 REAL 时，以最新 UserIntent 重新构建 A2 SearchPolicy。B2 修订后按 high/medium/low 与 canonical 类别顺序跨层分轮，每轮每类最多新增一个身份，每类上限 3/2/1，最多 6 个。先覆盖有结果的类别，再补充名额；high 有结果不会提前返回。此处仅限制后续路线候选，不进入推荐 score。本轮 B2 验证不触发路线请求。
- 成功路线仅在相同起点/终点身份与坐标下复用，本页重新发现候选即清空。时间或偏好改变可能选择新候选，只补查新候选所需路线；修改表单停止后续请求并丢弃旧生成结果。
- 路线跨生成批次串行排队，每个请求完成后才开始下一个，新请求间隔至少 400ms。默认最多 6 次去程；明确要求返程时最多 12 次有向请求。去程已不可行时不再查其返程。不请求地点之间的路线，不伪造多站行程。
- Real Candidate Provider 支持 pois[]，所有地点沿用相同 canonical MapPOI / RouteResult。成功候选经同一 hard constraints 后最多输出三个单地点备选；部分路线失败只过滤对应地点，所有去程失败显示明确错误，无 Mock 回退。
- REAL 的 kind/costRequired 仍为 unknown；通过某个搜索类别发现不证明排除约束或免费。要求免费/类别排除但无法证明时，明确显示无方案原因，并省去注定无效的路线调用。

Time Allocation v0.2：

- bufferMinutes = clamp(round(availableMinutes / 10), 3, 10)，为推荐政策而非地图事实；30/45/60/90 分钟分别为 3/5/6/9 分钟。
- CandidatePlace 可带 stayAllocation: flexible。真实 Provider 对普通自由停留地点启用 flexible：先校验真实移动 + 最低停留 5 分钟 + 缓冲可行，再将预算内可用时间分配给停留。示例和受限活动未开启 flexible 时仍按建议停留上限处理。
- open_ended：停留 = 预算 - 真实去程 - 动态缓冲；return_to_start 额外减去真实返程。此处真实方案为单地点；不估算未取得的路线。
- CandidatePlan 的 stayMinutes、bufferMinutes、totalMinutes、remainingMinutes 是唯一显示来源，页面和复制文本不再硬编码 3 分钟。
- 时间不足在 hard constraints 阶段过滤，不压缩真实路线，不生成小于最低停留的假可行方案。

## B2 发现元数据交接（A3 已接通）

DiscoverySnapshot.result.candidates 完整保留 DiscoveredCandidate[]。A3 的 RealCandidateInput / CandidateData 已增加可选 discoveredCandidates；prepareRealPlan 的普通路径和硬约束提前返回路径均传入该字段，不再仅映射成 MapPOI[] 丢弃发现来源。

若与 pois 同时提供，按 provider + providerId、坐标和集合校验一致性；发现输入必须为 REAL，类别及 priority 必须属于 canonical 枚举。旧 poi/pois 调用兼容；discoveryPriority 或 matchedSearchCategories 不写进 MapPOI，不补造 kind 或消费属性。A 使用发现类别做偏好及多样性匹配，discoveryPriority 不进入 score。

本轮审计、公开区域实测和限制见 docs/PHASE_B2_REVISION.md。

## A3 Recommendation Algorithm v0.2

实际链路：UserIntent → A SearchPolicy → B 多类别 Discovery → DiscoveredCandidate[] → B 有限真实路线评估 → Real Candidate Provider → A hard constraints → preference/activity/mobility utility → quality gate → diversity reranking → 最多三个 REAL Recommendation → 既有 Planner。

- Utility = 40 × preference + 30 × activityBenefit − 20 × mobilityBurden；活动收益边际递减，35 分钟封顶；移动比例是负担，不因散步偏好奖励更长到达路线。
- Quality gate = max(0, bestUtility − 18)，再做策略调整及基于地点/类别重合的多样性扣分。允许少于三个，不保证每类一个；这些是 A 的首版产品权重，尚未完成真实用户效果调优。
- Recommendation 可选 scoreTrace 记录 0.2 版本、hardConstraints: passed、类别来源、component、贡献、质量门槛与最终 selectionScore。UI 无需展示 trace，保留现有渲染字段。
- 默认 open_ended、动态停留/缓冲、失败过滤及 REAL/MOCK 来源边界保持不变。真实模式仍为单地点备选，不查询站间路线。
- A3 原交付报告记录的是当时尚未接线的状态；最终整合与验证以 docs/PHASE_A3_INTEGRATION.md 为准。
