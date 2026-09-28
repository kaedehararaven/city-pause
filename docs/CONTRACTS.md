# 城市暂停键 Contract · v0.5

Multi-stop最新增量：Family不足时允许独立补搜既有Goal的S/M标签，不回写单地点供给；补充去程和站间边共用6次新增路线额度。默认排名前3个可用首站各自构造，成功后仍继续下一个，每首站最多展示1条，按首站原排名展示。跨首站仅排除相同无序POI集合，不按Family合并。120分钟起散步/探索优先选择最佳两站的合格扩展，不能降低最弱Goal或压缩原两站精确停留；90分钟默认两站，休息始终两站。replay专用历史边不得流入实时cache。见[原路线扩展](MULTI_STOP_TIME_EXPANSION.md)及[独立首站与Demo补采](MULTI_STOP_INDEPENDENT_ANCHORS.md)。

2026-09-28 新增独立 Multi-stop Route Builder V1：`src/route-builder/model.ts` 定义 RouteCandidate/MultiRoute/BuildResult，不取代单地点 Recommendation。消费现有默认排序全量结果，不回写Family/dwell/路线排名到单地点；UI分别展示两类结果。最弱Goal等级优先，无站数奖励；按既定Family与dwell约束验证开放式2/3站路线。事实依旧使用canonical MapPOI/RouteResult。请求budget、缓存、精确/显示时间与状态语义见[接入记录](MULTI_STOP_ROUTE_BUILDER_V1_IMPLEMENTATION.md)。

最新供给修订：Web Search V3每层同一合并查询最多3页、每页20条；候选按规范化完整classified_poi_tag路径最多5个，跨S/M去重并共享容量。12个阈值按限额后有效候选判断。分页失败保留部分结果且停止扩展，不假报完整成功。评分、Goal等级和路线规则不变。详见[当前v3供给](GOAL_CANDIDATE_SUPPLY_V3_INTEGRATION.md)。下方单页/每层一次请求描述为历史状态。

当前推荐决策以“Recommendation Decision Engine v0.3”为基础，Activity 充分性、goal fallback 和收缩诊断以末尾 A v0.3.1 补充及 `docs/A_V031_COMPLETION_REPORT.md` 为准；路线、通勤门禁和候选供给以本文件 B3 补充及 `docs/B3_COMPLETION_REPORT.md` 为准。下方 A3 权重、walking 节奏、费用降级规则保留历史记录，不能覆盖最新语义。

B3 供给二次修复以末尾“B3 Supply Revision”及 `docs/B3_SUPPLY_COMPLETION_REPORT.md` 为准，替代旧固定6/8路线名额政策；A v0.3.1 不变。

本文件记录 A/B 模块交界与事实语义。Canonical TypeScript 类型出现后，以本文件列出的唯一路径为准，不在地图侧和推荐侧复制同名业务类型。

## 总体数据流

`UserInput → UserIntent → Candidate Provider → MapPOI + RouteResult → CandidatePlan → Recommendation → Planner`

地图 API 原始响应只能进入 B 线 Adapter/Service。推荐核心只消费 shared Contract。Mock 与真实 Provider 使用相同 Contract，并以 `source` 明确区分；真实失败不得静默切换成 Mock。

## Canonical 类型位置

