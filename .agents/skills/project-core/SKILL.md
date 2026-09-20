---
name: project-core
description: 城市暂停键项目的共享产品边界、数据流与工程协作规则；处理本仓库的功能、接口或集成任务时使用。
---

# 项目核心 · v0.2

面向当前位置有约 10–90 分钟碎片时间的用户，结合时间与即时需求给出少量现在可执行的城市微休闲方案，而非大量附近 POI。

核心数据流：`UserInput → UserIntent → MapSearchRequest → MapPOI[] → CandidatePlan[] → Recommendation[] → 地图展示 / AI 解释`。当前仓库尚无代码类型；以 [Contract](../../../docs/CONTRACTS.md) 记录语义，未来以实际 TypeScript 定义为准，避免文档与代码两套类型。

- AI 理解用户并依据已验证结果解释；地图提供真实世界事实；确定性推荐逻辑判断可行性并排序。保持三层边界。
- POI、坐标、地址、路线、步行距离与时间、营业信息及设施属性不能由 LLM 编造。真实模式只使用百度地图 API 实际返回并经 Adapter 按 Contract 接入的数据；Demo 模式明确标为 Mock。
- 两名开发者均在 Codex 主工程中协作，两线可依据共享 Contract 并行开发。A 线使用 `$intelligence`，主要负责意图、约束、时间预算、候选、排序和解释；B 线使用 `$baidu-map-integration`，主要负责地图能力、地图侧 Contract、Adapter 与真实接口验证。
- 浏览器端 AK 只用于浏览器地图能力。`SERVER_AK` 只能存在于服务端运行环境，绝不能进入 Git、客户端源码、客户端环境变量或客户端 bundle；不要再次向用户索取或在输出中复述密钥。
- 当前 MVP 不主动加入用户系统、社交、众包、长椅或大型地点数据库、实时座位、全天/多日攻略、复杂 Agent 或 TSP 路线优化。
- 先读现有实现，再小步修改；避免无关重构。重要修改后运行仓库实际存在的相关 TypeScript、测试、build、lint 命令。跨模块问题先核查 Contract。
- 共享 Contract 是两线的模块交界。联调或修复允许必要的跨模块修改，但须说明原因并保持最小范围；不得为了本线开发方便单方面改变另一线依赖的 Contract 语义。
- 角色 Skill 可以提出 Core 变更建议；产品定位、MVP、核心数据流、职责或地图事实原则的变更需先交人确认。
