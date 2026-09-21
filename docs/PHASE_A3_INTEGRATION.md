# A3 算法与真实地图链路整合

日期：2026-09-21。

## 交付与基线

A3 包基于 B2 cd1788c，与接手时干净工作区一致。7 个交付文件的 SHA256 全部匹配 A3-MANIFEST，4 个被替换文件的基线校验全部匹配（统一 LF 换行）。没有覆盖其他工程、重建仓库或改 main。原 A3 交付独立提交为 8e08602，位于 codex/a3-algorithm。

## 完整数据流

用户需求 → A SearchPolicy → B 五类 LocalSearch → DiscoveredCandidate[] → B 最多 6 个跨层候选的真实有向路线 → A Real Provider → Hard Constraints → Preference / Utility Score → Quality Gate → Diversity Reranking → 最多三个 REAL 方案 → 现有 Planner。

prepareRealPlan 的两处 Provider 调用改传 discoveredCandidates: places；POI 由 A3 Provider 提取，发现元数据单独保存。免费等未知约束提前返回也保留元数据，不为注定不可行的候选浪费路线请求。

不修改 A3 权重、SearchPolicy 规则、B 采样额度或 UI；MapPOI/RouteResult 核心不变。搜索类别不冒充 Provider 分类，不推断座位、免费或开放。默认仅去程，显式返程才获取反向路线；不新增多站路线。真实失败无 Mock 回退。

## 算法行为

A3 按偏好、边际递减活动收益和移动负担评分；先 hard constraints，再质量门槛及多样性重排。类别信号来自 matchedSearchCategories，discoveryPriority 不进评分。原 UI 直接消费兼容 Recommendation，scoreTrace 留作解释与验收元数据。

Top 3 是上限。即使发现池含五类，walking 也可能只输出通过质量门槛的公园，这与 B 阶段提前丢弃其他类别不同；不能为展示类别差异跳过质量门槛。当前权重是 A3 政策，不声称已调优。

## 自动验证

pnpm typecheck、pnpm test（10 文件/108 项）、pnpm build、pnpm verify:bundle、git diff --check 通过；.env.local 仍被 Git 忽略。

新增 prepareRealPlan 集成回归使用合成 fixture（不冒充实地结果）：五类元数据经真实 Contract 路线接口进入 Provider，scoreTrace.categorySource 为 discovery；默认同条件能得到三个不同类别；walking 经评分和质量门槛选出公园，同时验证五类确实进入评分前数据。默认只请求去程，不污染 MapPOI.categories；免费约束提前返回仍保留 metadata。

## 浏览器验证与限制

本轮公开测试起点真实 LocalSearch 已取得 10 个候选，五类各 2 个。五类总匹配分别为书店 16、商场 13、咖啡厅 77、甜品店 54、公园 5；每类检查/有效均 5/5。未使用用户定位。

用户进一步授权本轮公开区域最多 8 次去程路线验证，不定位、不查返程。原标签被同时操作并切换起点后，停止使用该标签；另建独立本地标签，重新确认 REAL、30 分钟、随心安排、公开测试起点及 10 个候选后点击生成。

独立标签实际完成一个批次（应用层上限 6 次去程，不含返程或站间请求），现有 UI 显示两个 REAL 方案：

| 结果 | 步行 | 停留 | 缓冲 | 总计 |
| --- | ---: | ---: | ---: | ---: |
| 中山公园 | 7 | 20 | 3 | 30 |
| 王府井书店(东华门大街店) | 17 | 10 | 3 | 30 |

页面显示 A3 的偏好/活动/移动负担及质量门槛说明、公开测试起点、REAL 标记，无返程 step。真实发现 → 真实路线 → 已接线 A3 → 既有 UI 已验证。未输出内部 scoreTrace，也未逐项导出被过滤候选的路线状态，因此不把所有落选原因都归于质量门槛。

本轮未再执行休息/散步真实生成，避免失败路线重试造成超出授权请求预算；两者的偏好及多样性由自动测试覆盖，不称为本轮实地验收。未强行凑满三项。

未验证：真实 no_route/timeout、跨区域长期质量、用户当前位置、权重的实际用户效果。未读取控制台日志，不声称控制台无错误。

## 修改范围

A3 交付：recommendation 下 engine/model/realProvider/searchPolicy、utility 及其测试，docs/PHASE_A3_ALGORITHM.md。

整合：src/map/prepareRealPlan.ts、prepareRealPlan.test.ts、docs/CONTRACTS.md、本报告。App、Planner、CSS 与地图查询/服务端实现均保持现有代码。