| 概念 | 唯一来源 | 责任 |
| --- | --- | --- |
| `MapPOI` | `src/contracts/map.ts` | REAL/MOCK 地点事实，不含路线时间。 |
| `RouteResult` | `src/contracts/map.ts` | 两个明确端点之间的有向 walking/cycling 路线事实或失败状态。 |
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
| `telephone` | Provider 返回的联系电话文本 | REAL，OPTIONAL |
| `description` | Provider 返回的地点介绍 | REAL，OPTIONAL |
| `suggestedVisitDuration` | Provider 建议游览时长的原始文本，不用于硬预算计算 | REAL，OPTIONAL |
| `indoorFloor` | Provider 返回楼层文本，不等同于室内布尔属性 | REAL，OPTIONAL |
| `brand` | Provider 品牌文本，不从名称推断 | REAL，OPTIONAL |
| `priceText` | Provider 商户价格原文，计价口径未知时不解释成人均/门票 | REAL，OPTIONAL |
| `bestVisitTime` | Provider 最佳游玩时间文本，不是实时天气或适宜度 | REAL，OPTIONAL |
| `detailUrl` | 通过官方域名与路径检查的 HTTPS 地点详情网页 | REAL，OPTIONAL |
| `navigationLocation` | Provider 导航引导点的 BD-09 坐标，与地点中心分开 | REAL，OPTIONAL |
| `subPlaces` | 最多 20 个去重后的 Provider 关联子地点，含身份/名称与可选分类、地址、坐标 | REAL，OPTIONAL |

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

## Recommendation v0.3 与按需详情

2026-09-22 用户反馈后的规则修订，以本节及 docs/RECOMMENDATION_V03.md 为准。

- rest 对 bookstore 匹配为 0.9；cafe/dessert/mall 为 1，多类别取最强证据，不叠加。保留质量门槛 18 和多样性惩罚 8，避免类别先验单独排除质量相近的书店。
- walking 且未选择 nearby 时：15 分钟地点内活动收益封顶；前 40% 预算的真实步行不罚移动分，超过部分仍扣分。balanced/explore 按预算 25%/40% 的真实到达步行目标比较节奏，easy 仍偏好少走；优先展示 balanced。目标是产品策略，不是路线景观、路况或地点内可步行路线事实。nearby 仍严格限制去程 5 分钟并采用少走规则。
- scoreTrace.version=0.3，贡献与实际 component 保持一致。hard constraints、默认不返程和来源边界不变。
- 首批最多 6 个路线候选；若最低停留/时间/nearby/返程条件下可行地点不足 3 个，按相同分层顺序最多补查 2 个备用地点。总上限 8 个，返程模式理论最多 16 个有向请求；仍串行，成功路线缓存复用。
- 用户展开 REAL 方案的地点详情才通过既有服务端固定接口请求 Place v3。串行、同身份在途合并、成功结果 5 分钟内存缓存（最多 30 项），失败允许手动重试。详情失败不改变路线可行性或推荐，MOCK 不调用真实详情。
- UI 展示地址、Provider 分类、营业时间、评分、电话及有值时的楼层/简介/建议时长。未知不补造；不从营业时间推断当前营业，不将建议游览时长覆盖用户预算，不用缺失评分给候选扣分。

## Place Detail 扩展（2026-09-22）

品牌、价格、最佳游玩时间、官方详情页、子地点与导航引导点接入既有服务端 Place v3 scope=2。候选列表和 REAL 方案均可按需展开详情，不需要先调用 Direction。

子地点检查最多前 100 条、按 providerId 去重并输出最多 20 条；缺身份/名称时丢弃，坐标非法仅保留其余有效资料。分类保留 Provider 文本，不用名称猜测入口；子地点不自动变成推荐候选。真实商场样本返回过周边停车场，因此列表不承诺包含关系或进出权限。

导航引导点和有坐标的子地点可以在小地图查看，仅添加标记，不调用路线、不更换 MapPOI.location 或 RouteResult 端点。后续入口导航需另行按明确端点查询真实路线。

详情链接允许 map.baidu.com 网页及 api.map.baidu.com/place/detail 公共详情页；升级为 HTTPS，拒绝非官方域名、非 HTTP(S)、凭证、非默认端口及 AK/token 等查询参数。缺失或被拒绝不造链接。

实测与字段限制见 docs/PLACE_DETAIL_EXTENSION.md。

## 不消费偏好降级（2026-09-22，覆盖旧 avoidCost 严格 unknown 过滤）

根据用户要求，avoidCost 表示优先不消费，费用不足时允许明确提示的待核实备选，不再承诺所有结果均已验证免费。

