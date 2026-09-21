# Phase B2 Candidate Discovery v0.1 修订验收

日期：2026-09-21。在原工作区继续，保留此前未提交修改。未 commit/push。

## 1. A2 SearchPolicy 审计

Canonical：src/contracts/search.ts。实际类型名 SearchCategory，为 bookstore/mall/cafe/dessert/park 五值，不另造 ProductSearchCategory。SearchPolicy 含 version、availableMinutes、entries；entry 含 category、priority、reason。沿用 A 的 buildSearchPolicy，无修改 A 规则或 scoring。

## 2. prepareRealPlan 类别锁定

原 selectRouteCandidates 在最高有候选的 priority 层结束即 return，确实屏蔽 medium/low。已改为跨层分轮，保留最多 6 个的既有边界。本轮不调用真实 Direction API，不修改既有路线执行、hard constraints、时间分配或推荐算法。

## 3. Query mapping

src/map/searchMapping.ts 集中维护：bookstore=书店、mall=购物中心、cafe=咖啡厅、dessert=甜品店、park=公园。每类一个 query；A 不依赖百度词语。官方 LocalSearch 能力依据沿用 PHASE_B2_VALIDATION.md 中已查阅的指南及类参考；本轮重新实测查询质量，不声称官方保证分类精度。

## 4. DiscoveredCandidate

src/contracts/discovery.ts 的 poi、matchedSearchCategories、discoveryPriority 保持不变。poi.categories 是 Provider 事实；matchedSearchCategories 是发现来源。无 raw BMap 类型进入 A；无免费、室内、座位等推断。

## 5. 分层采样

按 high/medium/low，再按 canonical 类别枚举确定顺序。跨所有类别分轮，每轮每类最多新增一处唯一地点。每类 high/medium/low 上限为 3/2/1；不同优先级都先有一次机会，再分配追加名额。同级截断采用稳定枚举顺序，不代表推荐名次。无随机采样，无几何距离估算。

## 6. Candidate Pool Limit

每类只检查首页最多 5 条，五类最多检查 25 条；输出最多 10 个。既有 prepareRealPlan 下游截断保持最多 6 个，采用同样跨层规则。本轮未触发其真实路线调用。LocalSearch 串行、400ms 发起间隔，应用批次在途最多 1，不把并发 3 误作 QPS。

## 7. Deduplication

provider + providerId 去重，不按名称。跨 query 合并 matchedSearchCategories；查询按优先级排序，首次保存的 discoveryPriority 即最高命中级别。全部检查样本的来源先合并再采样，即使池满也不丢失已观察的来源。

## 8. 五类真实搜索

本轮使用页面标明的公开测试起点，未请求用户定位。walking 与 browsing 各一个顺序批次，五类均 success。下表 provider 总匹配与实际检查数不能混为一谈。

| 类别/query | 总匹配 | 检查/有效 | 样本 |
| --- | ---: | ---: | --- |
| bookstore / 书店 | 16 | 5/5 | 王府井书店(东华门大街店)、王府井书店、知喜书局(王府井喜悦店) |
| mall / 购物中心 | 13 | 5/5 | 王府中环-西座、王府井喜悦购物中心、北京apm |
| cafe / 咖啡厅 | 79 | 5/5 | 国家博物馆咖啡厅、糖房咖啡(故宫店)、METAL HANDS(前门店) |
| dessert / 甜品店 | 54 | 5/5 | 瑭所(王府中環店)、满记甜品(王府井北京市百货大楼店)、鲜芋仙(北京APM店) |
| park / 公园 | 5 | 5/5 | 中山公园、菖蒲河公园、前门公园 |

两个批次的 25 条首页样本均有有效身份、坐标和地址。书店分类均 unknown；商场部分为购物/综合商场/购物中心，也有办公大厦；咖啡/甜品多为 unknown，部分为餐饮；公园部分为旅游景点/公园，其余可缺失。不记录标识值、精确坐标或凭证。

