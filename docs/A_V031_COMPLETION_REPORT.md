# A_V031_COMPLETION_REPORT

日期：2026-09-22。针对 Recommendation v0.3 的 Activity 重复作用与静默 goal fallback 修正；在原目录完成，保留已有 B3/客户端修复及全部未提交成果。没有 commit/push。本报告覆盖 v0.3 报告中的活动收益曲线、reasonable pool 对 UNKNOWN 的处理及弱匹配降级语义。

1. **根因审计**：REAL 候选的 flexible stay 把剩余预算分给活动；Activity 和 Mobility 同时受路线时长驱动。严格 Pareto 之后，三策略经常只能选择同一个候选，去重再合并成一张。策略池无 primary 时静默用弱匹配，以及有 primary 时仍允许未知 goal match 参加正常策略，也是误导来源。B 的采样/配额另有供给限制，本轮不处理。

2. **旧 Activity**：`0.7*clamp(stay,0,15)/15 + 0.3*clamp(stay-15,0,20)/20`；35 分钟封顶。这是 A 政策，不是实测体验。

3. **旧 Mobility**：`clamp(totalTravelMinutes/availableMinutes,0,1)`，minimize，包含要求的返程及既有站间路段。保持不变。

4. **重复路径**：路线更短 → 移动比例更低；同时 `budget - travel - buffer` 更大 → 分配停留更久 → Activity 更高。旧曲线饱和前，“近”同时在两个维度严格占优。

5. **新 Activity 语义**：活动充分性。饱和点采用已经存在的每站 minimumStayMinutes；Hard Feasibility 已逐站保证最低停留，因此进入 Evidence 的方案该值为 1。没有额外“合理窗口”的产品证据，就不另外发明 10/15/20 分钟阈值或咖啡/公园专属时长。现有 REAL 默认最低 5 分钟仍是上游 A 政策，不是本轮新推断；若上游未来调整最低停留，本定义相应沿用。

6. **不再重复 Mobility**：通过硬检查后，5/15/20/60 分钟停留均已达到各自最低活动政策，不因省出时间多得分。保留实际 stay、minimum 政策、缓冲和剩余时间以解释可执行性。充分性不声称体验质量；不足时间仍在 Hard Feasibility 淘汰。

7. **是否修改 Pareto dimensions**：保留字段集合、方向、UNKNOWN 和 strict dominance 公式；仅修改 activityOpportunity 的语义与数值定义。

8. **精确变化**：activityOpportunity=maximize 的值由旧分段连续收益改为满足 minimum 的 1，否则 0；不可行的 0 不进入正常决策。其 evidence 明确 minimum 总门槛、实际安排、饱和依据以及“不代表实测体验”。作为常量，它在可行池中不提供严格优势。相同 Need、偏好且活动充分时，最近者仍可仅靠 Mobility 合法支配；不为远处候选造优势。

9. **flexible**：Need 保持统一为 1，无类别偏好。只有 Mobility 差异时允许三策略相同；Explore trace 明确没有足够共同已知收益支持替代，允许复用。有真实激活的费用等证据差异时，仍保留可比较 trade-off；类别不当质量。

10. **rest**：咖啡/甜品/商场 Need=1，书店=0.9，其他已知类别=0.35。前四种可为 primary；存在可行 primary 时弱匹配公园及 UNKNOWN 不进入正常策略。座位、安静、室内、免费均不推断。

11. **walk**：公园 Need=1，其余已知类别弱匹配。存在 feasible primary 公园时，不输出咖啡店为正常散步推荐。到达步行始终是负担，没有距离正奖励。缺少可行主匹配时只输出明确 degraded 备选。

12. **discover**：书店/商场为 primary；类别仅为需求信号。品牌、名称、远近不证明 novelty。缺 primary 时显式 fallback；novelty 偏好激活仍为 UNKNOWN。

13. **PRIMARY_MATCH**：flexible 的可行候选；或明确 goal 下已知 Need >=0.7。阈值继承 v0.3，不是新增总分 gate。rest 的书店 0.9 属于合理的次级 primary。

14. **FALLBACK_MATCH**：明确 goal 下弱匹配或需求证据未知的可行候选。UNKNOWN 仍为 null，只是无法确认 primary，不能称为确认不匹配。trace.degraded=true；即使有 primary，这些候选也留在审计中，但不参加正常策略选择。

15. **no-primary-match 行为**：输入地点没有 primary 信号 → NO_PRIMARY_MATCH_IN_INPUT_POOL；输入有 primary 地点但均失败/超时/超预算等 → NO_FEASIBLE_PRIMARY_MATCH。两者都不编造上游地点，允许明确降级的可执行备选。若连可行备选也没有则空推荐。字段 primaryMatchInInputPool 与 primaryMatchExists 分别说明输入与硬检查后状态。buildRecommendations 数组接口保留 trace，strategyReason 同时写明降级，因此旧卡片的现有解释文本也能展示；无需修改 UI。

