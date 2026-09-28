# Recommendation Decision Engine v0.3

日期：2026-09-22。本轮为 A 线结构重构，不是旧版权重调整。保留开始时所有未提交修改，不 commit/push。
本报告覆盖旧 `RECOMMENDATION_V03.md` 中的到达步行节奏奖励，以及 A3 固定 Utility / Gate / diversity penalty；旧文档作为历史记录保留。

## 1. 原算法审计

| 项目 | 实际位置与发现 |
| --- | --- |
| Hard constraints | `engine.ts/buildRecommendations`：来源、路线、预算、最低停留、返程；旧 avoidCost 和 nearby 还会硬过滤。 |
| Preference | `utility.ts/preferenceMatch`：消费发现类别，rest 书店 0.9；未知类别折算 0.5。 |
| Activity | `utility.ts/activityBenefit`：15 分钟后边际递减，35 分钟封顶；旧 walking 单独 15 分钟封顶。 |
| Mobility | `utility.ts/scorePlan`：普通移动比例；旧 walking 前 40% 预算不扣分。 |
| Quality Gate | `utility.ts/qualityThreshold`：max(0, bestUtility - 18)。 |
| 三策略 | `utility.ts/strategyAdjustment` 与 engine：统一总分后加减分；walking 奖励 25%/40% 预算的到达步行。 |
| Diversity | `utility.ts/selectDiverse`：POI/类别 Jaccard 惩罚 8，选择阶段与质量混合。 |
| Trace | `utility.ts/ScoreTrace`、engine：记录 40/30/20 贡献、Gate 与最终总分。 |
| Discovery metadata | `realProvider.ts/createRealCandidateData` 接收并校验 `discoveredCandidates`；B 已在两个调用路径交接。 |
| REAL/MOCK | canonical `model.ts`、`contracts/map.ts`；Provider 不推断真实 kind/free，路线来源必须一致。 |

开始前全量测试：11 文件、118 项通过。复用了动态停留和缓冲，没有重写 B 的发现/路线/详情实现。

## 2. 新 Pipeline

`UserIntent normalization → Hard Feasibility → Evidence → Dynamic Dimensions → Pareto → Strategy Selection → Diversity / Dedup → Recommendation`

`buildDecisionResult` 返回完整候选审计、失败检查、诊断与推荐；`buildRecommendations` 仍返回旧 UI 可消费的推荐数组。
不支持的语义 MUST 在意图能力检查时报错，不假装成地点不可行。合法请求的不可行方案不会进入证据比较或 Pareto。

## 3. 删除的机制

删除固定 40/30/20 Utility、best-minus-18 Gate、策略通用加减分、多样性扣分，以及散步到达步行正奖励。旧 qualityGate/scorePlan/selectDiverse 等导出已移除。
删除 A 引擎费用未知类别白名单、已验证免费方案存在时排空未知候选的逻辑；删除 nearby 隐含五分钟硬约束。
`costPolicy.ts` 中 B 仍引用的常量保持原样，旧 helper 不再被 A 引擎调用。

## 4. 保留与加固

保留 REAL/MOCK、有向路线、秒向上取整、真实米数、最低停留、动态缓冲、flexible/bounded 停留分配、两种 returnMode 和现有单站/已具备站间路线的两站候选构造。
没有新增站间路线请求或路径优化。加固 provider/mode/坐标与端点一致性；重复同方向 RouteResult 视为歧义，保守拒绝，避免输入顺序决定事实。
显式类别排除沿用既有 kind 规则，不把 discovery category 冒充地点事实。

## 5. UserIntent Normalization

新增 optional `goal`、`preferences`、`maxWalkingMinutes`，保持旧调用有效。

| 旧 profile | canonical goal |
| --- | --- |
| default（包括解析器的默认 explore） | flexible |
| rest / refreshment | rest |
| walking | walk |
| browsing（显式 explore） | discover |