- 已知 costRequired=true 仍排除；已知 false 的可行方案优先，存在这类方案时不混入 unknown 备选，也不为凑三项填充。
- 没有已确认不消费的可行方案时，REAL 地点可凭匹配身份和坐标的 discovery metadata 中 park/mall/bookstore 发现方向进入降级池。没有匹配元数据或仅 cafe/dessert 的未知地点不进入。类别只选择值得核实的方向，不证明公共所有、免费、可坐或可停留。
- costStatus 保持 unknown、costRequired 不改写；Recommendation.costCaveat 明确提示免费进入、不消费停留及座位未确认，建议查看详情/电话确认。UI 与复制文本都保留提示，条件摘要改为“优先不消费（费用待核实）”。
- prepareRealPlan 不再因 avoidCost 提前返回空路线；只对上述三类方向准备有限真实路线。类别排除未知的原逻辑、时间/nearby/返程硬约束不变。没有可靠路线的情况仍允许零结果，不伪造公共休息点。
- 不消费偏好下这些发现方向匹配值为 0.9，避免 rest 原有咖啡强匹配再次压低公园。质量门槛和多样性规则仍适用。
- 118 项测试及 typecheck/build/bundle secret check/diff check 通过。本轮未重新请求用户定位或真实路线；用户实际场景效果待复验。

## Recommendation Decision Engine v0.3（覆盖旧 A 侧排序与软偏好规则）

本轮只改 A 推荐模块、测试和文档；MapPOI、RouteResult、DiscoveredCandidate、SearchPolicy 及 B/UI 源码未变。

- Pipeline：Hard Feasibility → Evidence → Dynamic Dimensions → Pareto → Strategy Selection → Diversity/Dedup；不再计算固定 Utility、Quality Gate、策略全局加分或 diversity penalty。
- UserIntent optional goal 为 flexible/rest/walk/discover；normalization 兼容 default/rest/refreshment/walking/browsing。optional preferences 使用 MUST/PREFER/DONT_CARE；avoidCost/nearby 默认映射 lowCost/lowWalking=PREFER。显式 preferences 覆盖旧开关。
- `maxWalkingMinutes: { strength: MUST, value: number }` 是含返程/站间的总步行硬约束。语义 MUST 当前返回 UNSUPPORTED_VERIFIED_MUST，不把未知当符合或不符合；未新增 NLP。
- A 侧费用未知不再按类别硬删；已知付费与 lowCost=PREFER 的冲突记录为 MISMATCH，仍是可行候选。UNKNOWN 继续提供 costCaveat，不宣称免费、可坐或不消费停留已验证。
- Evidence 为 MATCH/MISMATCH/UNKNOWN，带 source/reason/knownness；未知 dimension value=null。价格仅从显式 costRequired 或极窄、整字段明确 priceText 消费。类别不推出 free/quiet/indoor/novelty/seat；发现 priority 不参与排序。
- 基础 need/mobility/activity；只按表达增加 cost/quiet/environment/novelty。knownness 表达确定性，不是地点好坏分。到达步行永远是负担，walk 不奖励更远。
- Pareto 要求全部激活维度双方都可比较，全部不差且至少一项更好；未知阻止严格支配。保留 dominatedBy、比较维度和阻断原因。
- Easy 在合理需求/偏好内优先低摩擦；Balanced 使用共同已知维度的规范化理想点距离；Explore 的额外步行必须换来明显已知收益。三策略允许相同首选，去重只在未支配近似等价备选中考虑类别差异，不凑满三项。
- canonical `decisionTrace` 类型在 `src/recommendation/decisionTypes.ts`，作为 Recommendation optional 字段。`buildDecisionResult` 暴露完整候选、拒绝检查、诊断；旧 `buildRecommendations` 数组接口保留，但对不支持的语义 MUST 明确抛错。
- scoreTrace 仅保留 legacy 类别/来源/硬检查 metadata，旧数值分数不再产生。现有 UI 未消费这些数值字段。未来解释只能消费 trace，不可改排名或造事实。
- 保留动态缓冲/停留、open_ended/return_to_start、真实有向路线、来源/Provider 边界；加固路线端点坐标、模式、分钟派生和重复路线歧义检查。

