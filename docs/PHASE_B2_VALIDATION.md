# Phase B2 — Multi-category POI Discovery v0.1

日期：2026-09-21。工作分支：codex/b2-poi-discovery。

## 1. 基线与 A2 审计

共同基线 944863d；原工作区干净，远端 main 与本地一致，包含 Time Semantics v0.1。
A2 压缩包五个文件通过 manifest SHA-256 校验，导入时统一 CRLF 为 LF；Contract 仅追加 A2 节，没有覆盖现有时间语义。
A2 已独立提交 7095283 并推送 origin/codex/a2-search-policy。本阶段 B2 在其后续本地工作分支进行，未提交、未推送。

A provides：src/contracts/search.ts 的 SearchPolicy(version=0.1, availableMinutes, entries)，SearchPolicyEntry(category, priority, reason)，SearchCategory 五值与 SearchPriority 三值。实际 canonical 名称不是 ProductSearchCategory。
B needs：上述策略 + BD-09 检索中心 + B 管理的查询与数量边界。已有 A2 足够，无需改 A 类型。新增 DiscoveryRequest 将中心与策略组合；不把用户分钟数当搜索半径。

## 2. 官方依据与映射

- [LocalSearch 指南](https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/lbs/localsearch)：searchNearby(keyword, center, radius)、回调、总数/当前页数量及 POI 读取。页面当时标注更新于 2026/08/03。
- [LocalSearch 类参考](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.LocalSearch.html)：Point 可作为检索位置；pageCapacity 为 1–100；searchNearby 半径单位米；getStatus / clearResults；不设 renderOptions 可仅使用回调。
- 文档说明 API 的能力，未保证产品类别与关键词的一一对应。以下是经本阶段单区域实测的 v0.1 查询选择，不能称为跨城市最佳查询。

| Product Category | Baidu query | 判断与限制 |
| --- | --- | --- |
| bookstore | 书店 | 实际样本为书店/书局；不同标识的同名书店不按名称合并。 |
| mall | 购物中心 | 返回商业综合体；供应商分类有办公大厦、行政地标等不一致。 |
| cafe | 咖啡厅 | 返回咖啡厅、咖啡品牌；可能位于博物馆/景区内，不保证可直接进入或有座位。 |
| dessert | 甜品店 | 返回甜品品牌，也含酒店下午茶；不能等同于严格纯甜品专营店。 |
| park | 公园 | 返回公园/园林；不保证免费或开放可达。 |

## 3. 数据结构、数量与并发

新增 src/contracts/discovery.ts：
DiscoveryRequest = policy + center；
DiscoveredCandidate = poi + matchedSearchCategories + discoveryPriority；
CandidateDiscoveryResult = source + status + candidates + categories。
不复制 SearchPolicy，不改 MapPOI / RouteResult，不透出 BMap raw response。

- 固定搜索半径 1500m；每类一个白名单关键词，最多五次应用层 LocalSearch 调用。
- 串行搜索，每个 B2 批次最多一个在途查询；相邻查询启动至少相隔 400ms。用户确认的上限是 JS 地点检索服务并发 3，不是 QPS 3。
- 每查询只取第一页，pageCapacity=5，额外对回调结果 slice 至 5；不翻页、不自动重试。
- high / medium / low 决定搜索顺序与每类最多新增 3 / 2 / 1 个唯一候选，同级按 canonical 顺序调度。
- 收齐最多 25 个适配样本后按优先级顺序分轮，每轮每类最多增加一个，输出池最大 10。资源不够时不保证每个 high 都达到 3。
- 同 provider + providerId 只保留一次，发现类别合并，discoveryPriority 为最先搜索到的最高等级。名称相同不代表同一地点。
- 去重涵盖检查过的所有样本，matchedSearchCategories 不会混入 provider categories。
- 只做坐标范围、必需身份、来源验证和数量截断；没有几何距离 heuristic，没有 walkingMinutes 推算。
- 超时/取消只能结束应用等待并忽略迟到回调；JSAPI 没有暴露已发请求的可靠网络取消方法，因此不承诺能撤回百度已接收的请求。

## 4. 真实搜索记录

环境：本地 Vite + 现有 Browser AK 的 JSAPI 4.0；公开开发默认区域（北京天安门附近），非用户当前位置。沿用公开开发中心，不记录精确坐标、POI 标识或凭证。
两次批次分别用于初始观察与调整后复验，均串行完成，不同时运行多个验证批次。
默认 30 分钟策略为四 high、一 medium。第二批次最终结果如下：

| Category/query | provider 总匹配 | 实际检查/有效 | 入池新增 | 观察样本（名称用于人工判断） |
| --- | ---: | ---: | ---: | --- |
| bookstore / 书店 | 16 | 5 / 5 | 2 | 王府井书店(东华门大街店)、王府井书店、知喜书局(王府井喜悦店)、GEONE书店、法信书店 |
| mall / 购物中心 | 13 | 5 / 5 | 2 | 王府井喜悦购物中心、北京apm、东方新天地(东单店)、王府中环、北京王府井银泰in88 |
| cafe / 咖啡厅 | 79 | 5 / 5 | 2 | 国家博物馆咖啡厅、糖房咖啡(故宫店)、METAL HANDS(前门店)、福叁咖啡&小红帽三明治(西兴隆街店)、诗意栖居咖啡馆(故宫店) |
| dessert / 甜品店 | 54 | 5 / 5 | 2 | 瑭所(王府中環店)、满记甜品(王府井北京市百货大楼店)、鲜芋仙(北京APM店)、左庭上院酒店·院里花开下午茶、闪电巴黎L'ECLAIR DE GENIE(王府中環店) |
| park / 公园 | 5 | 5 / 5 | 2 | 中山公园、菖蒲河公园、前门公园、月亮湾公园、蕙芳园 |