显式 `goal` 优先；旧 profile 仍由 A2 `profileFor` 识别，没有新 NLP。显式 activity 的 button/form 优先级不变。
avoidCost=true → lowCost=PREFER；nearby=true → lowWalking=PREFER；结构化 preferences 覆盖旧 boolean，DONT_CARE 明确关闭维度。
`maxWalkingMinutes: {strength: "MUST", value: number}` 限制全部步行，包括返程及已有站间移动；非有限/负值拒绝，不当成未设置。
语义属性 MUST（包括未给绝对阈值的 lowWalking）返回 `UNSUPPORTED_VERIFIED_MUST`；旧数组入口抛出带此 code 的错误。没有把 MUST 自动降为 PREFER。

## 6. Evidence 三态

每项记录 state、source、reason、knownness。UNKNOWN 的 dimension value 是 null，不是 0、0.5、true 或 false。
费用只消费显式 `costRequired` 或归一化 MapPOI.priceText：严格整字段“人均 ¥35”类正价格表示少消费冲突；整字段“免费开放/免费入场/免门票”提供免费入场方向的 MATCH。后者不保证所有活动免费，更不能支持免费 MUST。
数字“35”、裸“¥35”、免费停车、否定或附加收费条款等保持 UNKNOWN。冲突费用声明保持 UNKNOWN。不解析百度 raw response，不生成新的地图字段。
quiet/indoor/novelty 当前无可靠字段，始终 UNKNOWN；品牌、名称、楼层、类别不证明这些属性，更不证明座位。
lowWalking 使用已知路线作为移动量，但没有绝对满足阈值，三态仍为 UNKNOWN；只增强比较政策，不声称已满足少走。

## 7. Dynamic Dimensions

基础：needMatch↑、mobilityBurden↓、activityOpportunity↑。knownness 单独记录已知维度数/激活维度数，仅表达不确定性，不作 Pareto dimension 或全局加分。
仅显式激活时增加 costFit/quietFit/environmentFit/noveltyFit。未激活价格时，价格及其字段完备度完全不参与决策。
Need 来自匹配身份和坐标的发现类别，Mock 来自明确 Mock kind 规则；多站任一类别未知时保守保留未知。flexible=1 表示不设类别偏好，不表示场所质量满分。
rest cafe/dessert/mall=1、bookstore=0.9；walk park=1；discover bookstore/mall=1；其他已知类别 0.35。这些是公开产品规则，不是地点设施或实测体验。
Activity 沿用 0–15 分钟增长至 0.7、15–35 增至 1 后封顶。Mobility 始终为全部路线分钟/预算，散步也不例外；米数在 trace 保留事实依据，不与分钟重复惩罚。

## 8. Pareto Dominance

仅在双方所有 active dimensions 都有可比较的非 null 值时，按 maximize/minimize 方向判断：全部不差、至少一项严格更好才支配。比较使用 1e-9 数值容差。
完整记录 dominatedBy、每个对手的 comparableDimensions / blockedByUnknown / dominates、retainedReason。稳定按 candidate ID 排列，忽略 discoveryPriority。
空输入正常返回空；异常的非空可行池却无 Pareto 前沿时记录 EMPTY_PARETO_SET，停止而不回退旧总分。前沿过大由策略确定性处理，复杂度 O(n²d)。

## 9. UNKNOWN

任一激活维度未知，即使双方都未知，也可能掩盖真实取舍，因此阻止严格 dominance。已知免费不因此支配未知费用。
策略可根据已知冲突选择更相容的备选，但 UNKNOWN 不获得“确认满足”的奖励。已知冲突不是硬约束：没有更相容方案时仍可输出可行备选并明确费用冲突。
Balanced 用整个策略池共同已知的维度比较；任一候选未知的维度对整个池不进入距离计算，并列入 omittedUnknownDimensions。不是逐候选缺项填零，也不暗中改变各候选分母。

## 10. Easy

在前沿存在 need≥0.7 的方案时，优先这批合理匹配及需求未知方案；没有时保留弱匹配。随后优先较少已知偏好冲突。
在这个策略池按步行分钟、站点数、活动机会依次比较；其余相同才参考活跃需求的不确定性，再按稳定 ID。Easy 不会只因最近就选择明显弱匹配或已知冲突地点。
0.7 是策略合理匹配政策，不是硬可行性或旧 Utility Gate；被策略暂不选中的可行候选仍在完整审计中。

## 11. Balanced

