# Goal-driven Candidate Supply v3 集成

## 分页与标签容量（最新修订）

覆盖下方首页限制：每层保持一个`$`合并查询，依次读取page_num=0/1/2，每页20条，最多3次Search HTTP请求。空页/不足20条/已达total提前停止；错误停止分页及M/Detail扩展，保留已有分类有效结果并标记partial_success。服务端按页缓存、串行限速、拒绝0~2以外页码。

先分类验证、去重、子地点过滤，再按规范化的完整`classified_poi_tag`路径最多保留5个。父/子路径分别计数，不等价于按搜索词分组；各组按百度结果顺序保留，不添加评分。容量跨S/M及子地点共享。M和Detail补救的12阈值使用限额后有效候选数；达到12不提前中断当前层尚未读取的页面。S最多3次，含M最多6次Search，不逐关键词请求。

审计报告rawResultSetCount为成功读取页数，tag_capacity_reached为标签容量过滤次数。离线快照也应用5个上限，但没有后续分页记录，不伪造覆盖面。此次仅mock验证，真实分页类别增益待人工测试。

## 当前数据源修订（2026-09-28，覆盖下方历史链路）

正式链路：`Goal+时间 → 确认起点 → Web Place Search V3 around scope=2 → 真实分类验证/去重/子地点过滤 → 不足12时批量补缺失分类 → S仍不足12时M → 路线/硬约束 → 既定排序`。

S/M各最多一次Web Search，关键词按官方`$`分隔，page_size=20、首页。20为合并搜索容量，不是每关键词20条。不自动翻页、不逐关键词请求。W不主动召回。正式供给不再用LocalSearch；地图与定位仍使用JSAPI。

先验证整层Search返回的`detail_info.classified_poi_tag`。有效候选达到12不补Detail；不足12才对缺失分类的UID每批最多10个补Detail，每批后重判阈值。已知不匹配不补救，不为评分/价格提前补详情。路线阶段亦不为已验证v3地点提前补非硬字段；用户展开详情可按需加载。单条/批量共享缓存、在途合并、限速、302暂停。

S/M/W表、父路径继承、导航过滤、排序均不变。Candidate Pool仅审计本次动态召回。服务级错误停止扩大请求，不冒充零结果。

本轮公开区域单次探测20条：分类20、评分20、价格19、营业时间18、品牌8、父地点10、导航点20；不代表其他类别覆盖率。Demo采集rest20条/1种分类、walk16条/5种分类、discover19条/3种分类，各一次S，无M，无Detail补救。合计55个唯一候选及55条成功去程路线。

## 历史实现记录（以下不是当前数据源）

正式网页链路为：

`Goal + 时间 → 一次点击 → 复用已确认起点（首次才定位） → S composite LocalSearch → Place Detail classified_poi_tag 验证 → 去重/子地点过滤 → S<12 时 M composite LocalSearch → 路线/硬约束 → S/M/W 优先的既定排序 → 推荐列表`

S 和 M 各最多执行一次 JSAPI `LocalSearch.searchNearby(keywords[], point, radius)`；关键词以数组传给 JSAPI，`onSearchComplete` 返回的每个 `LocalResult` 都会展开读取，每个关键词的 `pageCapacity` 暂为 20。没有恢复每个标签一次请求。Goal 改变会清空旧候选并重新召回，时间范围不足时沿用已确认起点补召回，排序和“查看更多”只消费现有候选。

`classified_poi_tag` 的正式来源是现有服务端 Place Detail adapter 的 `detail_info.classified_poi_tag` 映射到 `TemporaryPlaceDetail.classifiedTag`。LocalSearch 的 `poi.tags`、标题和搜索词不被当作 Goal Match 证据；详情没有该字段时地点被拒绝。

2026-09-28 修订：公开测试起点独立保存在 DiscoveryPanel，切换 Goal 只清空候选及审计结果，不重新定位。用户显式点击定位或公开区域按钮才更换起点。内部生成提交 snapshot 不触发外部版本失效和取消；取消信号向候选发现传播。

详情失败保留脱敏错误分类（HTTP/百度状态码、超时、网络、结构、标识不符），不记录原始响应、坐标、uid 或凭证。服务级拒绝或连续三次详情失败时停止；不进入 M 层。已验证候选以 partial_success 保留；全部失败为 error，不能显示时间不足。网络和超时最多额外重试一次。自动重试可复用同起点、范围、关键词的原始搜索结果；显式重新搜索及 Goal 改变会清空此临时复用。

Pareto 已从正式链路删除。所有通过硬约束的候选进入排序；只消费 tagValidation=matched 的 S/M/W，映射 STRONG/MEDIUM/WEAK。缺少验证来源保持 UNKNOWN；同等级内 Mobility/Rating/Price 原规则不变。旧 trace 的 pareto 字段仅兼容审计结构，enabled=false，不执行筛选。

真实公开区域验证：S 原始 108 个，18 个详情成功后遇到 provider_302，停止余下详情和 M 召回。未调用路线 API；该状态码的外部服务原因仍需确认，不能宣称详情服务全部恢复。

LocalSearch 的 provider_error/timeout 同样停止 M，不把检索服务错误当成有效候选不足。用户反馈 JS 地点检索额度达到上限后，本轮停止所有真实请求，余下验证仅使用本地 mock。