**CONTRACT_PROPOSAL：** B 当前仍存在 avoidCost 三类别路线准备、nearby 五分钟提前处理，尚未全面对齐新的 PREFER。按本阶段边界未修改；详情按需加载也未回灌 CandidateData。新 goal/结构化偏好的上游消费与这些限制需下一轮共同处理，不能声称当前页面已消除所有上游限制。

完整政策、旧测试逐项迁移与 VERIFIED/NOT VERIFIED 见 `docs/RECOMMENDATION_DECISION_V03.md`。

## B3：Time-aware Supply / Mobility Contract

**CONTRACT_CHANGE（本轮产品授权）**：本节覆盖历史 walking-only、整数分钟预算、B 层 avoidCost 白名单及 nearby 五分钟过滤的描述；v0.3 Pareto/策略规则保持不变。完成证据和限制见 `docs/B3_COMPLETION_REPORT.md`。

- `src/contracts/map.ts`：TravelMode 为 walking/cycling。成功路线通用字段 distanceMeters/durationSeconds/durationMinutes，分钟精确等于秒数/60。walking 保留旧字段，旧 walkingMinutes 向上取整仅为兼容；通用字段可选以支持历史数据。cycling 必须提供通用字段，不提供 walking 别名。routeMetrics/validRouteMetrics 为统一消费和校验入口。失败不提供伪造距离/时间。
- `src/contracts/mobility.ts`：open_ended 所有到达/已有站间通勤秒数 <= T*60/4；return_to_start 包含独立返程的全部通勤 <= T*60/3。门禁只决定硬可行性，不能奖励走得更远；现有最低停留、动态缓冲、总预算与来源/坐标门禁继续成立。
- `CandidateData.travelMode` 可选，默认 walking；`CandidatePlan.travelMode` 必填。travelMinutes/travelDurationSeconds/outboundTravelSeconds/可选 returnTravelSeconds 记录通用移动量，停留/缓冲/总时间/余量沿用原字段且不提前取整。cycling 方案 walking 累计字段为 0，返程 walking 字段省略，POI identity 不变。
- `prepareRealMobilityPools` 与 `buildMobilityDecisions` 为显式双 mode 入口；walking/cycling 分别运行同一 v0.3 engine，无跨 mode Pareto 比较。DecisionTrace.travelMode 及 DecisionResult.supplyAudit 说明所属模式和 candidate/feasible/Pareto 数量；>=10 feasible 缩减到 1 时输出 PARETO_COLLAPSE_OBSERVED，不更改 dominance。
- `DiscoverySnapshot.envelope` 标记 mode、预算、半径、heuristic/capped；DiscoveredCandidate.discoveryBand 区分 near/expanded，只作供给分配，不作地图事实或推荐加分。半径随预算和 mode 增长、最多 12000m；真实 route duration 才决定可行性。每 mode 两层最多 20 个 POI、最多 8 个进入路线验证。串行 LocalSearch，并发 1；双池只在显式调用时请求，当前 UI 默认 walking。
- RoutePreparationAudit：discovered/prepared 为地点数，requested/cached/successful/failed 为路线数，successful 包含缓存命中。按 mode、方向和端点隔离缓存，失败不 Mock 填充。
- avoidCost/nearby 的 PREFER 不再触发 B 提前硬过滤；数值 maxWalkingMinutes MUST 仍限制真实 walking 累计秒数。UNKNOWN 不当作 false，搜索类别不冒充 POI 属性。
- 固定服务端 cycling endpoint 使用官方 Direction v2 riding 普通骑行；Server AK 边界、BD-09 与失败脱敏不变。骑行 duration 仅为路线骑行时间，不添加无证据取车停车常量。
- **UI_CONTRACT_PROPOSAL（已最小接线）**：DiscoveryPanel 使用 walking 动态搜索范围，Planner 修正文案并仅在显示时保留一位小数；没有 riding 分栏、模式切换或导航。后续 UI 消费通用 travel 字段，不能将 cycling.walkingMinutes=0 展示为零移动。

