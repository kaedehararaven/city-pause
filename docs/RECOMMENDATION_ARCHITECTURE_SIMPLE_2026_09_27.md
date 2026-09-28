# Recommendation Architecture · Simple v0.1

本轮把推荐决策收敛为：

`UserIntent → Basic Candidate Supply → Travel Gate → Hard Feasibility → Recommendation Factors → Lightweight Pareto → Recommendation Ordering → 推荐列表`

## 已删除的决策机制

- SearchPolicy 不再按 goal、活动、时长改变类别优先级。
- route shortlist 不再使用 goal-aware coverage、Primary/Fallback、near/expanded slot 竞争或 6/10/12/14 route quota。
- 每个候选只形成一个单地点计划，不再生成 Easy、Balanced、Explore 三种策略，也不强制地点或类别多样化。
- Pareto 不再负责选出策略赢家；它只清理已知维度上明确全面劣势的候选。

仍保留的 400ms 串行请求间隔属于百度服务并发与配额保护，不参与候选质量判断。`DiscoverySnapshot` 的 near/expanded 仅描述搜索技术范围；路线阶段消费全部去重候选。

## Candidate Supply

正式链路已切换为 Goal-driven Candidate Supply v3。它从当前 Goal 读取 v3 的 S/M/W 规则，S 的全部搜索词合并为一次 LocalSearch；只有 S 的有效候选少于 12 个时，才用 M 的全部搜索词再执行一次。固定七类不再限制正式候选来源，W 永远不主动搜索，只接收宽召回自然返回且经 `classified_poi_tag` 白名单验证的地点。

搜索词只负责宽召回。正式候选必须经过 Place Detail 返回的 `classified_poi_tag` 路径验证、父路径继承、去重和导航型子地点过滤；详情中具有独立活动意义的子地点按自身分类单独验证。Candidate Pool 现在只是本次 S/M 召回和验证结果的开发审计视图。

## Travel Gate 与 Hard Feasibility

理想交通参考线为开放结束 `T×60/4`，返回起点 `T×60/3`。实际最大允许值为参考线的 120%；只有超过最大值才过滤。硬约束继续过滤总时间、路线成功与端点一致、明确类别排除、显式步行 MUST 和独立返程路线。openingHours 明确表示关闭时过滤；UNKNOWN 保留。费用 UNKNOWN 保留，不冒充免费。

## Factors、Pareto 与排序

当前保留 Goal Match、Mobility、Rating、Price 四个产品因素。Goal Match 的 STRONG/MEDIUM/WEAK 来源尚未由产品提供可靠映射，因此当前记录为 UNKNOWN，不使用旧类别权重替代；这是 `NOT YET RESOLVED`。

Pareto 只在已知维度都可比较、另一个候选全部不差且至少一项更好时淘汰当前候选。UNKNOWN 不制造优势，也不因为信息缺失删除候选。

默认排序遵循 Goal Match、Mobility、Rating、Price 的顺序。由于 Goal Match 当前全为 UNKNOWN，实际先比较 Mobility：相差至少 20% 时较短者优先；否则比较 Rating。双方 rating 都大于 4.5 时跳过 Rating 比较 Price。Price 两边已知时较低者优先；一边已知时已知者优先；其余按稳定 provider id 排序。距离、评分、价格切换只在当前结果列表上重排，不重新搜索、路线或过滤。

UI 默认展示前六个候选；业务数据仍保留完整可行列表。展示中的地点详情、品牌、价格、评分、营业信息、电话、子地点、出入口与来源标记继续来自 MapPOI/Place Detail，未提供的字段保持 UNKNOWN。

## 当前边界

- Goal Match 等级仍 `NOT YET RESOLVED`，需要产品确认可验证来源。
- 百度“文化艺术”和“零售生活方式”是搜索词，不保证返回地点的 provider 分类等于产品大类。
- 当前交通秒数仍是百度路线事实，不能保证等于用户现场实走时间。
- 旧 CandidateFunnel 中的 `parkOutcome`、`deliveredPrimary` 等字段暂作开发审计兼容字段，不进入推荐计算；后续可在审计 Contract 单独清理。
