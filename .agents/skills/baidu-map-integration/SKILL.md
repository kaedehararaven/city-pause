---
name: baidu-map-integration
description: 在城市暂停键的 Codex 主工程中实现、验证和集成百度地图能力；涉及地图 API、坐标、AK 边界或地图 Adapter 时使用。
---

# 百度地图集成 · v0.2

遵循 `$project-core` 与 [Contract](../../../docs/CONTRACTS.md)。两名开发者均在 Codex 端工作；B 线负责地图能力、地图侧 Contract、Adapter、真实接口验证和主工程集成。通过共享 Contract 向 A 线提供城市事实；需要调整 A 线依赖的语义时先同步确认，不为地图实现便利单方面变更。

## 实现边界

- 百度地图接口名称、版本、参数、响应字段、权限、配额和坐标要求以当前官方文档及真实请求验证为准。发现差异时更新 Contract，不伪造字段维持旧假设。
- 原始响应只进入地图 Adapter/Service。UI 和推荐逻辑只依赖内部 Contract；真实服务与 Mock 服务保持相同业务语义，Mock 必须显式标识。
- 项目地图数据统一使用 BD-09。每个外部接口的输入输出坐标系都要核实，并仅在 Adapter 边界显式转换。
- 按一个能力、一个小改动、一次验证推进地图初始化、定位、POI、步行时间、路线及地图交互。每项验证记录输入、必要/可选事实、unknown、empty/error 和验收结果。

## AK 安全边界

- 浏览器端 AK 可通过明确的客户端变量（例如 `VITE_BAIDU_BROWSER_AK`）供 JSAPI 使用，并配置允许的 Referer/域名限制。
- `SERVER_AK` 只从服务端运行环境读取。不得硬编码、提交 Git、写入可追踪文档/示例/测试快照、放入 `VITE_*`、`NEXT_PUBLIC_*`、`PUBLIC_*` 等公开变量、通过 `import.meta.env` 暴露，或由服务端响应返回客户端。
- 客户端只调用本项目的服务端接口；服务端再携带 `SERVER_AK` 请求百度 WebAPI。任何客户端代码都不得直接调用需要服务端 AK 的地点检索、路线规划、地理编码或批量算路接口。
- 服务端为每项地图能力提供固定路由并校验参数、限制响应字段、节流和缓存；不得提供可转发任意百度路径或任意 URL 的通用代理。部署时按官方控制台可用选项为服务端 AK 配置 IP/权限限制。
- 不再次要求用户提供 `SERVER_AK`，也不读取后在终端、日志、错误、截图或回复中显示。使用当前机器已经配置的安全环境；若运行时缺失，只报告变量未配置。
- 百度 WebAPI 可能在查询参数中携带 AK，因此不要记录完整请求 URL。日志、遥测和错误对象必须移除或遮蔽 `ak`、`SERVER_AK`、Authorization 等敏感字段。
- `.env`、`.env.*` 和本地密钥文件保持 Git ignored；可提交的 example 文件只含空值或明显占位符。提交前检查 staged diff，构建后检查客户端产物不含 `SERVER_AK` 名称、值或服务端配置对象。

## 验收

验证 Contract、unknown、success/empty/location-or-permission/service-or-network 状态、Mock 兼容和现有测试/build。地图改动还要确认客户端 bundle 只含允许公开的浏览器端配置，所有 WebAPI 请求通过服务端边界，源码和 Git 历史中没有服务端密钥。
