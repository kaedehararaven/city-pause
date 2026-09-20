# 城市暂停键 Contract · v0.2

Phase 0 已建立 `src/` 前端、`server/` 后端、基础测试和 `package.json`，尚未建立地图或推荐领域类型。在 canonical TypeScript 类型出现前，本文件是 A/B 共享语义的唯一来源；建立代码类型后，在此记录其唯一路径并以该定义为准，不平行维护第二套字段。字段和状态仅依据双方确认、百度官方文档及真实接口测试结果更新。

## 边界与状态

`UserInput → UserIntent → MapSearchRequest → MapPOI[] → CandidatePlan[] → Recommendation[] → 地图展示 / AI 解释`

`RouteResult` 是地图侧提供路线与步行事实的独立结果，供 CandidatePlan 可行性判断和最终展示使用。地图 API 原始响应只能进入地图 Adapter/Service，不能渗入推荐与 UI。真实服务与 Mock 服务必须遵守同一业务 Contract，Demo 输出须显式标明 Mock 来源。

| 概念 | 负责人 | 当前约定 |
| --- | --- | --- |
| `UserIntent` | A 线 | 从用户输入解析时间、活动、偏好、是否返回等；具体字段未定。 |
| `MapSearchRequest` | A/B 共同确认 | 业务侧给地图侧的检索需求；类别、范围和坐标字段待实现时确定。 |
| `MapPOI` | B 线 | 地图候选地点；真实字段仅收纳百度环境已验证可提供的值。 |
| `RouteResult` | B 线 | 已验证路线、步行时间及距离等；不可用时保持 unknown 或明确错误状态。 |
| `CandidatePlan` | A 线 | 使用真实/明确 Mock 的地点与路段数据组成候选，并计算时间可行性。 |
| `Recommendation` | A 线 | 只从可行候选排序；解释只能引用已确认事实或标明的派生量。 |

## 字段来源

| 分类 | 含义与处理 |
| --- | --- |
| `confirmed` | 已根据官方文档并通过真实接口测试确认的地图事实；当前 JSAPI `LocalResultPoi` 已确认 `uid`、`title`、`point`，但正式 `MapPOI` 尚未定型。 |
| `optional` | 能力可能给出但可缺失；只有实测后才列入真实 Contract。 |
| `derived` | 基于已知输入及可靠地图事实确定性计算，例如剩余停留时间。 |
| `mock-only` | Demo 数据；须携带清晰来源标识，不能冒充真实 POI 或路线。 |
| `forbidden-inference` | 从名称、类别或 LLM 猜测出的地图属性，例如“书店一定安静”。不得作为事实。 |

全项目保持 `unknown ≠ false`、`unknown ≠ no`：未返回的字段用 `undefined`、`null` 或届时统一约定的 unknown 表达，算法须处理未知值。不要为了凑齐字段推测评分、价格、营业信息、室内环境或设施状态。

## 当前能力状态

**CONFIRMED：** 浏览器端和服务端 AK 已由用户准备，所需地图服务已开通；两名开发者均在 Codex 主工程中协作。浏览器端已通过官方 JSAPI Loader 加载 JSAPI 4.0，并以 BD-09 坐标初始化开发阶段默认中心；真实浏览器中已验证地图显示、拖动、缩放、刷新重新初始化，以及 Browser AK 缺失时的错误状态。Phase 1B 已真实验证一次成功定位、当前位置 Marker、以定位点为中心的 1500 米“公园” `LocalSearch`，以及权限拒绝和超时失败状态。`LocalResultPoi` 的 `uid`、`title`、`point` 同时有官方定义与真实返回证据；详细记录见 `docs/PHASE_1B_VALIDATION.md`。

**UNVERIFIED：** POI 详情的跨地点稳定性、步行时间/距离、路线、非 BD-09 坐标转换、定位服务不可用/浏览器不支持分支、配额及缓存策略。B 线在 Codex 中按小粒度实现，并以官方文档和真实请求验证。

## 密钥边界

浏览器端地图能力使用浏览器端 AK。需要 WebAPI 的地图事实必须由项目服务端代理调用；`SERVER_AK` 只从服务端运行环境读取，绝不能进入 Git、客户端源码、公开环境变量、API 响应或客户端 bundle。不得再次向用户索取或在输出中复述该密钥。日志和错误信息不得包含完整百度请求 URL或 `ak` 参数。

## 变更约定

新增地图字段前，记录其来源、缺失表现和真实接口验证证据；若能力缺失，调整 Contract 或方案。类型创建后此文档引用代码中的 canonical type，不平行维护字段清单。跨模块接口变更由 A/B 同步并做现有的相关检查。