在相同合理策略池，使用共同已知 active dimensions 到语义理想点的 RMS 距离；各维度固定在 0–1，maximize 理想为 1、minimize 理想为 0，不用样本 min/max。
`sqrt(sum(gap²)/共同已知维度数)`，不是全策略共享加权总分。路线和活动总是已知，分母至少有这两项。
lowWalking=PREFER 时，先比较移动与换站，再比较 RMS；该偏好改变策略，不删除长路线可行候选。普通模式按 RMS、低摩擦、活跃需求不确定性、ID 依次破平。

## 12. Explore

以 Easy 为基准；合理额外移动必须换来某个共同已知体验维度至少 0.1 的提升，其他体验维度不能下降超过 0.1。体验维度包括 need/activity 及已激活、共同已知的偏好 fit，不含 mobility。
额外步行最多预算的 25%；激活少走则为 10%。这是策略容许量，不放宽任何硬约束。无额外移动且不降低体验的等价候选也可比较。
按最大已知体验改善、低摩擦、不确定性、ID 选择。没有有意义收益则复用 Easy，不因更远选择它。三策略可同选一个地点。

## 13. Diversity / Dedup

仅在三策略选择之后执行。先保留策略首选；与已选 POI 重复时，只从未被支配且当前策略可用、每个维度差≤0.03、站点数相同的 near-tie 备选中优先减少类别重合。
UNKNOWN 与已知值不能称为 near-tie；两边都未知时保留该未知状态，并不当成属性相同的事实。
按 provider+providerId 去重，不按名称；已展示的 POI 不在另一方案重复。没有合适备选则合并/省略重复策略，不保证三个结果，不救回被支配或不可行项。

## 14. Decision Trace Schema

canonical 类型在 `decisionTypes.ts`，Recommendation.decisionTrace 为 optional：

```text
algorithmVersion: "0.3"
normalizedIntent
hardConstraints[]: check / result / evidence
activeDimensions[]
evidence: preference -> state / source / reason / knownness
dimensions: dimension -> direction / value(number|null) / evidence
knownness: known / active / role("uncertainty-only")
pareto: dominated / dominatedBy / comparisons / comparableDimensions / retainedReason
strategy: easy / balanced / explore evaluations
uncertainties[]
selectionReason
```

strategy.selected 表示去重之前的策略选择；selectionReason 说明最终展示是否来自 near-tie 替代。buildDecisionResult.candidates 也保留未入选及被支配方案，rejected 保存首个阻断的硬检查，不伪称所有检查都完成。
scoreTrace 仅保留现有 B 测试使用的类别来源、类别、hardConstraints 和 version，增加 legacy=true；旧数值贡献不再计算。UI 没有消费旧数值字段，不受移除影响。
将来 AI 只能基于这些元数据解释，不可改排名、重新选点或创造事实。本轮无 AI。

## 15. 修改文件

新增：`src/recommendation/decisionTypes.ts`、`normalization.ts`、`evidence.ts`、`decision.ts`、`decision.test.ts`（以上短路径均在 recommendation 目录）。
修改：`src/recommendation/model.ts`、`engine.ts`、`utility.ts`、`utility.test.ts`、`engine.test.ts`。
文档：本报告、`docs/CONTRACTS.md`。未改 package、lockfile、安全脚本、共享地图/发现/搜索类型。

## 16. 新增 Tests

`decision.test.ts` 50 项机制测试（含参数化展开），对应任务 34 项行为关系：

| 请求覆盖 | 自动测试证据 |
| --- | --- |
| 1–5 Hard Feasibility | 超预算、三类失败、独立返程、PREFER 保留候选、数字 MUST 含返程；旧时间 24/31 分钟测试保留。 |
| 6–11 Evidence | 三态、null、未知咖啡/甜品仍可行、费用原文冲突、类别/品牌/名称不推断。 |
| 12–15 Dynamic | 未激活价格不变、激活 costFit 改选择、lowWalking 改策略、walk 不奖励更长到达。 |
| 16–21 Pareto | 严格支配、真实取舍、已知/未知与双方未知、输入反序、确定性、相同候选与空输入。 |
| 22–28 Strategies | Easy 非最近唯一、Balanced 折中、Explore 合理额外活动/无收益不走远、共享可行池、同选一项、真实取舍可不同。 |
| 29–30 Diversity | POI 去重、同名不同身份保留、等价类别多样性、不复活被支配/无效项。 |
| 31–34 Provenance | REAL/MOCK/provider/端点隔离、metadata 与事实分离、priority 不参与、trace 不虚构与 legacy 标识。 |

