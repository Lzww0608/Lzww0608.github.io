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

`src/types.ts` 定义历史事件、人物、书籍、地点、搜索结果及章节响应类型。`src/chapter-schema.ts` 校验来自 API 的原始 JSON；格式异常或 API 不可用时，阅读页使用随站发布的完整原文副本。正文按卷加载，不进入首页主脚本。

开发和生产 API 地址分别使用 `.env.development` 与 `.env.production` 中的 `VITE_HISTORY_API_URL`。前端只读取公开史料，不包含数据库密码或本机私有配置。

## 繁体／简体阅读

每卷原文工具栏提供“繁体／简体”切换，默认显示归档繁体底本，选择会在本浏览器中保留（跨卷、跨书及刷新）。API 与静态归档共用同一个阅读组件；新增卷文自动支持切换。简体仅用于阅读显示，译文、署名、段落标识、修订号和底本不被修改；切回繁体直接使用底本，不从简体反向转换。

转换使用 [OpenCC JS 1.4.2](https://github.com/nk2028/opencc-js) 的通用繁转简字典，首次选择简体时才加载；字典与网站一同发布，转换不需要请求外部服务。`src/script-converter.ts` 增补已核对的五代史料年号、建筑名称，保留“乾祐／乾化／乾宁”等正确写法。新增内容应核对歧义专名，必要时增补例外及回归检查。库及字典授权为 MIT AND Apache-2.0，署名和许可随站保存在 `public/licenses/opencc-js/`。

## 本地原文

公开归档在 `../content/five-dynasties/`。启动和构建前自动校验并复制 64 卷到 `public/history/`；生成目录已忽略。修改正文归档应显式维护来源版本与校验值，不覆盖稳定段落 ID。史料库可按五位开国皇帝筛选，阅读地址如 `#read-old/old-v110`。`#read-old` 等原地址仍打开各书默认卷。页面从静态归档先显示正文，再使用 API 中的已发布修订和译文。
