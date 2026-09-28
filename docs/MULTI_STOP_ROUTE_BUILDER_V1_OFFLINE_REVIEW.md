# Multi-stop Route Builder V1：产品规则合并与离线验证

后续状态：产品已批准实现及最弱Goal等级优先，现已接入。本文保留设计推导，实际代码与实验配置以[接入记录](MULTI_STOP_ROUTE_BUILDER_V1_IMPLEMENTATION.md)为准。

日期：2026-09-28。状态：正式接入前设计；已确定政策与待决建议严格分开。

本轮未修改src/server/package配置、单地点测试、真实Demo数据；没有调用百度或任何其他网络服务，没有commit/push。新增的可执行文件只位于docs/fixtures，使用纯手工合成数据及内存edge oracle，不接正式链路。

## 0. 确定规则、替换项及结论

确定：30仅单地点；45/60最多2站；90~180休息最多2站、散步/探索最多3站；Multi-stop至少2站、单程；原buffer及通勤规则保留；同Family绝不共存；dwell使用完整[min,max]同比例舒展；两站与三站共同竞争、不奖励站数；MST/chain只作软信号；Anchor仅在免费预检证明无两站可能时允许回退一次到排名第2的可用候选。

上一轮中点目标dwell、120°折返、优先用三站替代两站、API失败后试次Anchor的建议全部作废。本文不重开以上确定规则。

算法总体自洽，但需处理退化定义及两处待决政策：G的0/0；“第三站不能明显折返”与“Geometry无硬门槛”的关系；路线排序如何保持既有20%Mobility语义同时避免循环。具体反例和最小建议见第13、14节。

## 1. 完整Pipeline与输入边界

`existing ranked single-place candidates（当前Goal的默认排序全量结果）`
→ 时间/模式检查
→ 只读RouteCandidate视图，附加Family和dwell
→ Anchor #1完整免费预检
→ 若证明确实无潜在两站，Anchor #2完整免费预检
→ 锁定唯一进入付费阶段的Anchor
→ Family/最低时间检查 + 缓存读 + 几何提案排序
→ 有界验证两站，保留全部合法两站草案
→ 若maxStops=3，对有限两站草案提出第三站
→ 验证新增边，重算整条路线dwell，保留两站与三站
→ 共同路线排序
→ 去重，最多3条Multi-stop；原单地点结果保持不变。

输入使用默认单地点排名，不读取UI主动价格排序当作新Anchor排名，不只取显示前6。Goal/起点/候选/边必须来自一致snapshot。30分钟直接NOT_APPLICABLE，零新增路线调用。

不扩大v3召回、不因Family不足强制M、不把已被单地点拒绝的地点重新拉入；Geometry/top-k只影响Multi-stop探索队列。可用候选先作身份、来源、Family映射等静态有效性检查，不得通过逐个删除“没伙伴的Anchor”绕过最多2名的限制。dwell不合适属于免费预检失败，不是无限跳过排名的理由。

当前单地点仍可能勾选return_to_start。建议V1只对明确open_ended输入运行；返程仍由单地点处理，不能静默忽略返程需求。此UI入口口径待产品确认，Builder本身绝不查返程边。

## 2. Family与Dwell映射

当前v3文件与代码覆盖24条真实祖先路径，均可映射以下11个Family。按最长已确认祖先路径继承，不做字符串标题推断、NLP或AI推断。Family只作为Builder元数据，不写入MapPOI来源字段，不改变单地点minimumStayMinutes。

