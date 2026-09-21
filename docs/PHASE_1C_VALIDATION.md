# Phase 1C Walking Route + Place Detail 验证

验证日期：2026-09-20  
测试对象：Phase 1B `LocalSearch` 实时返回的一个真实“公园” POI  
隐私与安全：不记录用户精确当前位置、POI uid、Browser AK、Server AK 或包含 AK 的百度请求 URL。

## 官方 API 选择

### Walking Route

选择百度 [Direction API v2 步行路线规划](https://lbsyun.baidu.com/docs/webapi?title=directionv2/webservice-direction/walking)。它接受 `纬度,经度` 起终点，可选 `destination_uid`，支持显式指定 `coord_type=bd09ll` 和 `ret_coordtype=bd09ll`；返回路线距离（米）、耗时（秒）、steps、instruction 和 path 等。

没有使用两点直线距离，也没有让 LLM 估算时间。项目保留 `walkingDistanceMeters` 和 `walkingDurationSeconds`，并以 `Math.ceil(seconds / 60)` 确定性生成 `walkingMinutes`。

### Place Detail

选择百度 [Place API v3 地点详情检索](https://lbsyun.baidu.com/docs/webapi?title=placev3/guide/webservice-placeapiV3/interfaceDocumentV3)，使用实时搜索结果的 uid、`scope=2` 和 `extensions_adcode=true`。官方说明不同 POI 类型返回的详情不同；营业状态和图片等部分能力需要额外商业权限。

两个接口都需要 AK，因此只由 Node 后端携带 `SERVER_AK` 请求。浏览器端只访问本项目固定的 `/api/map/walking-route` 和 `/api/map/place-detail`。

公开的[开发者权益表](https://lbsyun.baidu.com/solutions/privilege)在本次查阅时列出：个人开发者地点检索 100 次/日、3 次/秒；路线规划 5000 次/日、3 次/秒。实际账户额度仍以百度控制台为准。

## 真实 Walking Route 结果

- 请求成功，provider status 为成功。
- 步行路线距离：1079 米。
- 步行路线耗时：929 秒。
- 派生步行分钟：16 分钟，规则为向上取整。
- 返回 5 个 steps。
- route 实际字段：`destinationLocation`、`distance`、`duration`、`originLocation`、`steps`。
- step 实际字段包含：`distance`、`duration`、`instructions`、`name`、`path`、起终点位置和转向类型等。
- 项目当前只向客户端输出归一化距离、耗时、分钟、路段数及有限 step 信息；未暴露完整 raw response 或 path。

## 真实 Place Detail 结果

- 请求成功，返回的 uid 与 name 可用。
- 实际获得分类标签：旅游景点 / 公园 / 生态公园。
- 实际获得营业时间：`00:00-24:00`。
- 实际获得综合评分：`4.0`。
- 价格、营业状态、室内楼层没有获得可用值，保持 unknown。
- 顶层实际字段：`uid`、`name`、`location`、`province`、`city`、`area`、`town`、`town_code`、`adcode`、`address`、`street_id`、`detail`、`detail_info`。
- `detail_info` 实际字段包含 `tag`、`classified_poi_tag`、`type`、`detail_url`、`shop_hours`、`overall_rating`、`sug_time`、`navi_location`、`children` 等。
- 实际 `adcode` 为 string，而当前 v3 文档表格标为 int；因此不得只依赖文档声明做无检查转换。

## 城市暂停键可用事实矩阵

| 事实 | 来源 API | 官方支持 | 真实观察 | 稳定性 | 可进入未来 Contract | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| POI identity | JSAPI LocalSearch / Place v3 | 是 | 有 | 高 | 建议 required | uid 来自实时检索 |
| POI name | JSAPI LocalSearch / Place v3 | 是 | 有 | 高 | 建议 required | 两侧结果一致 |
| coordinate | JSAPI / Place v3 | 是 | 有 | 高 | 建议 required | 本阶段统一 BD-09 |
| address | JSAPI / Place v3 | 是 | 有 | optional | 建议 optional | 不同 POI 可能缺失 |
| category/tag | Place v3 `detail_info` | 是 | 有 | optional | 建议 optional | 本次公园返回两级标签 |
| walking distance | Direction v2 walking | 是，米 | 有：1079 m | 高（成功路线内） | 建议 required-on-success | 不是直线距离 |
| walking duration | Direction v2 walking | 是，秒 | 有：929 s | 高（成功路线内） | 建议 required-on-success | 16 min 为确定性派生 |
| route steps | Direction v2 walking | 是 | 有：5 | optional for recommendation | 暂不进入最小 Contract | 后续画路线时再评审 path |
| opening hours | Place v3 `shop_hours` | 是 | 有 | POI 类型相关 | 建议 optional | 本次为全天 |
| business/open status | Place v3 `status` | 是，部分能力需额外权限 | 无可用值 | 权限和类型相关 | 暂缓 | unknown 不表示正常营业 |
| price | Place v3 `price` | 是 | 无 | 类型相关 | 建议 optional | 本次公园 unknown |
| rating | Place v3 `overall_rating` | 是 | 有：4.0 | 类型相关 | 建议 optional | 不能假定所有 POI 都有 |
| indoor information | Place v3 `indoor_floor` | 是 | 无 | 类型相关 | 暂缓 | unknown |
| free/not free | 未直接提供 | 否 | 无 | 不可用 | 否 | 不从“公园”推断免费 |
| quiet | 未直接提供 | 否 | 无 | 不可用 | 否 | UNKNOWN / NOT PROVIDED |
| crowded | 未直接提供 | 否 | 无 | 不可用 | 否 | 热度高级字段也不等同实时拥挤 |

## Contract Proposals

以下仍是建议，不是正式 `MapPOI` 或 `RouteResult`：

- 路线成功结果保留 `walkingDistanceMeters`、`walkingDurationSeconds` 和 `coordinateSystem`。
- `walkingMinutes` 标记为 derived，并固定使用 `ceil(seconds / 60)`。
- 路线无结果、provider error 和缺少配置使用明确状态，不伪造距离或时间。
- Place Detail 的 `categoryTag`、`classifiedTag`、`shopHours`、`overallRating`、`price`、`businessStatus`、`indoorFloor` 全部保持 optional。
- A 线只能消费 Adapter 后的内部事实；不得把 absence 解释为 false/no，也不得直接消费百度 raw response。

## Security 验证

- Server AK 只从 `.env.local` 的 `SERVER_AK` 读取；该文件被 Git 忽略。
- 浏览器源码没有 Server AK 配置或值。
- 后端只访问两个固定百度路径，不接受任意目标 URL。
- 后端校验 uid 与坐标，response 只包含临时内部结构。
- 百度错误信息和完整请求 URL不会写入 response 或日志。
- 真实验证期间后端日志仅包含本地监听与代码重启信息，没有 AK 或百度请求 URL。
