# B3_COMPLETION_REPORT

本文件是首次 B3 的历史报告。A v0.3.1 后的供给修复、最新配额和公园漏斗以 [B3_SUPPLY_COMPLETION_REPORT.md](B3_SUPPLY_COMPLETION_REPORT.md) 为准。

日期：2026-09-22。范围：Time-aware Candidate Supply + Walking/Cycling Mobility Upgrade。保留原目录及既有未提交成果；没有 commit/push。本报告记录实现和验证边界，不启动导航或最终验收。

## 客户端预算同步修复（后续反馈）

用户反馈切换到 30/45/60 分钟后持续提示搜索范围不足。原因是 Planner 更新预算，但 App 仍把旧 DiscoverySnapshot 直接交给 prepareRealPlan；地图面板显示的新范围并不表示已经重新检索。

现由 App 在生成 REAL 计划的串行任务中先执行 ensureDiscovery：当前快照范围/类别不足时，调用 DiscoveryPanel 注册的补搜函数，沿用原已确认起点、按当前 SearchPolicy 查询，再交给路线准备。补搜不重新定位；结果更新不会触发取消本次生成的 realRevision。较大池可用于较小预算；真实搜索失败不复用旧池冒充扩展成功，取消结果不发布。路线硬门禁保持不变。

新增 ensureDiscovery.ts 及四项回归测试，并修改 App.tsx、BaiduMap.tsx、DiscoveryPanel.tsx 接线。本补充覆盖下文关于“范围不足须手动重新搜索”的初版描述；下文 185 项为 B3 初版验证记录。补充修复未使用用户实际定位或额外真实路线 API 验证。

修复验证：typecheck、16 文件/189 项测试、build（含客户端密钥检查）、git diff --check 均通过。真实页面切换预算后的自动补搜效果仍需用户现场复测。

1. **原 Candidate Discovery 流程**：Planner 意图生成 SearchPolicy；B2 按五个 ProductSearchCategory 映射 LocalSearch 查询，串行执行，校验真实 identity/BD-09，跨类别去重、分层分配，形成 DiscoveredCandidate[]。原固定半径 1500m，每类检查首页最多 5 条，总池最多 10；discoveryPriority 是配额元数据，不是地点事实。

2. **原 route preparation 流程**：跨类别选前 6 个候选，成功可用代表不足时补至 8；仅 walking，默认去程，明确返程才查独立返程。旧 avoidCost 类别白名单和 nearby 约 5 分钟过滤会让 A 收不到本应比较的候选。availableMinutes 原用于 SearchPolicy、停留/缓冲和总预算，但未扩大真实搜索空间。

3. **原 walking RouteResult contract**：source/provider、BD-09、有向 from/to、mode=walking、显式失败状态；成功包含 walkingDistanceMeters、walkingDurationSeconds、向上取整的 walkingMinutes。A 通过 canonical contract 消费，不读取百度原始响应。