|Family|min/max（分钟）|真实v3路径|
|---|---|---|
|休憩饮食|30/60|美食 > 咖啡厅；休闲娱乐 > 茶馆；美食 > 甜品店；美食 > 饮品店；美食 > 糕点烘焙|
|书咖|30/60|休闲娱乐 > 书咖|
|猫咖|60/120|休闲娱乐 > 猫咖|
|绿色漫游|30/60|旅游景点 > 公园；旅游景点 > 植物园|
|文化观展|40/90|旅游景点 > 美术馆；旅游景点 > 博物馆；文化传媒 > 艺术馆；文化传媒 > 展览馆|
|商业漫游|25/50|购物 > 商业街；休闲娱乐 > 休闲广场|
|购物中心|40/90|购物 > 购物中心|
|兴趣零售|15/40|购物 > 商铺 > 书店；购物 > 商铺 > 动漫店|
|日常零售|15/40|购物 > 商铺 > 副食品店 > 零食店；购物 > 超市；购物 > 便利店|
|体验探索|40/90|休闲娱乐 > 游乐游艺 > 新奇体验馆；休闲娱乐 > 手工制作|
|人文漫游|50/90|旅游景点 > 人文景观 > 古村古镇|

没有需新造的路径。特别注意茶馆属于休闲娱乐，零食店还有副食品店父层，书咖不是书店。兴趣零售/日常零售/绿色漫游只是多地点Family名称，不是新的百度tag。

对B、C提案及最终路线都检查Family集合大小=stopCount。相同父地点中的独立不同Family商户仍按自身标签处理；不额外发明父子地点禁配。UNKNOWN Family不参与Multi-stop但不影响原单地点输出。

## 3. Anchor #1/#2免费预检

先对全部候选扫描，再top-k。不能因为前6个与Anchor同Family，就说所有组合不存在。

对Anchor a、候选b，不同ID与Family，分类/原有硬条件均有效，设m为两站min之和，t0为缓存中确定的O→a秒数（缺失时只作0这个乐观下界），t1为同向同端点有效缓存a→b秒数（缺失同样只作0下界）：

`potential(a,b) := (t0+t1)/60 + m + buffer(T) <= T AND (t0+t1)/60 <= 0.3T`

显式maxWalkingMinutes MUST照常施加。明确成功边的真实数值可参与免费下界；超时/provider_error不是不可能证明。缓存失败若没有足够时效/来源证据，也不作为全局不可能证明。经纬度与G只能排序，不能把估计速度当下界来否决潜在伙伴。

若存在任何potential伙伴，锁定Anchor #1，后续实际请求失败也不自动切换Anchor。仅在所有伙伴被免费事实排除时查#2；#2同样无可能则返回no feasible，最多两名。回退前不为Anchor #1请求任何新边。

实现中记录proofReasons、候选扫描数、uncertain数量，geometry低分和top-k截断不能出现在proofReasons里。第一Anchor免费失败消耗0新增请求，因此当前允许的回退不会将Route budget翻倍。Anchor #2缺起点缓存时补O→#2，仍占同一个budget。

Case G：60分钟，第1文化观展min40，对书店15或公园30均在加buffer6后无解；第2书店min15可与第3公园min30搭配，起点5分钟+站间3分钟，最低总时长59分钟。只请求书店→公园，不查询第1Anchor。

## 4. 两站构造算法

Route Candidate Set保留已排序全量候选，只附加Family/dwell。锁定Anchor后按Family去掉硬不可能组合，提案队列建议保留各Family的原排名代表与几何近邻代表，去重后有限尝试；提案先按已有Goal等级、G，再按既有单地点排名稳定排序。缓存仅节省验证成本，不充当POI质量加分。

文档级提案容量仍建议Q2≤6，但不是封板。离线lab为了隔离数学性质，采用potential伙伴按G、singleRank排序取前6的简化队列，未声称实现了正式Family代表调度。这种探索策略本身待后续真实验证。

每个B：先读取O→A及A→B缓存；缺哪条只查哪条；所有真实边成功后检查总移动、总时间min、显式MUST。以min开始判定是否能形成两站，再调用同比例舒展分配停留。成功的两站草案全部保留，不因之后可扩展第三站而删除。

同一边在本run只验证一次；provider_error/timeout计入budget，记录未知并尝试其他有限提案，禁止自动转Anchor #2。API失败不能直接说“附近无多地点路线”。

