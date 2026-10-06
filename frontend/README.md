# 中国古代史 · 前端

React 19 + TypeScript + Vite，当前内容聚焦五代。组件使用 `.tsx`，数据和 API 模块使用 `.ts`。

## 开发与检查

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run test:sites
```

`npm run build` 先运行严格类型检查，再生成网站；GitHub Pages 的现有部署流程也会执行该检查。构建保留 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。

`src/types.ts` 定义历史事件、人物、书籍、地点、搜索结果及章节响应类型。`src/chapter-schema.ts` 校验来自 API 的原始 JSON；格式异常、断网或服务不可用时，阅读页保留随站发布的原文节选。

开发和生产 API 地址分别使用 `.env.development` 与 `.env.production` 中的 `VITE_HISTORY_API_URL`。前端只读取公开史料，不包含数据库密码或本机私有配置。
