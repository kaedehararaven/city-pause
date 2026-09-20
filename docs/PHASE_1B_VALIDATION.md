# Phase 1B 真实定位与公园 POI 验证

验证日期：2026-09-20  
范围：百度地图 JavaScript API GL 4.0、浏览器定位、`LocalSearch.searchNearby` 单关键词“公园”  
搜索半径：1500 米

本报告不记录用户的精确当前位置，不记录 Browser AK、Server AK 或完整百度请求 URL。

## 官方依据

- [定位指南](https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/lbs/locate)：使用 `BMap.Geolocation.getCurrentPosition`，并通过 `getStatus()` 区分成功、拒绝、服务不可用、超时等状态。
- [Geolocation 类](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.Geolocation.html)：支持高精度、缓存时长和超时参数；成功结果可包含 `point`、`accuracy` 等。
- [本地检索指南](https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/lbs/localsearch)：附近搜索使用 `searchNearby(keyword, center, radius)`。
- [LocalResultPoi](https://lbs.baidu.com/jsapi/refdoc/v4/interfaces/BMap.LocalResultPoi.html)：`title`、`uid`、`point` 为必要字段，其余列出的字段为可选字段。
- [坐标说明](https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/concept/coord)：JSAPI 默认使用 BD-09 坐标。

## 真实运行结论

- 地图加载成功，可拖动、缩放并在刷新后重新初始化。
- 手动触发定位成功；地图移动到定位点并显示“当前位置” Marker。
- 本次 `accuracy` 的运行时值为 `0`，因此应用将精度保持为 unknown，不显示虚假精度。
- 以真实定位点为中心搜索 1500 米内“公园”，本次返回 1 个结果；开发列表成功显示公园名称、地址和 BD-09 坐标。
- 另行观察到定位权限拒绝和定位超时，两种情况均保留开发默认中心，没有生成假位置。
- 成功运行后的浏览器控制台没有 error 或 warning。

## POI 字段调查

| 字段/业务事实 | 官方文档 | 本次真实返回 | 可选或 unknown | A 线用途判断 |
| --- | --- | --- | --- | --- |
| `uid` / POI identifier | 必要 | 有，string | confirmed | 稳定引用候选地点 |
| `title` / name | 必要 | 有，string | confirmed | 展示与解释 |
| `point` / latitude、longitude | 必要 | 有，object | confirmed，BD-09 | 搜索中心、路线输入 |
| `address` | 可选 | 有，string | optional | 地点说明 |
| `city`、`province` | 可选 | 有，string | optional | 地域校验 |
| `adcode` | 可选 | 有，number | optional；官方类型声明与运行时类型不同，Adapter 转为 string | 行政区筛选或校验 |
| `type` | 可选 | 有，number | optional；含义沿用百度枚举，不推断业务类别 | 调试/来源记录 |
| `tags` | 可选 | 未出现 | unknown | 若后续稳定返回，可辅助类别判断 |
| `phoneNumber` | 可选 | 字段存在，但值为 `undefined` | unknown | 目前不可用于推荐 |
| `detailUrl` | 可选 | 有，string | optional；当前不向业务层暴露 URL 内容 | 调试/详情跳转候选 |
| `postcode` | 可选 | 字段存在，但值为 `undefined` | unknown | 当前无核心用途 |
| `isAccurate` | 可选 | 有，boolean | optional | 可能用于数据质量提示 |
| distance | 未在 `LocalResultPoi` 中保证 | 未出现 | unknown | 不可作为步行距离 |
| opening status / hours | 未在 `LocalResultPoi` 中保证 | 未出现 | unknown | hard constraint 所需但目前不可用 |
| quiet / comfortable / indoor / free / crowded / suitableForRest | 未提供 | 未出现 | unknown | 禁止从名称或类别推断 |
| walkingMinutes | 未提供 | 未出现 | unknown | 必须由后续真实路线能力取得 |

本次还观察到官方 `LocalResultPoi` 文档未列出的运行时字段：`areaname`、`src_type`、`std_tag`、`v4aboveExt`。其中 `std_tag` 为 array，`v4aboveExt` 为 object。它们可能是内部或扩展数据，当前 Adapter 不消费，也不纳入正式 Contract。

## 坐标系

- 定位结果 `point`：按 JSAPI 官方默认规则作为 BD-09 使用。
- 地图中心与 Marker：BD-09。
- `LocalSearch` 搜索中心与返回 POI `point`：BD-09。
- 本阶段未执行坐标转换。

## Contract Proposals

以下只是 A/B 共同评审候选，不是正式 `MapPOI`：

| 业务事实 | 百度是否提供 | 来源 | optional | A 线可能用途 |
| --- | --- | --- | --- | --- |
| provider identifier | 是 | `LocalResultPoi.uid` | 否 | 候选去重与引用 |
| display name | 是 | `LocalResultPoi.title` | 否 | 推荐结果展示 |
| BD-09 location | 是 | `LocalResultPoi.point` | 否 | 路线查询输入 |
| address | 是 | `LocalResultPoi.address` | 是 | 解释地点位置 |
| administrative area | 是 | `province`、`city`、`adcode` | 是 | 地域限制与校验 |
| telephone | 文档支持 | `phoneNumber` | 是；本次值缺失 | 目前不用于 hard constraint |
| category tags | 文档支持 | `tags` | 是；本次未出现 | 需更多样本后决定是否采用 |

临时 Adapter 位于 `src/map/poiAdapter.ts`。它只接收百度 raw POI，输出已归一化的临时结构；Mock 与正式地图实现仍需在正式 Contract 确认后对齐。