## A v0.3.1：Activity Sufficiency / Goal Fallback

- 仍使用同一 Hard Feasibility → Evidence → Dynamic Dimensions → Pareto → Strategy Selection → Diversity/Dedup。通勤门禁、秒级预算、返程、模式隔离、最低停留与动态缓冲不变。本次不改地图、服务器、SearchPolicy、B 配额或 UI。
- 保留 `activityOpportunity` 字段与 maximize 方向，但语义改为满足既有每站 `minimumStayMinutes` 政策的充分性。所有硬可行方案已充分，值为 1；额外停留分钟不再增加 Pareto 或策略优势。停留分钟及政策门槛仍在计划/证据中。没有新增任何 goal-specific 时长，也不把 A 的最低停留政策称为 provider 体验事实。
- `mobilityBurden` 仍为全部路线分钟/预算；Need 类别匹配规则不变。flexible 的 Need=1 只是无偏，不代表质量满分。所有维度都足够且没有额外已知取舍时，最近方案仍可合法支配，不保证三结果或不同预算换地点。
- `DecisionTrace.algorithmVersion` 保持 `0.3`，新增 `decisionEngineRevision: "0.3.1"`。`goalMatch` 含 classification(PRIMARY_MATCH/FALLBACK_MATCH)、primaryMatchInInputPool、primaryMatchExists（通过硬检查）、degraded 和可选 fallbackReason。
- PRIMARY：flexible 的可行方案，或明确 goal 的已知 Need >=0.7。FALLBACK：明确 goal 的已知弱匹配或 UNKNOWN；UNKNOWN 仍为 null，不称为确认不匹配。存在 PRIMARY 时正常策略仅选 PRIMARY；否则允许明确降级备选。输入没有主匹配记 NO_PRIMARY_MATCH_IN_INPUT_POOL；有主匹配地点但均未通过硬检查记 NO_FEASIBLE_PRIMARY_MATCH。降级标记和解释随数组接口的 Recommendation 一并返回，无需 UI 重构。
- 所有激活维度已知才可 strict dominance 的规则不变。比较 trace 新增 strictlyBetterDimensions，区分“不差”和“严格更好”，不补 UNKNOWN。拒绝列表按 candidateId 稳定排序以便反序审计。
- 可行方案 >=5 且前沿只有1时，supplyAudit.collapse=true，diagnostics 记录 PARETO_COLLAPSE_SINGLETON、inputCandidateCount/feasibleCandidateCount/paretoCandidateCount、唯一前沿 identity，以及它对其他候选的可比较/严格优势维度。输入计数是地点数，可行/前沿计数是方案数。>=10 时同时保留 B3 的 PARETO_COLLAPSE_OBSERVED 标识作为兼容别名。诊断不改变选择。

## B3 Supply Revision

