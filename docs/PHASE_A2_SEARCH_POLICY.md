# Phase A2 — Search Policy v0.1

## 1. 基线与结构

从主仓库全新 clone，基准 `944863d489d08fbcae8cdb2df611bf588f7cb40c`（Integrate real map data with the recommendation planner）。旧 UI 工作副本没有 Git 且缺失新 Contract，因此没有在旧副本上修改。本次没有合入独立的手账 UI 变更。

已阅读 project-core、intelligence、CONTRACTS v0.5、Contract Integration v0.1、Phase 1C 验证记录、Planner、共享地图 Contract 和 recommendation 实现。

`buildSearchPolicy(UserIntent): SearchPolicy` 为独立纯函数，不接入现有地图调用。唯一类型来源 `src/contracts/search.ts`：version、availableMinutes、entries；Entry 为 category、priority、reason。版本表示 A 线 proposal 版本，不代表 B 已完成集成。

## 2. 五类 Product Search Category

bookstore（书店/文艺小逛）、mall（商场/购物中心）、cafe（咖啡厅）、dessert（甜品/烘焙）、park（公园/绿地）。这些仅描述搜索方向，不保证找到座位、小食、饮品或其他设施。

## 3. UserIntent → Search Policy 规则

优先级顺序为：显式 button/form 活动 > 简单原文正向词规则 > 现有 text-rule activity > 默认。
显式 rest/walk/explore 对应休息/步行/浏览。默认解析出的 explore 不视为显式浏览。

| 需求 | bookstore | mall | cafe | dessert | park |
| --- | --- | --- | --- | --- | --- |
| 默认/随心 | high | high | high | high | medium |
| 随便逛逛/看点东西 | high | high | medium | medium | low |
| 歇一会儿/坐一下 | medium | high | high | high | low |
| 散步/透气/户外 | low | low | low | low | high |
| 吃点甜的/喝点东西 | low | high | high | high | low |

没有新增 LLM 或 AI parser。为兼容现有三类 activity，search 层用有限词规则识别原文中的浏览/饮品方向，不修改旧解析器和推荐行为。混合正向原文固定优先顺序：饮品甜点 > 休息 > 步行 > 浏览；这不是完整语义理解。

否定分句保守跳过，未识别文本按现有来源信息回退。支持逗号、句号、分号、换行及“但/但是/不过”分句；同一分句含否定和肯定时可能漏识别，因此不声称理解所有补充要求。

仅删除 excludedKinds 明确排除的产品类别；兼容 A 侧 book → bookstore 别名。lib 不等于 bookstore，garden 不等于整个 park，不做扩大排除。所有五类均排除时返回空 entries。

avoidCost、nearby、returnMode 不在这里推导地点事实或半径，继续由下游 hard constraints 验证。不能因为不花钱就断言公园免费或排除所有咖啡馆。

## 4. 默认 30 分钟策略与时间

30 分钟按默认行四高一中。同级无隐含排名，固定枚举顺序仅为稳定输出。
默认需求且 5–15 分钟：mall 降为 medium、park 为 low，其余 high；16–44 分钟保持默认；45–180 分钟 park 提为 high。明确需求优先，不被时间规则覆盖。
这是可修改的产品发现规则，不是地理或路线判断。输入分钟沿用 Planner 的 5–180 整数边界；无效输入抛 RangeError。

## 5. relaxed / balanced / explore

当前代码实际 ID 是 easy / balanced / explore（并非 relaxed）。三者均保留在 engine 推荐层，本阶段未修改排序、候选形成、停留或时间语义。搜索优先级不传入 recommendation score。

## 6. A/B 边界与实际数据流

本次完成：`UserIntent → buildSearchPolicy → SearchPolicy`（可调用、已测试，待 B 消费）。
现有运行链：`UserInput → UserIntent → 已有 Mock/REAL CandidateData → hard constraints → CandidatePlan → 三策略 → Planner`，保持不变。
后续目标：在候选发现前交给 B 搜索；B 负责 provider 映射，结果仍通过 MapPOI 和有向 RouteResult 返回。不修改 src/map、server、MapPOI、RouteResult、Planner。

## 7. 修改文件

- 新增 src/contracts/search.ts：唯一搜索类型。
- 新增 src/recommendation/searchPolicy.ts：确定性发现策略。
- 新增 src/recommendation/searchPolicy.test.ts：21 项测试。
- 更新 docs/CONTRACTS.md：追加提案，不改变现有地图事实 Contract。
- 新增本报告。

## 8. Tests

- pnpm typecheck：通过。
- pnpm test：默认配置加载遇到 Windows 沙箱祖先目录 Access denied，尚未执行测试就退出。
- pnpm test --configLoader native：6 个文件、61 项通过，含新增 21 项、原推荐核心 18 项，以及地图 Adapter/服务端既有测试。
- pnpm build：相同配置加载权限问题而失败。
- pnpm build:client --configLoader native：通过；pnpm build:server：通过；pnpm verify:bundle：通过。覆盖原 build 的三个步骤，未修改工程脚本。
- git diff --check：通过（另对未跟踪新增文件检查行尾空格）。

新增覆盖默认五类、浏览、休息、户外、饮品、显式输入优先、否定句、类别排除、时间段、稳定输出、不修改输入、无 POI/伪事实、无 provider runtime 依赖、高搜索优先级无法绕过超时约束，以及 open_ended 不产生返程步骤。

## 9. VERIFIED / NOT VERIFIED

VERIFIED：上述纯函数、既有 Mock 与 REAL 相关自动测试、类型和构建产物；现有地图/推荐核心实现未改变。
NOT VERIFIED：本阶段没有重新实调百度、没有重新进行浏览器 REAL 闭环验收、没有五类别真实搜索验证；本机原样 pnpm test/build 仍受配置加载权限影响。
REAL 现网证据继续引用现有 Integration/Phase 1C 文档，不能把历史记录称作本阶段实测。

## 10. CONTRACT_PROPOSAL 给 B

请确认消费 src/contracts/search.ts 的类型。A 提供五类别、离散优先级、解释和用户预算。B 决定经验证的 provider 查询映射、同级请求调度/额度、失败处理、去重及类别来源；不以搜索类别填充 free/quiet/indoor 等事实。空 entries 应停止发现而不是扩大搜索。
当前未制定 SearchRequest 的位置/半径/批量字段，避免提前决定 B 的实现。提案确认后再做 integration。

## 11. 下一阶段建议

A/B 先共同确认 SearchPolicy 消费接口，再由 B 独立验证类别映射；本阶段停止，不启动多类别真实搜索或路线评估。未 commit / push。