4. **cycling 真实 capability**：先查官方文档后采用百度 Direction API v2 普通骑行，固定 `/direction/v2/riding`，riding_type=0；origin/destination 为纬度、经度，最多六位小数，coord_type/ret_coordtype=bd09ll，output=json，可传 destination_uid。消费 result.routes 的 distance（米）和 duration（秒）。2001 对应 no_route，其他供应商错误及超时分别保留失败状态。官方参考：[骑行路线文档](https://lbs.baidu.com/docs/webapi?title=directionv2/webservice-direction/cycling)（查阅页更新日期 2026/03/19）；[LocalSearch](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.LocalSearch.html)。不对账户权限/剩余额度作保证。

5. **CONTRACT_CHANGE**：修改 shared RouteResult，mode 泛化为 walking/cycling，新增通用 distanceMeters、durationSeconds、durationMinutes；失败不携带伪造数值。新增 mobility.ts 时间门禁及请求审计；CandidateData、CandidatePlan、DecisionTrace 和 DiscoverySnapshot 增加 mode/供给字段。这是支持骑行与秒级判断所需的最小迁移。

6. **兼容策略**：walking 保留必需的旧字段，通用字段可选以兼容历史 fixtures；routeMetrics 从旧秒数得到精确分钟，validRouteMetrics 检查字段一致性。cycling 必须有通用字段，不能填 walking 别名。旧 RouteResult.walkingMinutes 仍 ceil；CandidatePlan 的分钟计算改为精确值，不再继承这个舍入。旧调用未指定 mode 时默认 walking。

7. **walking 实现**：保留既有固定服务端接口和真实方向 API，客户端 adapter 同时提供通用精确字段。缓存按 mode 与有向端点区分，消费前检查 source/provider/BD-09/端点/指标。旧 fetchRequiredRoutes 仅复用合法 walking 缓存。

8. **cycling 实现**：服务端固定 `/api/map/cycling-route`，参数校验、官方 schema adapter、状态映射、超时和脱敏；客户端 fetchCyclingRoute 校验 provider 标识、mode、坐标系及数值关系。两模式共享服务端串行队列、400ms 间隔、最多 32 个待处理唯一请求、成功缓存 5 分钟/最多 128 条。仅服务端读取已有 AK，未新增依赖。

9. **open_ended 1/4 gate**：src/contracts/mobility.ts 的 travelLimitSeconds/passesTravelGate；prepareRealPlan 做请求前后筛查，engine.buildFeasiblePlans 作最终硬过滤。现有站间路段计入累计通勤，不新增多站优化。默认无返程请求和返程步骤。

10. **return_to_start 1/3 gate**：同一 helper，累计去程、已有站间移动和独立返程秒数 <= T*60/3；不能把去程翻倍代替返程。失败/缺失返程不可行。最低活动、动态缓冲、总预算、来源/坐标一致性同时成立才生成计划。

11. **秒级边界**：门禁比较原始秒数；30 分钟 open_ended 下 450 秒通过、451 秒失败。分钟用 seconds/60，停留分配允许小数，数值 MUST 也比较秒数。仅 Planner 显示/复制文本保留一位小数，计算不受显示舍入影响。

12. **动态 envelope**：radius = clamp(ceil(T*60/3 * modeSpeed * 1.25), 400, 12000) 米；使用两种 returnMode 中较大的可能去程上限，避免非对称返程被过窄搜索漏掉。同 mode 切换 returnMode 不改变搜索圈。参数集中在 ENVELOPE_POLICY，可调整但不宣称最优。超过 15 分钟时保留 15 分钟近区层，再查扩展层；以 provider+providerId 合并，最多 20 个地点。搜索快照小于新预算所需范围时明确要求重新搜索。

13. **walking envelope**：宽松搜索速度参数 2m/s，不是对用户步速的事实判断。15/30/45/60/90 分钟对应 750/1500/2250/3000/4500m。

14. **cycling envelope**：搜索速度参数 6m/s，同样仅启发式。15/30/45/60/90 分钟对应 2250/4500/6750/9000/12000m，90 分钟已触及 cap。

15. **为什么只是 heuristic**：半径用来获取可能可行的点，直线半径不等于路线时间，不参与最终可行性与质量排序。LocalSearch 官方允许半径参数，12000m 小于官方最大范围；本地 cap 控制噪声和采样规模。道路绕行、可骑行性、供应商结果排序都可能造成遗漏或超时，最终只信真实路线时长。

16. **quota policy / audit**：同 mode 每层至多 5 次类别查询，每次检查 5 条；短预算一层最多 5 次，扩展预算两层最多 10 次。串行 LocalSearch，并发 1，小于用户额度 3。每 mode 最多 8 个候选准备路线：优先覆盖类别，初始最多 6，补充至 8；有 expanded 层时保留近区前 6 并给扩展候选最多 2 个位置。大预算允许检查补充槽，不因已够 3 个可用点停止扩展。显式 prepareRealMobilityPools 才跑双 mode：去程最多 16 次，返程全部需要时最多 32 次；当前 UI 只请求 walking，不隐式翻倍。audit 返回 discovered、travelMode、candidateLimit、prepared、requested、cached、successful、按状态 failed；successful 含缓存，requested 不含缓存，均为路线条数。合成扩展场景实测 audit 为 discovered=30、prepared/requested/successful=8；30 是测试供给，不是线上池上限。公开接口烟测各请求 1 次 walking/cycling 且均成功，不冒充完整 discovery audit。

17. **avoidCost PREFER 修复**：移除 B 路线准备的类别白名单，未知费用 cafe/dessert 仍可获得真实路线；低消费交给 v0.3 证据与偏好判断。没有把公园说成免费。

18. **nearby PREFER 修复**：删除 B 旧 5 分钟门槛，改由通勤占比门禁和 A 同 mode 决策处理。Planner 简短文案改为“优先少走（软偏好）”。

19. **numeric MUST**：显式 maxWalkingMinutes 仍是硬约束，比较所有 walking 路段秒数；不会把 cycling 时间伪装为步行来套用它。骑行方案仍受比例门禁及总预算限制，未建模到车/停车后的额外步行。

20. **POI × travelMode**：真实 identity 不变，CandidatePlan.travelMode 标示变体，cycling plan ID 加 mode 前缀，walking 兼容旧 ID。保留 route mode/source/provider/from/to/coordinateSystem。同 POI 可同时存在两池。

21. **独立推荐池**：prepareRealMobilityPools 和 buildMobilityDecisions 提供显式双池入口；同一 buildDecisionResult 按 mode 筛选有向路线，并分别执行 normalization → Hard Feasibility → Evidence → Dynamic Dimensions → Pareto → Strategy Selection → Diversity/Dedup。未恢复固定 Utility、Quality Gate、远距离奖励或 diversity 质量扣分。decision.ts 仅把移动量读取改成通用 travelMinutes，没有修改 dominance/阈值/策略规则。

22. **DecisionTrace**：记录 travelMode；CandidatePlan 同时含 travelMinutes、travelDurationSeconds、outboundTravelSeconds、可选 returnTravelSeconds，已有 stay/buffer/total/remaining 保留。cycling 的步行累计字段为 0，通用移动字段和“骑行”步骤表达事实；后续 UI 应使用通用字段。supplyAudit 记录 candidateCount、feasibleCount、paretoCount、collapse；candidateCount 是输入地点数，feasibleCount 是方案数，历史多站输入时两者未必一一对应。

23. **PARETO_COLLAPSE_OBSERVED**：walking、cycling 各自的合成 12 个同需求可行方案，均出现 12 feasible → 1 Pareto。engine 在 >=10 feasible 且 Pareto=1 时输出该 diagnostic。不声称在真实候选池观察到了此现象；当前 B 请求上限 8 也限制了线上单点样本量。

24. **dominance 原因**：测试保持 Need Match 相同，较近方案 mobilityBurden 更小，剩余活动时间更多或不更少，其他可比较维度不差，因此同时占优。trace 保留 dominatedBy/comparableDimensions。没有为凑三卡恢复 dominated 候选；Activity Opportunity 相关性问题留给下一轮 A 决策。

25. **本轮文件**：新增 src/contracts/mobility.ts、src/map/discoveryEnvelope.ts、src/map/timeAwareDiscovery.ts、src/map/timeAwareDiscovery.test.ts、src/map/mobility.test.ts、server/cycling.test.ts、本报告。修改 src/contracts/map.ts、discovery.ts；src/map/capabilityClient.ts 及测试、localSearchDiscovery.ts、prepareRealPlan.ts 及测试、DiscoveryPanel.tsx；server/app.ts、baiduMapService.ts；src/recommendation/model.ts、realProvider.ts、engine.ts 及测试、decision.ts、decisionTypes.ts、evidence.ts、decision.test.ts、searchPolicy.test.ts；src/Planner.tsx、docs/CONTRACTS.md。部分文件本轮开始前已未提交或未跟踪，未把此前改动归成本轮成果。App.tsx/CSS 未在 B3 重构。

26. **新增测试数量**：基线 150，本轮新增 35，现共 185 项/15 文件。新增 mobility 23、cycling 服务端 9、timeAwareDiscovery 2、客户端 cycling 1。包含 T01–T20 行为关系、秒级边界、模式隔离、独立返程、PREFER/MUST、半径扩展、近区保留、配额、来源缓存、失败不补 Mock、Pareto collapse。合成 REAL 标签只是 adapter 测试数据，不是真实 API 验证。

27. **原测试修改**：旧超过 1/4 或 1/3 通勤门禁的 fixture 调整预算/路线，保持其原来要验证的来源、总预算、证据和排序关系；新增门禁测试单独验证拒绝行为。旧整数分钟期望改为精确秒数换算，动态停留期望相应更新；客户端 walking 期望增加通用字段，类型 fixture 明确 walking 判别。未为得到三结果改变 Pareto。

28. **typecheck**：pnpm typecheck 通过。收尾修复递归 selectRouteCandidates 返回类型，未跳过 TypeScript 错误。

29. **tests**：pnpm test，15 文件、185 项全部通过。

30. **build**：pnpm build 通过（客户端、服务端和构建内 bundle 检查）。

31. **bundle security**：构建内检查及独立 pnpm verify:bundle 通过；使用已有安全脚本检查服务端配置名及本地配置值，不显示凭证。真实请求输出仅脱敏状态/来源/耗时摘要；新增测试使用合成占位数据。没有读取/打印真实 AK，无前端服务器配置、任意 URL 代理或秘密日志新增。

32. **diff check**：git diff --check 通过。保留原 Git 工作区，不 reset/checkout 覆盖、不提交、不推送。

33. **真实 walking**：公开测试区域，经现有本地服务端返回 HTTP 200、baidu-direction-v2-walking、BD-09、642 秒。30 分钟 gate=450 秒，故拒绝；15 分钟 gate=225 秒不通过，60 分钟 gate=900 秒通过通勤门禁。这证明同一真实路线随时间预算有进入可能，不等于完整计划必然可行。

34. **真实 cycling**：相同公开区域测试返回 HTTP 200、baidu-direction-v2-riding、BD-09、1806 秒；30 分钟门禁不通过，60 分钟也不通过。没有假设骑行一定快。两接口请求使用明确有向端点及 BD-09 参数，adapter/provider 链路已验证；未独立验证百度道路吸附后的端点几何或实际通行状况。未使用用户定位，报告不含精确坐标/真实 uid。

35. **src/map/**：有修改，动态搜索层、route mode、缓存/配额和审计见上述条目。

36. **server/**：有修改，官方骑行 capability 与共享路线限流缓存；没有公开 Server AK。

37. **recommendation/**：有必要的 contract 消费与通勤硬约束修改；Evidence 读通用移动距离/时间，DecisionTrace 增加 mode 和供给诊断。没有重写 v0.3 的排序规则。

38. **UI**：极小 wiring；DiscoveryPanel 使用 walking 动态 envelope，显示实际范围及搜索不代表可行性，Planner 修正软偏好文字和分钟显示精度。仍是原布局、原 walking 推荐入口，没有新增 riding 按钮、分栏或导航。

39. **CONTRACT_PROPOSAL**：已落实本任务要求的 mode-aware 通用 RouteResult、秒级 Travel Share Gate、供给/请求 audit。详细 canonical 路径见 CONTRACTS.md；进一步模式 overhead、路线几何字段留待未来 proposal，不填虚构数据。

40. **UI_CONTRACT_PROPOSAL**：本轮先声明再完成上述最小 wiring。未来可消费 buildMobilityDecisions.walking/cycling 展示各自 Easy/Balanced/Explore；本轮未接双池到可视化切换。不能将“骑行数据能力完成”表述为“客户端骑行分栏已经上线”。

41. **limitations**：envelope 速度和 cap 是可配置启发式，首页采样/类别配额/最多 8 个路线候选均可能漏点；近区保留是在相同 policy 和稳定供应商结果前提下的分层保证，不能保证不同时间真实 API 结果完全一致。两层类别统计为观测条数之和，totalReported 不相加，类别 status 保留扩展层状态，整体 partial_success 提示任一层失败；它不是逐层完整审计。客户端成功路线缓存沿用页面会话生命周期，服务端缓存有 5 分钟 TTL，长驻页面可能需要重新加载获取新路线。cycling duration 仅“路线骑行时间”，不包含取车/还车、停车、骑车可用性或完整门到门耗时；保留既有动态 buffer，不加固定 overhead。低移动偏好继续采用现有同池 v0.3 规则，未新增骑行难易事实。导航、线路几何可视化和分栏 UI 未实现。

42. **VERIFIED**：185 项测试、typecheck/build/bundle/diff；官方骑行 capability 与公开点 walking/cycling 成功响应；真实时长的 30 分钟门禁和 walking 15→60 分钟可行性扩展可能；合成双 mode 独立决策、保留近区并增加扩展层、严格配额和失败边界。

43. **NOT VERIFIED**：完整真实 15/60 分钟多类别 discovery 池扩展和浏览器双 mode 推荐全流程；真实 no_route、真实超时、返程骑行、导航道路几何及现场可执行性；真实大候选池 Pareto collapse。以上不以合成测试替代。本轮停在 B3，等待人工审阅，不启动导航、G01–G04 或 C01–C10。
