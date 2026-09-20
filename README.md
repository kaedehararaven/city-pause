# 城市暂停键

Phase 1A 使用百度地图 JSAPI 4.0 显示可拖动、缩放的基础地图。尚未实现定位、POI、Marker 或路线业务。

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