16. **Easy**：先主匹配池（如有）和已知偏好相容性，再移动量、换站、充分性、不确定性、稳定 ID；不把 UNKNOWN 混作确认主匹配。低摩擦语义保留。

17. **Balanced**：共同已知维度的固定语义尺度 RMS 折中不变，未知维度统一排除，不补值。活动充分后不再有“省下的时间”造成的第二次偏向。lowWalking PREFER 仍增强移动优先政策，没有恢复全局加权分数。

18. **Explore**：额外移动仍需带来共同已知维度至少 0.1 的收益，并满足已有其他维度/移动容许规则；Activity 不再因额外剩余分钟制造收益。Need 或已知偏好可以带来收益，无收益可复用 Easy，绝不选最远凑数。

19. **UNKNOWN**：null、Evidence.UNKNOWN、blockedByUnknown 保留。双方都未知也不能完成 dominance。主匹配资格与属性事实区分：未知资格不叫 MISMATCH。已有费用、安静、室内、novelty 及元数据不推断测试保持。

20. **collapse diagnostic**：>=5 feasible 且 Pareto=1 时输出 PARETO_COLLAPSE_SINGLETON，含三阶段计数、唯一前沿 ID、对各被支配候选的 comparableDimensions 和 strictlyBetterDimensions；每个 candidate 的 pairwise trace 也新增严格优势列表。>=10 保留旧 B3 PARETO_COLLAPSE_OBSERVED 标识。只观测不改变结果。计数 input 为地点数、feasible/pareto 为方案数；现有多站输入时可能不同。

21. **G01**：固定五类 REAL-like 合成池，30min open_ended，无额外偏好/MUST，全部可行。flexible 无类别差别、Activity 全为 1；Easy 按低摩擦，允许策略复用并解释；无虚构属性。

22. **G02**：同池 rest 四类合理匹配、park 为弱匹配。即使 park 更近，也不作为正常 rest 首选；未知设施不推断。这里 relevance 的“提升”是相对弱匹配的区分增加，不是相对 flexible=1 再创造大于1的分值。

23. **G03**：同池 park 为 primary；额外的两公园对比只记录 Mobility 严格优势。无公园以及公园 no_route 分别测试两种降级原因，咖啡等只能作为明确 fallback。

24. **G04**：同池书店/商场为 primary；无主匹配明确降级。无可靠 novelty 信号时不增加 novelty 优势，仍保留既有不从品牌/名称/距离推断的测试。

25. **15/30/45/60 关系**：相同事实从15到30有更多路线满足现有通勤门禁；可行近处不消失；所有可行 Activity 均饱和。30/60 同事实无新增取舍时允许相同地点，不强迫换点。

26. **P01–P04**：P01 2/6分钟同 Need、充分活动仅 Mobility 严格不同；P02 稍远 primary 不被更近 weak 双重支配；P03 激活可靠费用证据形成真实 Mobility/Cost 取舍；P04 5可行→1前沿诊断逐个指出只有 Mobility 严格优势。输入地点/路线/发现元数据反序后完整结果相同；为此拒绝日志也稳定按 candidateId 排序。

27. **新增测试**：新增 revision031.test.ts 13 项（G01–G04共4、降级语义4、时间/P01–P04共5）。基线189项，现202项/17文件。都是 synthetic REAL-like fixtures，不是新增真实地图验证。

28. **旧测试 KEEP/UPDATE/REPLACE**：没有删除旧测试，数量仍189。受影响的7项逐项列于下表，其他182项保持原断言和文件实现；包含 B3 模式隔离、来源与硬门禁、严格 Pareto、walk 无到达奖励、多样性与 UNKNOWN。

| 文件 / 原测试 | 分类 | 处理及原因 |
| --- | --- | --- |
| utility.test.ts：gives diminishing activity benefits and caps them | REPLACE | 旧连续收益是本轮确认的问题；替换为按已声明最低活动政策饱和、额外分钟不加分。 |
| decision.test.ts：lowWalking PREFER increases mobility sensitivity without filtering the pool | UPDATE | 仍断言 normal/lowWalking 的 Balanced 差异；改用 rest 书店0.9与咖啡1的已知 Need 取舍，取消用停留时长制造收益。 |
| decision.test.ts：retains meaningful mobility/activity trade-offs | REPLACE | 改为 Mobility/Need 真实政策信号取舍；额外停留更长但同 Need 的第三候选不再被救回，并断言 Activity 一致。 |
| decision.test.ts：is deterministic under candidate, metadata and route permutations | UPDATE | 使用同一新 Need 取舍池与 rest goal；所有确定性断言保留。 |
| decision.test.ts：keeps non-park walking and bookstore rest candidates when no stronger supply exists | UPDATE | 保留能返回备选的断言；新增 walk 明确降级、rest 书店合理匹配不降级。 |
| decision.test.ts：Balanced chooses a compromise while Explore trades reasonable travel for meaningful activity | REPLACE | 使用较近书店与稍远咖啡的已知 Need 改善；Balanced/Explore 可不同于 Easy，但不再要求第三个更远且仅停留更久的点获胜。 |
| decision.test.ts：Balanced omits unknown dimensions on common support without substituting zeros | UPDATE | UNKNOWN 共同支持断言不变，取舍 fixture 改为 Need，不再依赖旧 Activity 曲线。 |

