# 城市暂停键

Phase 1C 使用百度地图 JSAPI 4.0 完成真实定位和单类别“公园”搜索，并通过 Node 后端探测 Direction API v2 步行路线与 Place API v3 地点详情。当前结构用于验证真实城市事实；推荐、AI、Citywalk 和正式产品 UI 尚未实现。

## 本地运行

1. 安装依赖：`pnpm install`
2. 可选：复制 `.env.example` 为 `.env.local`，在本机填写已有凭证。不要提交 `.env.local`。
3. 同时启动前后端：`pnpm dev`
4. 打开 `http://127.0.0.1:5173`

后端健康检查位于 `http://127.0.0.1:3001/api/health`。开发前端通过 Vite 代理访问相同的 `/api/health` 路径。

## 检查

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

浏览器端配置名为 `VITE_BAIDU_BROWSER_AK`，只用于百度地图 JSAPI 4.0。`SERVER_AK` 只由 `server/` 代码读取，构建检查会拒绝包含服务端配置的客户端产物。