- REUSED_EXISTING_ENVELOPE：动态搜索半径、普通骑行 capability、通用 RouteResult 和精确秒数门禁全部复用。heuristic 仅供检索，不写入 RouteResult 或 A evidence，不显示估算速度。
- 路线配额集中在 `src/map/routeValidationPolicy.ts`。每mode预算≤15/≤30/≤45/>45分钟分别最多6/10/12/14个候选；默认只查去程，明确返程最多翻倍。双mode仅显式调用，最多28次去程或56次双向请求；400ms串行，不全量请求POI×mode。
- 分层保留近区前6个，新增名额优先扩展区；明确goal的扩展primary类别最多先占2个扩展槽，再补未覆盖类别、按SearchPolicy priority轮询。goal匹配引用A现有只读规则作供给信号，不增加推荐分数。短预算与长预算近区保留以相同goal/policy及稳定观测为前提，不承诺真实provider列表永远不变。
- CONTRACT_CHANGE：`CandidateDiscoveryResult.observations?` 保留查询数、有效观测数、唯一有效候选。每层最多25条，两层最多50条观测；原候选展示池仍最多20，去重观测作为route备用池，防止已发现primary被展示池截断。near/expanded只是查询层来源，不能冒充实际道路距离/ETA。
- CONTRACT_CHANGE：`RoutePreparationAudit.funnel?` 记录预算、goal、mode、秒数门禁、查询/发现/去重/保留，以及全局/按类别的routeSelected、routeSuccess、travelGatePass、hardFeasible、deliveredPrimary。hardFeasible直接读取未改动的A引擎单点可行候选，不读取Pareto胜者，也不在B救回候选。
- 漏斗不含POI标识/精确位置/provider raw payload。逐项记录发现类别、查询层、失败阶段、路线状态和A失败check；公园摘要区分未发现、未选路线、路线失败、超通勤、其他硬不可行、已交付。多种原因并存时逐项记录，摘要选最深入阶段，不将摘要当唯一原因。
- `readLatestRouteAudit(mode)` 为开发侧读取最近已完成审计的入口；新任务开始清除旧审计，取消不发布结果。全路线失败保持抛错但错误携带audit，不补Mock。查询失败/部分成功记录状态；NO_PARK_DISCOVERED只说明本次有效观测没有公园，不证明城市中没有。
- 没有UI接线改动。原App仍经prepareRealPlan消费新供给；骑行池已有显式调用能力，本轮没有骑行分栏或导航。
## Recommendation Architecture Simple v0.1 (2026-09-27)

本节 supersedes the earlier A2/A3/v0.3 decision descriptions for the current implementation. Candidate supply is now Goal-driven Candidate Supply v3: it reads the current Goal's S/M/W taxonomy rules, sends all S terms in one composite LocalSearch, and sends all M terms in one composite LocalSearch only when S yields fewer than 12 valid candidates. The former seven neutral categories (`cafe`, `dessert`, `bookstore`, `mall`, `park`, `culture`, `lifestyle`) are compatibility-only and no longer constrain the formal supply path. W terms are never actively searched.

Every formal candidate must pass actual `classified_poi_tag` whitelist validation, parent-path inheritance, deduplication, and navigation-child filtering. Independent sub-places are validated by their own classified path. The Candidate Pool is an audit view of this dynamic S/M flow, not a user-facing intermediate step.

2026-09-28数据源修订（覆盖上文LocalSearch描述）：正式S/M使用服务端Web Place Search V3 `/around`、scope=2、page_size=20、`$`分隔关键词。Search的`detail_info.classified_poi_tag`为正式来源；有效候选不足12才批量补缺失分类（每批最多10 UID），达到12即停止；S仍不足12才M。不为评分/价格提前Detail。缓存、去重、限速、302暂停保留，单条/批量共享缓存。详见[当前集成](GOAL_CANDIDATE_SUPPLY_V3_INTEGRATION.md)。

Travel Gate uses the ideal reference `T×60/4` for open-ended plans and `T×60/3` for return-to-start plans, with a 120% maximum. Hard feasibility runs before factors. Current Goal Match is explicitly unresolved (`NOT YET RESOLVED`) until product supplies a verified STRONG/MEDIUM/WEAK mapping. The default list then compares mobility, rating, and price according to the new ordering contract; user sort changes only presentation order.
# 2026-09-28 详情缓存补充

Place Detail 的内部返回值可附带 `observedAt` / `expiresAt` 毫秒时间戳；缓存命中不刷新时间。`MapPOI.detailExpiresAt` 仅用于详情复用，不参与 Goal Match、可行性或排序。共享缓存及历史回放边界见 [额度与回放](QUOTA_AND_REPLAY.md)。历史回放不进入 REAL 实时推荐数据流。
