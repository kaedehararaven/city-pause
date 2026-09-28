# B3_COMPLETION_REPORT

2026-09-22，A v0.3.1 之后的候选供给修复。保留首次B3实现，未重建工程、未commit/push。以下为本轮58项报告；所有fixture数字均为合成测试，不冒充用户现场。

1. **原 availableMinutes → search**：Planner生成SearchPolicy；DiscoveryPanel调用discoverTimeAware；生成REAL计划时ensureDiscovery可按较大预算补搜并沿用已确认起点。A仍使用同一v0.3.1。
2. **原 envelope**：`clamp(ceil(T*60/3*speed*1.25),400,12000)`米，近区层及扩展层；通勤门禁另行使用真实路线秒数。
3. **已存在**：REUSED_EXISTING_ENVELOPE，没有再造半径策略。
4. **原发现数量**：每类每层首页最多检查5条，5类最多25条，每层保留10个，两层池最多20个；原先缺少全量有效观测的去重漏斗，不能报告未经观测的真实总数。
5. **原 route quota**：初始6、补充最多8；即使大预算也最多8个候选获得路线。
6. **原分配**：类别优先级轮询，近区最多先占6，扩展区只剩2；没有独立goal-aware扩展保障。
7. **park饿死路径**：确实存在，扩展park可被较高搜索优先级或有限扩展槽排除；还可能在展示池保留阶段被截断。当前已让有效观测进入路线备用池，并保障walk扩展park槽。
8. **本轮 envelope**：保持原公式和参数；修复重点是扩大真正路线验证机会及完整漏斗，而非继续增大半径。
9. **walking heuristic**：2m/s检索参数，15/30/45/60/90分钟=750/1500/2250/3000/4500m。不是用户步速或ETA。
10. **cycling heuristic**：6m/s检索参数，同预算=2250/4500/6750/9000/12000m。不是骑行速度事实。
11. **常量**：ENVELOPE_POLICY集中定义速度、1.25 slack、最小400m、最大12000m；LocalSearch官方半径上限100000m（首次B3已查官方文档）。首版宽松参数配合cap控制采样噪声，不称最优。路线数量/近区锚点/扩展目标槽/间隔集中在ROUTE_VALIDATION_BUDGET。
12. **不是 route facts**：没有把估算速度显示给用户、写入RouteResult或Evidence；搜索圈与分层只控制证据采集。最终只使用成功真实provider路线米数/秒数。
13. **validation budget**：≤15分钟6、≤30分钟10、≤45分钟12、>45分钟14个候选/模式。walking与cycling同配额但各自envelope和路线事实。默认一次模式最多6/10/12/14个去程；要求返程最多12/20/24/28次；显式双mode最多12/20/24/28次去程或24/40/48/56次双向请求。成功缓存可减少实际调用；去程已失败或超过全部通勤上限时省去无意义返程。没有读取账户额度或保证额度充足，以上是Demo应用请求上限。
14. **allocation**：同provider+id去重，稳定identity排序；明确goal主匹配类别、SearchPolicy priority、固定类别序形成确定性供给顺序。每轮一类一槽，优先尚未覆盖类别，之后公平补充；不全量请求，不随机，不把priority用于A质量比较。
15. **goal-aware**：只读调用A现有normalizeIntent/needMatch/isPrimaryMatch作COVERAGE SIGNAL。walk优先公园，rest保障合理休息类别，discover保障书店/商场；不在B复制一套需求分数。扩展槽可用时先给目标相关扩展候选最多2个位置。
16. **cross-category**：每轮跨类别取得事实，已覆盖类别在补充时让位给未覆盖类别；high priority不能先填满所有槽。flexible没有预设咖啡primary，沿用无偏匹配及类别覆盖。
17. **band coverage**：保留短预算近区前6个，大预算新增槽优先扩展区；30/45/60分钟最多新增4/6/8个。near为较小查询层发现，expanded为较大查询层新增，随mode/envelope定义，不是0–500m固定分界，也不声称道路距离大小。有效观测备用池至多50条，展示池仍至多20；未保留到展示池的park也可获得路线机会。
18. **avoidCost**：原B3已去除白名单，本轮继续保持；UNKNOWN咖啡费用不阻止route slot，不推断expensive/free。
19. **nearby**：原B3已去除5分钟过滤，本轮保持；少走PREFER不影响获取路线资格。
20. **numeric MUST**：A在真实route facts之后执行。B不再用重复的最低停留常量或numeric MUST提前停止返程，避免将“因硬要求不查返程”误报为provider失败；保留确定不可通过的去程失败/超总通勤门禁返程节省。显式类别排除也交给A硬检查并记原因，不按类别推断地图事实。
21. **walking RouteResult**：复用既有通用distanceMeters/durationSeconds/durationMinutes和walking别名/helper。精确秒数用于判断，旧ceil分钟不进入硬门禁。
22. **cycling RouteResult**：复用已有普通骑行mode及通用数值，没有walking伪字段；失败不填距离/时间。官方固定Direction v2 riding由服务端调用，BD-09明确，真实duration仅为路线骑行时间。
23. **shared contract**：CONTRACT_CHANGE仅新增optional discovery observations及optional audit funnel；RouteResult核心、CandidatePlan和A规则不变。
24. **兼容**：旧快照无observations仍可选路线；未知原始观测/去重统计为null，不假造。原routePreparationAudit字段保留；全失败仍抛错，但新增audit供诊断；旧调用无需改UI。
25. **POI × mode**：真实provider+providerId不变，walking/cycling路线缓存和CandidateData分开，A方案既有mode标记及variant identity沿用。
26. **walking pool**：prepareRealPlan默认walking；现有App无需改动即可用新配额/漏斗。
27. **cycling pool**：prepareRealMobilityPools显式调用两模式，各自产生data和audit；同一A引擎分别决策，不跨mode Pareto；失败互不补Mock。
28. **open_ended**：复用T*60/4，60min精确900秒。默认只查去程。
29. **return_to_start**：复用T*60/3，30min全部通勤精确600秒；A总预算、最低活动、缓冲等仍同时成立。
30. **directed return**：同mode独立反向请求，不把去程翻倍，不混用步行与骑行。失败明确记录。已存在站间路线仍由A原规则处理，本轮无新多站优化。
31. **秒级边界**：新增449/450通过、451失败；899/900通过、901失败；返程250+350通过、250+351失败。无提前round。
32. **candidate funnel**：audit.funnel记录预算/goal/mode/门禁、searchedQueries、有效观测数、去重数、retained池数；总计及byCategory含discovered/routeSelected/routeSuccess/travelGatePass/hardFeasible/deliveredPrimary。routeSuccess指全部必需方向成功，去程单独成功但未查/失败返程不算全成功。hardFeasible直接读取A单点可行集，deliveredPrimary是其中PRIMARY_MATCH，不是最终获推荐数。类别可交叉，分项不必相加等于总数。
33. **park funnel**：支持NO_PARK_DISCOVERED、PARK_NOT_ROUTE_SELECTED、PARK_ROUTE_FAILED、PARK_OVER_TRAVEL_BUDGET、PARK_HARD_INFEASIBLE、PARK_DELIVERED_TO_A。逐候选脱敏记录类别、band、路线状态、outcome、失败check，可见多原因并存；摘要取已达到的最深入阶段。查询失败/partial状态也记录，未发现不证明现实无公园。readLatestRouteAudit(mode)可供开发侧检查，开始新准备即清旧值，取消不发布新值。
34. **15min fixture**：6个近区候选，6入选/成功，5过门禁/硬可行，park发现0、primary park交付0，明确NO_PARK_DISCOVERED。一个4min近处地点因225秒门禁未通过。
35. **30min fixture**：14个候选，10入选/成功，6过门禁/硬可行；发现2park、2入选/成功，但均720秒超过450秒，交付primary park=0。
36. **45min fixture**：14个候选，12入选/成功，6过门禁/硬可行；2park仍720秒>675秒，交付0。
37. **60min fixture**：14个候选，14入选/成功/过门禁/硬可行；2park均720秒<=900秒，交付primary park=2。详见末尾专项。
38. **E01–E05**：4min地点15失败30通过；12min地点30失败60通过；扩展park获得槽；原合法近候选仍存在；只断言供给/可行性扩大，不要求最终推荐换点。
39. **C01–C04**：6近咖啡/书店+2扩展park在8槽测试下，park均得路线资格；rest、discover保障相关类别，flexible补齐未覆盖类别；输入反序入选一致。这些断言检查供给，不锁定谁推荐获胜。
40. **P01–P04**：avoidCost/nearby不改变入选池；UNKNOWN费用保持unknown；numeric MUST让已有成功且通过travel gate的park被A判硬不可行，公园摘要为PARK_HARD_INFEASIBLE而非路线失败。
41. **M01–M06**：保留原双mode同POI、缓存隔离、来源/端点、cycling失败不Mock和不伪造数值测试；新增walking全失败但cycling成功仍输出独立可行结果。原A模式隔离回归保持通过。
42. **测试数**：新增supply.test.ts 18项。基线202项，现220项/18文件；6项旧测试仅将固定6/8请求数更新为新配额下10/14/20，缓存复用、全部失败、来源/模式断言未删。原A测试文件未改。
43. **文件**：新增src/map/routeValidationPolicy.ts、supplyDiagnostics.ts、supply.test.ts；修改src/map/prepareRealPlan.ts、discovery.ts、timeAwareDiscovery.ts、prepareRealPlan.test.ts、mobility.test.ts，src/contracts/discovery.ts、mobility.ts；更新docs/CONTRACTS.md、旧B3报告指向，新增本报告。
44. **src/map/**：有修改，仅供给、有限路线请求与诊断/测试。
45. **server/**：未修改。已有walking/cycling固定路由、400ms串行、待处理32、缓存5min/128条及AK边界复用。
46. **recommendation/**：完全未改。对24个A与server文件做本轮开始/结束内容摘要比对，无变化，包括v0.3.1充分性、Need、PRIMARY/FALLBACK、Pareto、策略和UNKNOWN。
47. **UI**：未修改，无UI_CONTRACT_PROPOSAL必要；原App调用prepareRealPlan自然接入。漏斗为开发/数据层，未做地图或骑行分栏。搜索估算速度未显示给用户。
48. **typecheck**：pnpm typecheck通过。
49. **tests**：pnpm test全部通过，18文件220项。
50. **build**：pnpm build通过，前端和服务端构建正常。
51. **bundle security**：构建内检查及独立pnpm verify:bundle通过；诊断专门测试不含坐标/uid/provider raw payload。未输出、索取或手工读取真实AK。
52. **diff check**：git diff --check通过。未reset/checkout覆盖或重建工程，未commit/push。
53. **real walking**：本轮NOT VERIFIED。首次B3的公开区域walking成功响应属于历史证据，不能替代本次“真实POI→新供给漏斗”的验证。
54. **real cycling**：本轮NOT VERIFIED。复用首次B3已按官方文档实现并成功烟测的riding capability，未新增endpoint或假定账户额度。没有本轮真实POI骑行测量。
55. **real time expansion**：NOT VERIFIED。尝试打开独立本地公开测试页时自动审批超时；工具允许重试一次后又以重复受限操作为由拒绝。未绕过浏览器限制、未使用其他表面或间接请求达成同一受限验证。fixture漏斗与真实页面验证严格分开。
56. **limitations**：仍为每类首页采样，provider未返回的点不可凭空发现；观察池最多50、路线最多14/模式，不能保证全城覆盖或每个park都有槽。near/expanded是查询来源，不是道路距离；新增观察池让展示截断不再隐藏已观察primary，但数据不稳定、goal/policy变更时不保证候选集合严格单调。有限额外请求可能增加延迟/消耗，参数需真实quota与现场反馈继续校准。aggregate park摘要不能取代逐项原因；两层类别失败摘要沿用已有合并结构，整体partial可提示其中一层失败，不提供逐页完整provider日志。骑行无取车/停车常量，非完整door-to-door时间。
57. **VERIFIED**：220项、typecheck/build/bundle/diff；完整fixture漏斗、精确秒数门禁、goal/cross-category/扩展槽、原始有效观测备用池、失败状态、取消与缓存、mode隔离、A源码边界。诊断不改变A推荐结果。
58. **NOT VERIFIED**：本轮用户现场、公开区域真实walking/cycling/POI完整联调、真实15/60供给对比、provider no_route/超时、实际quota余量。fixture不当作真实验证，不宣称用户的具体咖啡回退已在现场消失。

## 60MIN_WALK_DIAGNOSTIC

**REAL WORLD NOT VERIFIED；以下为固定fixture的已执行结果。** 六个近咖啡/书店，加八个扩展候选，其中两座公园；公园真实路线字段以合成720秒填入用于测试，不声称来自百度。

| 问题 | 结果 |
| --- | --- |
| walking travel gate | 精确900秒，open_ended |
| discovered park | 2 |
| walking route slot | 2 |
| 必需方向route success | 2 |
| <= travel gate | 2 |
| A hard feasible | 2 |
| 作为PRIMARY交给A | 2 |
| 如果0，在哪层 | 此fixture非0，PARK_DELIVERED_TO_A；另有未发现/未选路线/失败/超门禁/其他硬约束fixture逐项通过 |
| 近处咖啡占满名额、所有扩展park无route的旧路径 | 在此6近+2park场景已消除；8槽即保证两park入选，60min正式上限14。更多park仍受有限预算，不承诺全量路线 |

下一次现场出现“60min散步→咖啡”，读取本次mode/budget/goal对应audit，即可核对输入公园数、入选/成功/门禁/A可行各阶段和逐项原因；若PARK_DELIVERED_TO_A且deliveredPrimary>0而A仍仅给degraded，应作为跨层异常排查，不能用供给不足解释。

STOP：等待人工审阅，不开始A v0.3.2、导航、骑行UI或其他阶段。