## 5. 三站incremental admission

只对maxStops=3运行。第二站阶段保留若干两站前缀，建议H≤3个不同体验代表，每前缀Q3≤2个第三站提案。H/Q3是待验证的探索容量，不是路线评分规则。

对前缀O→A→B和C：检查C的真实Goal Match在白名单中、身份与Family不重复，基于已有前缀真实秒数检查`prefixTravel + minA+minB+minC + buffer <= T`。通过后计算四点G作软提案顺序；再在budget内查缺失B→C。

所有边成功后用新总移动W重新检查gate、预算和dwell分配。**重新从A/B/C的min分配，而不是冻结两站已分配的dwell。** 加入C可降低A/B原先舒展量，只要不低于min；否则两站在未到max时已用完体验预算，会错误地使几乎所有第三站永远无法加入。

不自动评价三站“更完整”；保留两站和三站共同竞争。纯Geometry低G不硬拒绝。产品“不能产生明显不合理折返”在当前无硬阈值条件下只能落实为诊断、探索降序及最终排序，不保证绝无折返。若要求硬拒绝，需要产品补充可执行定义，不能擅自加入G阈值。

## 6. Dwell proportional expansion伪代码与显示

```text
allocate(stops, budget, travel):
    buffer = existingBuffer(budget)
    D = budget - buffer - travel
    minima = sum(stop.min)
    if D < minima: return INFEASIBLE
    widths = [stop.max - stop.min]
    W = sum(widths)
    alpha = 0 if W == 0 else min(1, (D - minima) / W)
    dwell[i] = min[i] + alpha * widths[i]
    remaining = D - sum(dwell)
    return dwell, alpha, remaining
```

W=0是未来固定停留区间的退化保护，当前表无零宽区间。输入要求finite、0≤min≤max。内部以秒或一致的浮点分钟计算，只有极小数值误差可作数值归一，不添加真实预算容差。

性质：若Σmin≤D≤Σmax，Σdwell=D；若D>Σmax，Σdwell=Σmax。故在饱和前算法自然用完可分配体验时间，饱和后留空余；这是确定公式的性质，不是利用率奖励，也不为了多填时间新增第四站。

公园/书店D=65：alpha=20/55，精确dwell为40.9091/24.0909。手算与程序一致。

建议UI安全显示方案（不更改内部公式）：每站`display_i = 5*floor(dwell_i/5)`；当前全部min为5分钟整数，必有display_i≥min_i。将这些值作为“约40分钟/约20分钟”的保守安排，不各自四舍五入上调。取整释放的5分钟明确计入显示余量。

时间轴、显示总时间必须使用**同一组displayDwell**重新累计，而不是显示40+20却仍用精确65的停留合计。移动保留真实秒数（可显示“X分Y秒”），buffer保持原值；显示总计=真实移动+buffer+ΣdisplayDwell，剩余=预算−显示总计。不可把每段移动向上取整后相加，制造超过预算的UI。内部精确总时长与display总时长是分别命名字段，不交叉混用。

单调性证明仅适用于**相同站点/顺序、同样路线时间、同样区间**。现有离散预算30/45/60/90/120/150/180对应buffer3/5/6/9/10/10/10，budget−buffer单调增加，故每站dwell单调不降。换路线、加第三站、更新真实交通时间均不属于这条定理。若未来允许连续分钟，round(buffer)跳点也需重新定义单调性范围。

## 7. MST/chain Geometry伪代码

正式设计先把同一BD-09来源坐标投影到同一局部米制平面；不直接对经纬度“度”作欧氏距离，不混合坐标系。起点与站点位置/入口策略一致，投影只做诊断，不改Route canonical端点。