五类均为 success，最终池 10 个，每类各 2 个。25 个检查样本均具有有效标识、坐标和地址；跨 query 重复计数均为 0。仅说明此次首页样本，不能外推为 provider 总结果无重复。

Provider categories 观察：
- 书店样本 tags 均缺失，保持 unknown。
- 北京apm 出现购物/综合商场/购物中心；东方新天地为购物。
- 王府中环返回商务大厦/办公大厦，银泰in88 返回行政地标。不能用产品查询词覆盖这些事实。
- 咖啡/甜品多数 unknown，部分仅为餐饮。
- 中山公园为旅游景点/风景区/旅游区；菖蒲河公园为旅游景点/公园，其他部分缺失。

初次观察发现 tags 带 font 高亮标签，旧分隔逻辑会拆碎 HTML 结束标记。现于 POI Adapter 去除已观察到的 font 展示标记后再分隔；二次实测确认输出干净文本，不执行 HTML、不增添产品类别。
初版顺序填池会让最后类别没有份额，现改分轮分配，第二次确认五类均有候选。

## 5. 失败、取消与边界

逐类 success / empty / provider_error / timeout；成功回调且明确零计数视为 empty。状态 2 仅在同时明确零结果时视为 empty，不单凭状态猜测。其他失败返回固定枚举，不复述 provider 错误信息。
其他类别成功或 empty、某类失败时为 partial_success；全失败为 error；全成功但无候选为 empty。空策略不定位、不请求。
每查询 10 秒应用超时；筛选变化、关闭面板或卸载终止当前批次，忽略迟到结果，下一类别不会继续启动。不会使用 Mock 补失败类别。
真正的 provider timeout/partial failure 本次未人为制造，已用自动测试验证控制流。

## 6. 当前数据流与文件

Planner 当前表单 → parseUserIntent → A2 buildSearchPolicy → App → DiscoveryPanel → discovery → LocalSearch → poiAdapter → MapPOI → 去重/限额 → CandidateDiscoveryResult → 开发面板。
从 B2 面板发起操作不会调用 Direction 或 Place Detail。旧单公园 REAL 探测入口保持独立，真实验证期间其路线/详情均停在 idle，未开启 B3 或最终推荐。

新增：src/contracts/discovery.ts；src/map/searchMapping.ts、discovery.ts、localSearchDiscovery.ts、DiscoveryPanel.tsx；discovery.test.ts、localSearchDiscovery.test.ts；本报告。
修改：src/App.tsx、src/Planner.tsx、src/map/BaiduMap.tsx、src/map/poiAdapter.ts、poiAdapter.test.ts；docs/CONTRACTS.md、docs/CONTRACT_INTEGRATION_V0.1.md、README.md。
A2 三个源码/测试文件、recommendation 核心、MapPOI/RouteResult、server 均未修改。

## 7. 验证状态

VERIFIED：
- A2 交付校验、独立分支提交并推送；A2 原有 21 项测试继续通过。
- typecheck；8 测试文件共 81 项，含原有时间/路线/REAL/MOCK 测试。
- pnpm build、独立 pnpm verify:bundle、git diff --check 通过；新增未跟踪文件另做 no-index whitespace check，无错误。客户端产物不含服务端 AK 配置或值。
- 五类别真实 LocalSearch、名称人工检查、字段存在性、10 个候选池、分类高亮清理、同一公开区域复验。
- 自动测试：合法映射/未知类别、优先级顺序与配额、同标识去重/多类别来源、可选字段、部分失败/空结果、超时/取消/迟到回调、查询间隔、原始数据与路线调用边界。

NOT VERIFIED / LIMITS：
- 新 B2 定位入口在用户当前位置的完整实测；此次使用公开测试区域。
- 跨城市、跨区域和长期查询稳定性；关键词不能保证严格的类别精度。
- 真实样本中的跨 query 重复（本次为 0）、真实 provider error/timeout/partial success；相关语义由测试覆盖。
- Console：浏览器记录到 10 条 error、0 条 warning；详情读取被自动审批拒绝，以避免潜在会话/凭证暴露。未定位来源，不能声称控制台干净或判定其由 B2 引入。
- 营业时间、消费、安静、座位、拥挤、室内、可进入性均未验证。发现元数据为 DERIVED 搜索记录，不是新的地点属性。
- 没有进行批量路线或时间可行性验证，B2 的候选不等于推荐。

REAL：成功真实搜索经适配的地点身份/名称/坐标；OPTIONAL：地址、provider 分类；DERIVED：发现类别、优先级、去重/配额；UNKNOWN：其余未获证据的业务属性。不新增 INFERENCE。

## 8. 给 A 与下一步

B 已直接消费 A2 canonical SearchPolicy。无需改 A 语义；DiscoveryRequest 的 center 由地图侧提供。新增 discovery contract 可供 A 读取，但本阶段不将 pool 喂入 engine。
下一阶段最小建议：先人工审阅五类语义噪声与候选池，再确定 B3 的有限候选路线预算。本阶段不执行 B3。