额外覆盖：不支持语义 MUST 显式诊断、NaN/Infinity 上限、歧义价格、冲突证据、字段更多不等于更好、重复路线不依赖输入顺序。均为合成 fixture，不是实地验证。
示例取舍测试：60 分钟，三个同类别地点分别到达 2/8/16 分钟，受限停留政策分别 5/25/35 分钟，验证轻松/折中/充分活动三种选择；这些时长是测试输入，不是伪造真实地点推荐。

## 17. 旧 Tests 逐项迁移

原 utility.test.ts 共 22 项；下面按原测试目的逐项记录去向，没有静默删掉旧架构断言。

| 原测试 | 分类 | 新验证/原因 |
| --- | --- | --- |
| matches browsing/rest/walking/refreshment | UPDATE | goal 类别关系+normalization；未知从 0.5 改 null。 |
| flexible default / duplicated category evidence | KEEP | utility.test 保留等价关系。 |
| diminishing activity / cap | KEEP | 原数学关系保留。 |
| longer walking only burden | UPDATE | 保留 mobility 关系，删除全局 utility 分数断言。 |
| honest rest alternatives / free | UPDATE | 未知类别不再白名单；咖啡甜品也可行并保留 caveat；时间/返程仍测。 |
| verified no-spend / excludes paid | UPDATE | 已知费用进入 evidence；PREFER 不再硬删付费或未知方案。 |
| comparable bookstore/dessert rest alternatives | REPLACE | 不强制复活被严格支配书店；保留书店需求信号和单类可行性，增加等价类别多样性测试。 |
| moderate walking rhythm | REPLACE | walk 长到达路线不奖励；同收益更远被支配。 |
| browsing above equally distant park | UPDATE | discover 的 need 关系与 metadata 测试；不依赖旧总分。 |
| preference outweigh modest walk | KEEP | Easy 公园需求匹配可胜过更近弱匹配。 |
| non-park walking not hard-filtered | KEEP | 非公园单类仍可推荐。 |
| lower mobility same preference | KEEP | 同需求更远方案被支配。 |
| category diversity when close | UPDATE | 只在未被支配的近似等价备选中生效；输入反序另保留。 |
| reject weak diversity / permit only cafes | UPDATE | 不要求三个更差咖啡凑数；等价两咖啡保留、单地点保留。 |
| infeasible / failed before scoring | KEEP | 改为 before Pareto，并检查失败诊断。 |
| default no return / requested missing return | KEEP | 原语义保留。 |
| ignore discovery priority / no facts mutation | KEEP | 比较完整决策，检查不修改原数据。 |
| contributions reconcile selection score | REPLACE | canonical decisionTrace/hard checks/uncertainty/策略解释，无旧分数。 |
| legacy POI-only neutral categories | UPDATE | 保持调用可用，但未知需求为 null，而非中性 0.5。 |
| provider identities/coordinates/REAL | KEEP | 移到 decision.test。 |
| cafe90/89/88 vs bookstore87 | REPLACE | 不再构造假的总分；等价前沿最后多样性。 |
| cafe90/89/88 vs bookstore40 | REPLACE | 实际维度严格支配，不能因类别救回。 |

engine.test.ts 的 18 项仍保留：未知费用断言更新为 UNKNOWN 可行；“固定三策略且后两项两站”改为确定性、不强制三项、不重复 POI；休息测试显式 goal=rest；84 组合中的“不消费必为免费”改为费用维度激活，其余预算/步数/来源断言保留。
searchPolicy 的 21 项以及全部 B/server 测试不改；没有 G01–G04 或 C01–C10 正式验收套件。

## 18. Validation

最终执行结果见本报告末尾 VERIFIED。检查使用项目原样 pnpm 脚本，不降低安全规则；不输出或读取真实密钥值。构建脚本及 verify:bundle 内部完成客户端密钥检查。

## 19. Limitations