```text
geometry(origin, orderedStops):
    p = localMeterProjection([origin, ...orderedStops])
    chain = sum(distance(p[i-1], p[i]))
    if chain == 0: return {G: UNKNOWN, reason: COINCIDENT_POINTS}
    # Prim; only 3 or 4 vertices, complete graph
    visited = {0}; mst = 0
    while visited.size < p.size:
        edge = shortest edge from visited to unvisited
        mst += edge.length
        visited.add(edge.destination)
    return {chain, mst, G: mst / chain}
```

数学证明：访问链本身是连接全部顶点的一棵树，MST权重不大于它，故G≤1。只要至少两点位置不同，chain>0、mst>0，G>0。全部重合时不是G=1而是未定义；不要用epsilon除法把它制造为几何优势。部分位置重合但并非全重合仍可计算，未知/无效坐标不伪造G。

G对同一POI集合的不同顺序更可比；不同集合时还反映分叉布局，不是纯折返概率。它不知道围墙、河流或道路绕行；直线G=1也可能实际步行非常远。保留真实Route验证，无固定硬阈值。

离线观测：直线顺序(0,0)→(100,0)→(200,0)→(300,0)，G=1；轻微绕行(0,0)→(100,0)→(80,30)→(200,30)，G≈0.882225；明显折返(0,0)→(100,0)→(−100,0)→(200,0)，G=0.5。仅为合成样本，不是阈值标定结果。

## 8. 两站/三站共同Ranking：最小分层建议

本节是本轮要求提出的**待产品确认方案**，不是改写既有单地点算法。真实可行性是准入门槛，不和其他质量换分。不能直接计算S=3/M=2/W=1的均值：这会假设等级间距相等，让S+W与M+M等价。

推荐路线Goal quality词典序：先比较最弱等级（S>M>W），同最弱等级再比较S占比。固定2/3站时其余比例由总和约束足以确定组成；需要时用整数交叉乘避免浮点比较。不把S数量累加当奖励。

- S+S与S+S+S在Goal层相同；S+S胜S+M+M；S+S+M可胜S+M，但因为组成比例改善，不因为3>2。
- M+M优于S+W，这是“最弱站优先”的明确保守选择，需要产品确认，不能隐含在实现里。
- 不把这些路线级组成回写给任何POI的Goal Match。

之后建议：路线总移动的既定20%“足够接近”语义 → G较高 → Rating → Price → 稳定ID。不使用stopCount、ΣPOIScore、ΣRating或时间利用率。

### 20%两两比较的循环风险

X:10分钟/G=.8；Y:11.5分钟/G=.9；Z:13分钟/G=1，Goal一致。

X/Y差15%，所以Y靠G胜X；Y/Z差约13%，Z靠G胜Y；X/Z差30%，X靠Mobility胜Z。形成Y>X>Z>Y，不能当作严格Array.sort比较器，可能依赖输入顺序。单地点同样存在“近似相等不传递”的结构，但本轮不修改其代码。

最小建议仅用于新增Route Ranking：在相同Goal quality组内按travel升序，以当前最短r为固定参照，把`travel < 1.2*r`放在同一个Mobility组；下一组从剩余最短重新开始。0分钟只与0同组，20%边界进入下一组。组内比较G/Rating/Price。这样稳定且保留20%参数，但组边界附近两条差很小也可能分组，是明示取舍，**需产品批准，不宣称完全等价于所有两两比较**。

Rating聚合建议：所有站都有评分才有路线级`minRating`，比较最弱站；双方minRating>4.5则按既有语义认为均为高质量，转Price。不增加评分分档/容差。部分UNKNOWN时聚合UNKNOWN，已知事实照常展示；是否让完整评分优先于不完整评分需确认，不淘汰UNKNOWN路线。

Price聚合建议：所有站都有百度商户数值才计算算术平均merchant price，避免sum天然惩罚三站；它是“每站已知商户价格均值”，不是路线实际总消费。部分UNKNOWN不按0或只取便宜已知站，聚合保持UNKNOWN；已知聚合优先UNKNOWN，均已知时低者先。该口径也须确认，不修改单地点金额排序。

