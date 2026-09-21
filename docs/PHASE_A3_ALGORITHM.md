# Phase A3 — Recommendation Algorithm v0.2

## 1. 原算法问题审计与基线

基线为 `origin/codex/b2-poi-discovery` 的 `cd1788c19e3f918e2abb71d35a60c47de3f3a9fd`。main 仍为 944863d，不含 B2；因此在独立 A3 工作副本中基于 B2 分支实现，没有合入或覆盖手账 UI 副本。

阅读 project-core、intelligence、CONTRACTS、B2 修订验证记录和推荐/准备实现后发现：

- prepareRealPlan 实际位于 src/map/，不是 src/recommendation/。B2 最新代码已修复 high 有结果就停止的问题，跨类别分轮保留最多 6 个路线候选；本阶段没有重复修改。
- prepareRealPlan 调用 createRealCandidateData 时仅传 pois，丢弃了发现类别元数据。这是实际仍存在的交接缺口。
- 旧 easy 几乎由移动最少支配；balanced 比较步行/停留差；explore 优先类别数，但 REAL kind 未知，无法有效利用发现类别。
- REAL flexible 分配会填满预算，活动时长不应直接线性等价于收益。
- 旧策略偶尔也能产生类别差异（例如 balanced 恰好选择步行/停留更接近的书店），不能宣称旧版所有案例都只返回同类。

## 2. 新 Pipeline

`DiscoveredCandidate[] + 已取得 RouteResult[] → Real Candidate Provider → CandidateData（事实与发现元数据分开） → 既有 hard constraints → Feasible CandidatePlan[] → Preference/Activity/Mobility components → 基础 Utility → Quality Gate → 三策略与多样性重排 → 最多 3 个 Recommendation`

现有时长分配、最低停留、路线失败、动态缓冲、同来源检查、open_ended / return_to_start 全部保留。不可行候选不会调用 scorePlan。没有新增路线调用或搜索能力。

重要：A 提供了完整可测试的发现输入入口；B 现有调用尚未传入元数据，因此当前页面运行时仍走兼容输入。基础 Utility 和 Quality Gate 已生效，但真实类别偏好/类别多样性需要下述传参提案接通后才生效。没有用 provider categories 或名称猜测补齐。

## 3. Preference Matching

复用 A2 的 profileFor，仅将其导出，未修改 SearchPolicy 行为。独立偏好规则不读取 discoveryPriority，也不把 SearchPolicy priority 直接当评分。

| Profile | 强匹配类别 |
| --- | --- |
| browsing | bookstore、mall |
| rest | cafe、dessert、mall |
| walking | park |
| refreshment | cafe、dessert、mall |
| default | 五类同等宽容 |

强匹配为 1，已知弱匹配为 0.35；类别未知为中性 0.5；default 为 0.7。多类别中有任一强匹配即可，不因重复标签叠加奖励。弱匹配不是 hard filter，但可能在后续质量比较中落后。

REAL 只使用按 provider + providerId 和坐标匹配的 discoveredCandidates 元数据；Mock 使用已标明为 MOCK 的内部 kind 别名规则。都不写入 MapPOI.categories，不生成 quiet/free/indoor 等事实。

## 4. Utility Score

三个可独立测试的 component 都归一化到 0–1：

`baseUtility = 40 × preference + 30 × activityBenefit − 20 × mobilityBurden`

40/30/20 是便于理解的 v0.2 产品政策，不是实验得到的最优权重。未使用 rating、价格、座位、景观等未知属性。discoveryPriority 完全不参与评分。

## 5. 活动时间边际递减

0–15 分钟累计取得 0.7 活动收益；15–35 分钟仅增加剩余 0.3；35 分钟后封顶。
5→15 分钟增加约 0.467，25→35 分钟增加 0.15。
沿用原有 flexible 停留分配以保持输出兼容，但不因为填满 60 或 90 分钟就无限增分。

## 6. Mobility Burden

`min(1, walkingMinutes / budgetMinutes)`，walkingMinutes 含需要时的返程和已有站间路线。
移动是成本，walking intent 的收益来自 park 发现类别偏好，不来自更长的路线。explore 仅减轻移动惩罚，最终移动系数仍为负。

## 7. Quality Gate

门槛为 `max(0, 当前最佳基础 Utility − 18)`。先按统一基础 Utility 过门槛，再重排；策略加分和多样性都不能救回未过门槛的方案。
允许 0、1、2 个结果；不承诺凑齐三张卡。18 是明确的首版容差，需要后续样本审阅，不声称经过调优。

## 8. Diversity Reranking

用类别集合的 Jaccard 重合率与 POI 身份集合重合率二者的较大值表示相似度；对已选方案的最大相似度乘 8 扣分。
相同 POI 组合（包括逆序同组合）不重复入选。不同咖啡馆可都入选；没有“一类一个”的硬限制。
`selectionScore = baseUtility + strategyAdjustment − 8 × maxSimilarity`。
同分先比较基础 Utility，再按稳定 ID 排序；不使用随机数。

## 9. 三策略兼容

实际 ID 是 easy / balanced / explore，保留原标签，不改 UI。

- easy：额外扣 8×移动比例和每个额外站点 8 分，保持轻松/少换站语义，但不硬禁两站。
- balanced：休息时稍强调活动收益（+4×activity）；非休息时已有两站方案 +8，保持原双站语义。
- explore：减少 4×移动比例的惩罚；已有两站且两个发现类别时 +8。总移动成本仍为 −16×比例。

