# 行程地图与导航

## 用户流程

数据来源只有“我附近的真实地点”和“真实历史样本库”，不再提供模拟数据入口。生产Planner不再导入模拟候选；Mock仍保留供单元测试。Demo页面不挂载隐藏的真实Planner。

单地点或多地点选中后，随身小行程显示百度地图、canonical起点、编号地点及已取得的真实道路折线；支持全程/分段高亮。每段提供百度direction链接，包含该段实际起终点BD-09坐标及步行/骑行模式。返回起点的单地点方案沿用实际返程边。

链接需要用户点击后打开百度导航；本页不是持续GPS跟踪或语音逐向导航。不会点击后重新定位替换计划起点。外部地图的实时路线可能变化。

## 数据

- server步行adapter保存真实steps.path，验证lng/lat范围，拒绝坏路径，分段保存，绝不连接缺失路径。
- SuccessfulRouteResult新增可选geometry（BD-09坐标段数组），客户端和行程展示传递该字段。单地点使用plan.routes，多地点使用实际edges。
- 不变更duration、distance、缓存key、排序、路线预算，不为打开地图再算一次路。缓存旧记录/骑行未提供几何时只显示点位与导航链接。
- Demo通过独立mapPreview叠加补采的geometry；严格匹配方向、端点ID、坐标和模式，不重写历史推荐时间。界面标明预览采集日期。

## 补采与覆盖

本轮固定公开历史路段，共13次walking请求：1次旧代理未透传geometry，重启后12次成功，保存12条有向边、53段真实道路折线。Search/Detail/用户定位/返程请求均为0。原计划检查的14条不同路段中仍有2条未覆盖，其他单地点及原公开起点也可能缺几何，不伪造或自动联网补算。两条指定休息案例已覆盖。

地图JSAPI脚本与底图需要联网，并可能计入地图展示类额度；推荐Demo本身不调用地点或路线服务。AK仍仅使用已有浏览器AK加载地图，Server AK不进入客户端或导航链接。

## 验证边界

单元测试覆盖路径验证、导航坐标/编码、缺折线提示、历史时间不被预览重写、模拟入口移除。真实地图和外部导航的交互验收交由用户在Chrome完成，没有自动打开真实页面触发定位。缺浏览器AK或地图加载失败时保留可用的外部导航入口。
# Navigation Presentation Update

- Home fades into a single Planner. REAL and historical Demo switch in place; changing source or Demo area clears old results and cancels pending generation, but retains goal and time inputs.
- Demo code remains lazy-loaded. Generation is blocked until the sample library is available; it never falls through to real location/search while loading.
- Navigation shows numbered stops, a distinct origin, per-leg recorded duration/distance, active-leg highlighting and external Baidu navigation links. Selecting a leg updates overlays without recreating the map.
- No changes to recommendation, coordinates, route metrics or request parameters. UI verification uses mock/offline data only; live visual review remains manual.