Geometry UNKNOWN建议单独置后，不推断G=1；这可能不利于同楼不同Family场景，需产品确认。G差很小是否也优先目前没有容差，不自行加阈值。

独立lab已实现上述排名建议的验证版本（非正式），覆盖两站胜三站、全S的三站可凭G胜两站、相同质量不会只因增加一站而加分、输入顺序反转仍稳定。没有将待决方案接入生产。

## 9. Route-level dedup

先共同排序，后按顺序去重并最多保留3条。两站/三站谁质量更高谁留下，不先按站数选赢家。

建议两个简单检查：无序POI集合相等或包含，视为同一路线变体；去掉本run固定Anchor后的Family集合相等或包含，视为相似体验组合。A→B与B→A、A→B与A→B→C不能同时占据展示名额，A→公园1与A→公园2也不视为体验多样性。

不是复杂clustering，不计算综合相似度；Family去重是本轮待确认轻量方案，可能仅剩1条，不能凑3。ABC和ABD共用AB但Family组合不包含时可能同时保留，这是轻量规则的明确边界；若产品要求共享任意非Anchor站就冲突，可加集合交集检查，但会更容易只剩一条，不自行启用。

## 10. Edge/cache模型与6/12预算静态分析

边是有向的。两站需O→A、A→B两条真实成功边；三站再加B→C，共三条。已有Anchor起点边时最少新增1/2；全命中则0；冷启动最低2/3。不查返程，不用O→B减O→A近似A→B。

edge key包含provider、mode、BD-09、ordered from/to身份和坐标、destinationUid及入口策略版本，不能按Goal或分钟预算区分同一条边，也不能把反向视为命中。缓存结果外包observedAt/expiresAt与request fingerprint，不修改RouteResult核心结构。

现有客户端缓存[mode,from,to]没有TTL或destinationUid元信息：同snapshot刚验证的起点边可复用，任意陈旧条目不能盲信。现有服务端按API路径与参数缓存5分钟/最多128条、在途合并、400ms串行，可直接复用固定代理，不需新地图能力。失败边在本run记忆，超时不当no_route，失败也占已发调用预算。

K包含固定Anchor，Q2是实际尝试第二站数，H≤Q2是扩展前缀数，Q3是每前缀第三站尝试数，o=0或1表示起点边是否需新增：

|策略|两站最多新增请求|三站最多新增请求|
|---|---:|---:|
|单条已指定路线|o+1|o+2|
|固定Anchor全唯一边|o+K−1|o+(K−1)²|
|有界分支|o+Q2|o+Q2+H×Q3|
|共享budget B后的实际硬上限|min(B,o+Q2)|min(B,o+Q2+H×Q3)|

公式按缺失唯一边最坏值计算；失败、重试若批准都须计入B。目前不自动重试。真实验证完成数可能为0，不应把预算6解释成保证6条路线。

当前合法Anchor回退在付费前发生，#1成本0，不叠加两轮。#2 O→A有缓存时与普通Anchor成本一样；缺缓存最多额外1条，但包含在B内。理论后验fallback若未来获准也必须共享B，并预留额度；否则#1用满B后#2没有机会。本轮关闭后验fallback。

### Budget=6

maxStops=2可尝试最多6条缺失A→B；maxStops=3若先用6次查第二站，会没有第三站额度。要平衡，可以讨论先3次第二站、再3次扩展；这改变探索宽度而非推荐分数，尚未批准。

### Budget=12

可试6个B，并为最多3个前缀各试2个C，新增最多12。相比6增加第三站或失败替代机会，不增加最终3条展示上限。已有边大量缓存时，6也可能验证更多路线；必须同时限制提案数量/运行时长，不能因为缓存免费就无限枚举。

同一合成fixture，O→A已缓存、其余边成功且2分钟：预算6验证6条两站、0条三站；预算12验证同6条两站+6条三站；去重后两者均为3条。这个结果证明额外额度增加探索，不证明展示质量必然改善。