所有策略共享同一 hard constraints 和质量门槛；不新增站间真实路线或伪造多站。生成的 strategyReason 使用符合新算法的概括说明，这是推荐内容变化，不是 UI 文案/组件修改。

## 10. Explainability metadata 与 Contract

CandidateData / RealCandidateInput 最小增加可选 discoveredCandidates，直接复用 B 的 canonical 类型。兼容原 poi/pois 调用；传元数据时校验 REAL、唯一身份、与 pois 的集合/坐标一致性、五类合法值，保留发现优先级但不用于 score。

Recommendation 增加可选 scoreTrace，既有 UI 字段均保留。trace 包含版本、hardConstraints: passed、categories、categorySource、三个原始 component、三个贡献、baseUtility、质量门槛、策略调整、多样性调整和最终 selectionScore。它们全部是规则/派生数据。

**CONTRACT_PROPOSAL：** B 的 prepareRealPlan 中两个 createRealCandidateData 调用，在现有 origin/pois/routes 基础上补传 `discoveredCandidates: places`。应由 B/integration 审阅后修改，A 本次没有修改 src/map。这个交接决定真实页面能否使用类别信号。不得把这些元数据塞进 MapPOI。

没有 UI_CONTRACT_PROPOSAL：现有 Recommendation 足以渲染，trace 无需显示。
exclusive category 当前不支持，本阶段不扩展自然语言语义。

## 11. 修改文件

- src/recommendation/model.ts：两个兼容可选字段。
- src/recommendation/realProvider.ts：消费/校验发现元数据，兼容旧输入。
- src/recommendation/searchPolicy.ts：仅导出已有 profileFor 函数供规则复用。
- src/recommendation/utility.ts：可测试的 component、质量门槛和重排。
- src/recommendation/engine.ts：保留 hard constraints，用新评分/重排替换旧排序，附 trace。
- src/recommendation/utility.test.ts：18 项新增测试。
- docs/PHASE_A3_ALGORITHM.md：本报告与传参提案。

## 12. Tests 与环境限制

原有 89 项测试未修改，新增 18 项；10 个文件共 **107 项通过**。另独立运行一次旧/新算法对照实验，结果保存为交付 JSON；对照用临时文件已移除，不算入 107 项。

新增覆盖：各偏好、同条件比较、较远但匹配优先、非匹配仍可行、移动成本、活动封顶、质量优先、多样性、同类供给、少于三项、输入反序稳定性、超时、缺失路线、默认不返程、元数据不等于事实、优先级不进入 score、贡献可核对、旧调用兼容和输入一致性校验。

环境：新安装在 npm 元数据网络校验中失败/挂起，未关闭供应链校验。A2 与 A3 package.json、pnpm-lock.yaml 的 SHA256 均相同，复用 A2 已验证安装的 node_modules（本地 junction，不打包）。

按要求尝试 pnpm typecheck / pnpm test / pnpm build，pnpm 依赖前置检查试图重建 junction，因无交互终端退出；不将原命令标为成功。直接运行相同已安装工具执行脚本实际工作：

```
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
node node_modules/vitest/vitest.mjs run --configLoader native
node node_modules/vite/bin/vite.js build --configLoader native
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node scripts/verify-client-bundle.mjs
git diff --check
```

以上检查通过。测试配置采用 native 加载，避免本机 esbuild 祖先目录访问问题。没有修改 package、lockfile 或 pnpm 安全设置。

## 13. 典型案例对照（合成 fixture，非实地数据）

30 分钟预算，使用同一组地点/路线分别执行基线 engine 与新 engine：

| 场景 | 旧结果 | 新结果 |
| --- | --- | --- |
| walking：咖啡步行2分钟、公园6分钟 | 咖啡、公园 | 公园；咖啡在软评分后未达质量门槛 |
| default：咖啡3/4/5分钟、书店6分钟 | 咖啡A、书店、咖啡B | 同样结果，但新增明确类别重排与 trace |
| rest：咖啡3/4/5分钟、书店21分钟 | 三家咖啡 | 三家咖啡，不为类别差异引入差方案 |

另有独立受控 scoring 测试：Cafe 90/89/88 + Bookstore 87 → 90咖啡、87书店、89咖啡；Bookstore 改40 → 三家咖啡。这些是用于验证重排的测试分数，不是实际模型量纲或真实样本。

## 14. VERIFIED / NOT VERIFIED

VERIFIED：107项自动测试、类型检查、前后端构建、前端 bundle 密钥边界、工作树范围与空白检查；元数据从 Provider 到 scoreTrace 的自动测试；原 UI/B 文件字节保持一致。
NOT VERIFIED：真实 API/浏览器端实时效果未重测；B 当前 metadata 传参尚未接通；权重与门槛未做真实用户效果评估。不能把合成 REAL 类型 fixture 当成真实地图验证。

## 15. UI 是否修改

没有。Planner.tsx、App.tsx、所有 CSS、HTML 和其他 UI 文件与基线保持一致。未部署本次 A3 到已有 UI 演示服务或导出的单文件 HTML；视觉与交互源代码保持原样，未声称重新完成浏览器视觉验收。

## 16. B 线是否修改

没有。src/map/**、server/**、所有 src/contracts/** 与基线保持一致。未调用百度 API，未改变采样额度、query mapping 或事实语义。

## 17. 下一阶段

人工审阅评分案例和 metadata 传参提案；由 B/integration 接通该唯一缺口后，再用小批真实候选评审输出。当前不 commit、不 push，不继续扩展或改 UI。
