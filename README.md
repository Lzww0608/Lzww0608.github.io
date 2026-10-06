# 中国古代史

从史料出发，连接人物、事件与时代。网站以中国古代史为整体框架，第一期聚焦五代时期（907—960）。

在线访问：[中国古代史](https://lzww0608.github.io/)

## 当前版本

- 山水书卷风格首页和历史时期导航。
- 五代政权更迭年表：六个节点，支持关联人物和史料入口。
- 六个人物条目，支持姓名、别名检索和政权筛选。
- 《旧五代史》《新五代史》开篇节选阅读、字号调整、阅读提示和完整原文链接。
- 洛阳、开封、太原的地点地图与说明。
- 全站检索、移动端导航及阅读布局。

其他时期尚未收录。当前年表仅展示中原政权主要更迭，尚未覆盖十国及全部五代人物、事件。史料阅读页明确标注节选范围。

## 项目结构与开发

网站源代码在 `frontend/`，使用 React、TypeScript、Vite、Leaflet 和 Phosphor 图标。构建前自动执行严格类型检查，详见 [前端说明](frontend/README.md)。根目录原始的静态页面保留为早期部署记录，正式发布入口为 `frontend/index.html`。

```sh
cd frontend
npm ci
npm run dev
```

生成并预览正式版本：

```sh
npm run build
npm run preview
```

静态发布目录是 `frontend/dist/client/`。使用 hash 路由，阅读页等链接可以直接打开和刷新。原文与已发布译文从本机内容服务读取；服务离线时显示随站收录的节选。

## 内容后端

`backend/` 提供只读 API、PostgreSQL 数据库、原文和翻译的版本管理，以及 macOS 自动启动配置。公网使用 Tailscale Funnel 的固定 HTTPS 地址。设置、内容维护和备份说明见 [后端说明](backend/README.md)。数据库、连接密码、隧道身份及备份均不进入 Git。

## 开发 skills

项目在 `.agents/skills/` 收录了 8 个开源前后端开发技能，涵盖界面设计、React 性能、TypeScript、Node.js API、PostgreSQL 和测试。使用场景、固定来源版本与许可证说明见 [技能目录](.agents/README.md)。可运行 `python3 .agents/verify-skills.py` 检查本地文件完整性。

## 部署

GitHub Pages 的发布来源设置为 **GitHub Actions**。`.github/workflows/pages.yml` 在 `main` 分支的前端或部署配置变化时自动安装依赖、构建和发布；也可以在 Actions 页面手动运行。

部署记录：[网站发布流程](https://github.com/Lzww0608/Lzww0608.github.io/actions/workflows/pages.yml)

## 内容、图像与参考

- 原文来自维基文库：[《旧五代史》卷一](https://zh.wikisource.org/wiki/舊五代史/卷1)、[《新五代史》卷一](https://zh.wikisource.org/wiki/新五代史/卷01)。本站仅展示开篇节选，夹注和完整章节请查看原始页面。沿用原文来源页面所标明的适用授权，本站整理的阅读提示与原文分开呈现。
- 地图使用 [OpenStreetMap](https://www.openstreetmap.org/copyright) 现代底图，页面保留署名。地点为现代城市的大致坐标，不代表五代疆域或古城精确位置。
- 山水、书封和印章均为生成插图，并非历史文物照片、古地图或书籍影印。压缩素材位于 `frontend/public/images/`，绘图原文件保存在 `frontend/design-assets/`。
- 设计参考：[故宫博物院](https://www.dpm.org.cn/)、[中国哲学书电子化计划](https://ctext.org/zhs)、[Chronas](https://chronas.org/)，借鉴历史内容的展示方式和信息组织，不复制其界面或素材。

后续逐步补充史料章节、人物与事件，并扩展到其他历史时期。