递减收益：同Family、多dwell下界失败场景，B从6升12完全无收益；高缓存命中也可能无收益；若前6条因真实绕行失败，第7条才可行，则可能有明显收益，不能从一组成功fixture推导统一曲线。需要真实记录每次调用后的合法独特路线数、首条结果延迟、质量变化及新增Family组合，再决定B。

建议保留6/12作为实验配置，不封板。单地点流程仍有独立起点算路成本且无固定全局上限，本轮预算只算Multi-stop新增，不能承诺全站生成最多12请求。服务端缓存命中的代理调用仍可保守占本地预算，provider计费需单独观测。

## 11. 纯离线fixture与结果

执行：`node docs/fixtures/multi-stop-v1.offline.mjs`。脚本禁用fetch，不读取AK、不连接本地代理、不读取真实位置或真实POI数据；使用node内置assert而不挂进正式Vitest链路。

公共合成池含公园、书店、咖啡厅、购物中心、展览馆、商业街、手工制作、猫咖，人工提供id、source=mock、synthetic坐标、GoalMatch、Family、min/max、原始rank与oracle路段时间。经纬度为人工生成示意值，实际几何用局部米制坐标；不作百度真实结果。C等排名单元用独立等级向量隔离路线级比较，不声称由正式v3或单地点引擎生成排名。

|Case|实测结果|
|---|---|
|A 45分钟轻量两站|书店+日常零售，真实模拟移动6分钟、buffer5；合法，1条新增模拟边|
|B 60分钟文化|40+15+6=61；零新增模拟边，判无解|
|C 90分钟两站胜三站|S+S胜可行S+M+M，无站数奖励|
|D 120/150三站|两站和三站都保留；A/B重新分配且不低于min|
|E 猫咖|60无解；90配书店、模拟总移动4分钟可行，猫咖不低于60|
|F 同Family|零新增模拟边，预期no feasible|
|G Anchor回退|文化#1免费无解→书店#2+公园#3成功；无第1Anchor新边|
|H Geometry|顺路1、轻微绕行0.882225、折返0.5、全重合UNKNOWN|
|I 超过max|180分钟零售两站各40，移动4+buffer10，总94、余86|
|J 同比例舒展|D65→40.9091/24.0909；UI建议40/20，释放5分钟|

另覆盖单边失败、全部验证失败、缓存混合命中、方向不对不能复用、几何1但模拟步行50分钟被gate拒绝、后验失败不启用#2、30分钟跳过、6/12成本、去重与排名循环反例。

截至本轮共29项检查通过；4,019组合法dwell分配检查；343组Geometry检查；网络调用0。通过源码哈希和输入序列化确认lab未写入或修改单地点模块与输入对象。它不是生产集成测试，不覆盖真实v3调用、UI或API服务。

## 12. 数学Invariant与验收清单

1. R≥0时alpha∈[0,1]，所以min≤dwell≤max；W=0保护。
2. Σdwell=min(D,Σmax)，因此总时长≤预算；UI向下取整仍不超过。
3. 固定路线/时间事实下，允许的离散预算增大，dwell不下降；切换路线不作此承诺。
4. D达到Σmax后alpha=1，所有站停在max，余量可增加。
5. 三站重算各站min，不能透支原站min；两站草案不被覆盖。
6. 全S两站与全S三站在Goal层打平；路线不含stopCount bonus。
7. Family检查在预检、构造、最终验证都保持唯一性。
8. Geometry纯计算，无API；退化不生造优势。
9. Anchor顺序来自输入rank；只能在全量免费证据无解后启用#2，不生成新score。
10. 模块不修改单地点输入、评分/排序/停留字段；未来需增加集成级前后结果完全一致测试。
11. 任何已发请求计入budget；同方向同参数在run内最多一次；取消不返还已发名额。
12. 真实失败、budget不足、免费证明无解分别记录，有限top-k未穷尽不能宣称全局无解。