## 9. browsing 实际 Candidate Pool

30 分钟，书店/商场 high，咖啡/甜品 medium，公园 low。10 个候选：

- bookstore 3：王府井书店(东华门大街店)、王府井书店、知喜书局(王府井喜悦店)。
- mall 2：王府中环-西座、王府井喜悦购物中心。
- cafe 2：国家博物馆咖啡厅、糖房咖啡(故宫店)。
- dessert 2：瑭所(王府中環店)、满记甜品(王府井北京市百货大楼店)。
- park 1：中山公园。

high/medium/low 实际为 5/4/1，未因 high 非空排除其他层。

## 10. walking 实际 Candidate Pool

30 分钟，park high，其余 low。7 个候选：中山公园、菖蒲河公园、前门公园，以及王府井书店(东华门大街店)、王府中环-西座、国家博物馆咖啡厅、瑭所(王府中環店)。公园 3，其他每类 1，非 park-only。

## 11. 噪声与重复

两批首页跨 query 重复计数均 0；真实重复合并尚无本轮样本，自动测试覆盖。人工按名称和 Provider 标签判断：书店、公园合理；商场出现楼座/办公分类；咖啡有博物馆及景区内部店；甜品包括酒店下午茶。这些作为已知语义噪声保留，不以关键词伪造分类、可进入性或免费属性。

## 12. Partial Failure

沿用 success/empty/provider_error/timeout；empty 即明确零结果，不等于错误。部分失败不取消其他类别，不以 Mock 补齐。本轮真实批次均成功；部分失败、超时、空结果、取消由现有自动测试覆盖，未声称真实故障分支实测。

## 13. A/B Contract 反馈

A 可从 DiscoverySnapshot.result.candidates 获取完整发现对象。旧 Real Provider 的 MapPOI[] 边界仍会省略元数据，不能称推荐核心已接入。已在 CONTRACTS.md 提出最小可选 discoveredCandidates 输入/输出扩展及身份一致性规则；本轮仅提案，未修改 A 模型。后续 A 审阅后消费元数据，不在 B 做 utility/MMR/Top 3。

## 14. 本轮修改文件

- src/map/prepareRealPlan.ts：修复最高层提前返回和候选身份键。
- src/map/prepareRealPlan.test.ts：更新跨类别、稳定性及缓存预期。
- src/map/discovery.test.ts：增加 browsing/walking 确定性跨层采样回归。
- docs/CONTRACTS.md：更新截断规则及 metadata 交接提案。
- docs/PHASE_B2_REVISION.md：本报告。

此前工作区已存在的其他 B2/时间语义/UI/推荐修改保留，本轮未继续改动。

## 15. Tests

pnpm typecheck、pnpm test（9 文件，89 项）、pnpm build、pnpm verify:bundle、git diff --check 均通过。覆盖五类 mapping、分层额度、walking 跨类别、身份去重及来源合并、不污染 Provider 分类、部分失败与空结果、optional 缺失、池上限、确定性、raw 类型边界、REAL/MOCK、既有 A 与时间语义测试。

## 16. VERIFIED / NOT VERIFIED

VERIFIED：上述命令、公开测试区域两种真实搜索策略、五类样本人工语义检查、10/7 个跨类别池。两次搜索只使用发现按钮，没有点击生成计划或旧公园路线诊断。

NOT VERIFIED：用户当前位置、跨区域精度、真实超时/部分失败/跨 query 重复、下游修订后真实路线与推荐结果、推荐核心 metadata 消费。没有检查控制台，不声称无新增错误。先前工具审批阻塞已在用户明确授权后解除，验证命令与页面读取均完成。

## 17. 下一阶段建议

人工审阅查询噪声、候选额度及 metadata 提案，再由 A 明确消费接口与推荐策略。当前停止于 B2，不开始 B3 或 Recommendation Algorithm 修改。
