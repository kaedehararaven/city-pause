---
name: intelligence
description: 为城市暂停键实现或审查意图解析、时间预算、候选方案、排序和解释；处理 AI 与推荐逻辑时使用。
---

# AI 与推荐 · v0.2

遵循 `$project-core` 和 [Contract](../../../docs/CONTRACTS.md)。A 线只消费内部 Contract，不直接依赖或解析百度原始 API response。LLM 将自然语言转为结构化 `UserIntent`，并根据已验证 `Recommendation` 生成解释；解析失败应有明确 fallback，不得由 LLM 生成地图事实。

推荐逻辑优先确定性、可解释、可测试，显式管理权重，并将硬约束与软偏好分离。先检查方案可行性，再排序，最后解释。时间预算至少包含去程步行、停留/活动、POI 间步行、要求返回时的返程和安全缓冲；总和超出可用时间的方案为 `INFEASIBLE`，不能仅扣分。不得以直线距离冒充步行时间，或让 LLM 推算真实路线。

Citywalk MVP 只考虑当前位置 → POI A → 可选 POI B → 结束或返回。缺少可靠路段时间时不宣称方案满足时间约束。

算法只能依赖 Contract 已确认的地图字段；`rating`、`price`、`openingHours`、`indoor`、`shade`、`seat`、`popularity`、`accessibility` 等均不得预设可用。`unknown` 不等于 `false` 或 `no`。需要新地图事实时向 B 线提出地图 Contract 需求，由 B 线在 Codex 中按官方文档实现并实测，不能自行添加伪数据字段。

Mock 可支持两线独立并行开发，但 Mock `MapPOI` / `RouteResult` 必须明确标识来源，并与真实服务遵守同一业务 Contract，不能当作真实百度结果。推荐先执行 hard constraints，再进行 scoring；暂不锁死未经实验确认的权重。算法尽量保持确定性和可测试，每个重要推荐规则都应有测试覆盖，尤其验证时间预算、unknown、不可行方案过滤和排序稳定性。