额外生产前测试：JSON类型及来源、精确端点/入口策略、缓存TTL、并发预算预留、取消竞态、日期/营业时间UNKNOWN、坐标投影误差、Goal切换旧响应隔离、无返程边、runtime deadline、展示数≤3。

## 13. 矛盾/边界：反例 → 原因 → 最小修正建议

**G严格大于0的前提缺失**：O/A/B重合→MST=chain=0→0/0。补充“至少两点不同才0<G≤1”，退化UNKNOWN，不改Geometry规则。

**无Geometry硬阈值与禁止明显折返**：G=.5的三站其余条件全满足→没有已批准拒绝条件。当前只能作为软质量参加竞争，不能声称绝对禁止；若必须硬拒，需产品给出定义，本轮不造阈值。

**20%关系不传递**：10/11.5/13分钟例形成循环→直接sort不自洽。建议新增路线排序用固定参照组；只改变新Route ranking的实现提案，不碰单地点比较器，待确认。

**“不填满”误读与确定公式**：D=65且max合计100→公式必然分完65。这不是冲突；应理解“不超过max后强填、不以利用率加分”，不能继续用上一轮中点目标提前停。

**不减少A/B既有停留的误读**：两站在未到max时已吃满D→若冻结两站舒展量，第三站永远没时间。按已确认规则重新分配，只要求A/B不低于min。

**单调性不是跨路线保证**：120分钟公园+书店，150分钟加入咖啡厅后公园停留可能降低。限定Invariant到固定站点及边事实，不禁用合法第三站，也不谎称每次用户加时间每个地点都增加停留。

**免费top-k不能作为不可能证明**：前几名都同Family，但较低排名有另一Family→若先截断会错误触发Anchor回退。免费预检扫描全量，之后才截探索队列。

**等级比例是路线组成，不是平均等级分**：S+W与M+M不应由于数值编码被迫相等；推荐最弱等级+S比例，但其保守偏好需要产品确认。

## 14. 仍需真实测试 / 仍需产品决定

真实测试才能回答：预算6/12首条合法路线命中率、候选几何近但路网绕行比例、额外6次的边际质量收益、缓存命中及计费、provider失败分布、真实G分布与用户连贯感、入口选择、Route时延、冻结当前公开起点池的代表性。当前真实Demo没有POI间边，不能验证真实Multi-stop；全文化Family无解已被产品接受，不修改Demo作弊。

产品待决定：

- Route Goal quality是否采用最弱等级→S比例；Rating取min/Price取均值以及UNKNOWN聚合口径。
- 20%Mobility循环的固定参照组方案；G排序位置与UNKNOWN处理；是否需要明确折返硬拒定义。
- Q2/H/Q3、budget6/12、deadline，以及预算6时两站/三站探索如何分配。真实验证前不封板。
- 后验真实路线失败是否允许#2。目前严格不允许。若将来开放，需分配共享预算，可能以少查#1候选为代价；#1所有边已失败时也不能盲目重试服务级错误。
- Family集合去重的严格度；是否再禁止共享非Anchor站的不同Family组合。
- 返程勾选时的Multi-stop入口文案；现有营业字符串无法保证抵达时营业的展示标准。

明确不再待决定：Family表、dwell区间、比例舒展公式、时间/maxStops表、最低2站、无返程、无stop-count bonus、免费证明后最多一次Anchor回退。这些已固定。

## 15. 最终实现模块计划（待批准后实施）

新增独立`route-builder/`边界：familyPolicy（路径+range）、candidateView（只读rank）、cheapPrecheck（全量证明）、geometry（MST/chain）、edgeRepository（缓存与oracle）、budgetLedger（共享预算/取消）、builder（两站及增量三站）、dwellAllocation（确定公式）、routeRanking（待决聚合/稳定排序）、routeDedup、routeAudit。