- 真实候选常有相同类别匹配、动态停留填满预算；更近地点可能同时有更低移动和更多活动，因而严格支配更远地点。此时少于三个是正确结果，不用虚构体验制造差异。
- UNKNOWN 多时 Pareto 前沿较大；保守保留不代表保证满足属性。费用原文解析很窄，未知不能说免费。
- goal=discover 只是已有合法类别信号，不证明新鲜、特色、网红、用户未去过。未接用户历史或真实 novelty 数据。
- 阈值 0.7、0.1、额外移动比例和 near-tie 0.03 为透明首版策略规则，未做真实用户效果优化；不是声称最优算法。
- 排序仅针对 B 已提供的、具备真实路线的候选池；不能恢复 B 未查询路线的候选。
- 详情 UI 的按需请求不会自动回灌当前 CandidateData；算法只有在输入已含 priceText 时才消费它，不自动请求详情。
- 所有语义 MUST 暂不支持严格验证；旧 excludedKinds 仍沿用原保守规则，不能据 discovery 名称证明符合排除要求。

## 20. CONTRACT_PROPOSAL

B 后续需审阅：avoidCost 目前仍只为 park/mall/bookstore 准备路线；nearby 仍会在路线可行性计数/返程准备中按去程五分钟提前处理。这与 A 侧新的 PREFER 语义不完全一致。本轮严格不改其策略或请求配额。
建议下一轮共同定义由 normalized preferences/maxWalkingMinutes 驱动的 B 路线准备兼容方式，避免软偏好在上游变硬过滤；SearchPolicy 对新显式 goal 的消费也需共同审阅。当前旧活动入口仍正常映射。
如需 quiet/indoor/novelty 或严格免费 MUST，先制定经过来源验证、带范围与时效的证据 contract；不要新增未经证实的 boolean。详情回灌也需单独约定，不在本轮接入。

## 21. UI_CONTRACT_PROPOSAL

现有列表继续使用 Recommendation 旧显示字段，costCaveat 保留；无需修改布局。未来可展示 trace uncertainties 和多个策略共享首选的原因。
若 UI 提供结构化 MUST，必须消费 buildDecisionResult.status/diagnostics 或明确处理 UNSUPPORTED_VERIFIED_MUST，不能解释成“附近无地点”。当前 UI 未新增这些控件。
旧“少走”文案/上游行为与软偏好全面对齐需要后续联调，本轮不修改任何 UI 文件。

## 22. 是否修改 src/map/**

本轮没有。开始前对原有修改在内的文件取 SHA-256 指纹，结束时逐文件核对。Git 中已有脏文件属于此前工作，不是本轮改动。

## 23. 是否修改 server/**

本轮没有。验证仅运行已有服务端测试/构建，不调用真实地图，不改变密钥边界。

## 24. 是否修改 UI

本轮没有修改 Planner、App、CSS、HTML 或其他 UI 文件。推荐的策略标签/解释属于 A 返回的内容；保持原 UI 渲染 contract。

## VERIFIED / NOT VERIFIED

VERIFIED：

- `pnpm typecheck`：通过，客户端与服务端类型检查。
- `pnpm test`：12 个文件、150 项通过；新机制测试 50 项，旧维度测试迁移为 4 项，engine 原 18 项保留并更新 4 处语义断言。
- `pnpm build`：通过，前端/服务端构建及内置客户端密钥检查。
- `pnpm verify:bundle`：通过，无 server-only AK 配置进入客户端 bundle。
- `git diff --check`：通过；新增 A 模块/测试/文档另检查行尾空白。
- 本轮开始前的 30 个受保护文件 SHA-256 全部一致，覆盖地图、服务端、共享 contracts、Planner/App/CSS/HTML；未覆盖或回滚原有修改。
- 无真实 API 请求、定位、commit、push；无 G01–G04/C01–C10 套件或后续功能扩展。

NOT VERIFIED：

- 本轮没有重新做浏览器或真实地点推荐效果验证；合成 REAL 类型 fixture 不是真实地图实测。
- B 侧 PREFER 对齐、详情证据回灌、语义 MUST 的真实证据，以及新 goal 对上游发现策略的直接消费尚未实现。
- 策略阈值和实际用户满意度未经过实地评估；没有宣称能发现当前 API 未提供的安静、座位或新鲜感。

到此停止，等待人工审阅。