原 tradeoffData 共用 fixture 从三个不同停留长度的公园改为书店/咖啡/咖啡，移动2/5/7分钟；仍保留5/25/35的不同停留上限，正好证明这些额外分钟不再制造质量优势。decision.test.ts 其余44项、utility.test.ts其余3项均 KEEP，尤其保留 strict dominance、两类 unknown 阻止支配、Explore 无收益不远行、类别多样性只用于 near-tie、无效/被支配候选不救回等断言。

29. **本轮修改文件**：src/recommendation/utility.ts、utility.test.ts、evidence.ts、decision.ts、decisionTypes.ts、engine.ts、decision.test.ts；新增 src/recommendation/revision031.test.ts；更新 docs/CONTRACTS.md、新增本报告。已有未提交文件不代表本轮都改动。

30. **src/map/**：未修改，含既有测试；会话开始的内容摘要与完成时比对一致。

31. **server/**：未修改，内容摘要一致。

32. **SearchPolicy/B2**：未修改 searchPolicy.ts、发现/路线配额、envelope 或共享地图 Contract；没有新 API 请求。

33. **UI**：未修改 App.tsx、Planner.tsx 或地图 UI/CSS。现有 Planner 调用 buildRecommendations 已自然使用修订引擎；降级说明通过原 strategyReason 展示，不新增布局/设置。没有实际浏览器点击验收。

34. **typecheck**：pnpm typecheck 通过。

35. **tests**：pnpm test：17文件、202项全部通过。第一次迁移有4个旧曲线依赖断言失败，按第28项公开替换；新反序测试发现 rejected 顺序差异，修复稳定排序后通过，不绕过失败。

36. **build**：pnpm build 通过，包含前端和服务器构建。服务器只构建验证，源码没有修改。

37. **bundle security**：构建内检查及独立 pnpm verify:bundle 均通过。未打印密钥、未使用用户定位、未新增真实网络请求或安全规则豁免。

38. **diff check**：git diff --check 通过。另校验36个受保护文件（map/server/shared contracts/App/Planner/SearchPolicy）相对于本轮开始无变化；原工作区未回滚、未 commit/push。

39. **limitations**：minimumStay 只是当前 A 的可执行性政策，不是活动满意度的实证阈值；本版刻意不对超出最低活动的分钟声明体验收益。较多候选仍只有粗类别和路线，可靠取舍不足时合法 singleton 仍会出现。原 B 供给/查路线最多8个的限制未修。费用 MATCH 仅沿用现有窄证据规则，不证明所有活动免费；品牌/评级等未变为新质量维度。需要更丰富证据才能合理区分更多体验。

40. **VERIFIED**：G01–G04、P01–P04、时间关系、主匹配/未知/失败降级、完整202项回归、typecheck/build/bundle/diff；受保护B/UI文件不变；现有walking/cycling隔离回归仍通过。

41. **NOT VERIFIED**：本轮未用真实地点跑新的浏览器推荐，未验证用户现场最终名单会变化；不声称解决B候选不足、地图详情质量、导航或实地体验。没有新cycling实现、LLM或加权总分。

## REAL_WORLD_EXPECTATION

- **G1/G2 相同地点仍可能合理**：最近的候选恰好也是合理休息主匹配，且没有其他已知优势时，随心安排和休息可以同选。明确需求不保证每次不同。
- **三策略只剩一个地点仍可能合理**：可行池只有一个，或同Need/相容偏好/活动充分的候选中，一个仅靠更低Mobility合法支配其他点；也可能UNKNOWN阻止淘汰，但没有共同已知收益支持远行且无合适near-tie。此时复用并去重合并，不强凑三卡。
- **15–60分钟部分情况下相同地点仍可能合理**：同一候选持续可执行，增加预算没有带来更有意义的事实取舍；或者B尚未把更好匹配点和成功路线送入A。增加预算不是必须换点。
- **真正 regression**：存在可行且已知 primary 时仍把 weak/UNKNOWN 当正常推荐；无primary却缺失degraded/原因；两个已充分候选仅因剩余分钟不同又产生Activity严格优势；UNKNOWN变成数值或用于完成支配；Explore仅因远而选择；实际独立已知取舍被错误消除；反序改变前沿或推荐；失败路线/超预算混入；为三卡救回dominated；新增搜索优先级质量分。上述应按trace和输入事实定位，不能只看卡片数量判定。

STOP：等待人工审阅，不开始 B、cycling、导航或其他阶段。