建议结构：RouteCandidate{poiRef,singleRank,goalMatch,family,dwellRange}；RouteDraft{orderedStops,knownEdges,geometry,unknownEdges}；VerifiedRoute{2|3 stops,successfulEdges,totalTravel,exactDwell,displayDwell,buffer,remaining,G,qualityComponents}；BuildResult{routes,anchorAttempts,requests,cacheHits,proofs,unexplored,reasons}。精确与显示时长分离，不将政策写入百度事实。

正式接入只需编排/UI调用Builder并展示独立Multi-stop区域、复用固定walking代理；没有必要复制CityWalk Kotlin框架。可借鉴其逐站贪心，但真实秒数代替直线估时；借鉴Orienteering问题定义，不引入prize加总；cheapest insertion只作未来扩展，不在V1改变Anchor或全排列查边。

## 16. 单地点模块禁止改动

不得为本轮多地点接入修改：`src/recommendation/goalCandidateSupply.ts`的v3表/召回/5个限额；`src/map/webPlaceSearch.ts`分页；`src/recommendation/engine.ts`单地点可行性、排序、buffer及flexible停留；`factors.ts`Mobility/Rating/Price；`realProvider.ts`单地点dwell；`src/contracts/mobility.ts`通勤公式；MapPOI/RouteResult核心来源/坐标事实；单地点UI主动排序、前6与更多、返程逻辑。

API与缓存适配若需request fingerprint/TTL元数据，以新增包装处理，不擅自重写现有路线结果。不得为提高多地点命中率额外Search/Detail、放宽min、修改单地点排名、引入Goal类别权重。

## 17. 从输入到最多3条结果的简洁伪代码

```text
buildMultiStop(existingRankedSingles, intent, snapshot, cache, budget):
    if intent.minutes == 30: return NOT_APPLICABLE
    if intent.returnMode != OPEN_ENDED: return UNSUPPORTED_MULTI_STOP_MODE
    candidates = readOnlyMultiStopView(existingRankedSingles)
    limit = productMaxStops(intent.minutes, resolvedGoal)
    ledger = oneSharedLedger(budget)  # failures count; no automatic retry
    anchor = NONE
    for a in firstTwoUsableCandidatesInExistingRankOrder(candidates):
        potential = FREE_FULL_SCAN(a, candidates, intent, cache)
        if potential not empty:
            anchor = a
            break
        recordFreeImpossibilityProof(a)
    if anchor == NONE: return NO_FEASIBLE_MULTI_STOP_ROUTE

    pairs = []
    for b in boundedProposals(potential, cachedFacts, geometry, existingRank):
        edgeFacts = cachedOrBudgetedDirectedEdges([O, anchor, b], ledger)
        if allSuccessAndHardFeasible(edgeFacts, dwellMin, existingBuffer, existingMobility):
            pairs.add(allocateExactAndDisplayDwell([anchor,b], edgeFacts))
    # No Anchor #2 after route-validation failure.
    drafts = copy(pairs)
    if limit == 3:
        for pair in boundedPrefixSet(pairs):
            for c in boundedThirdProposals(pair, candidates):
                if duplicateIdentityOrFamilyOrMinImpossible: continue
                G = mstChain([O, pair.A, pair.B, c])  # soft, no hard cutoff
                edge = cachedOrBudgetedEdge(pair.B, c, ledger)
                if edge successful and wholeRouteHardFeasible:
                    drafts.add(reallocateAllThreeWithinMinMax(pair, c, edge, G))
    ordered = agreedLayeredRouteRanking(drafts)  # no stop-count or utilization bonus
    routes = lightweightDedup(ordered).take(3)
    return routes + audit(provedImpossible/unchecked/APIerrors/budgetUsed)
```

实现必须保证免费预检结束前不预取起点/站间边；共享ledger原子预留避免并行越界；缓存命中和未发请求不冒充真实API成功；分类/排序/地图事实各自保持来源边界。
