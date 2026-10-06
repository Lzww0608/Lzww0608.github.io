# 五代十国历史网站

第一阶段：发布一个最简静态页面，确认 GitHub 仓库 → GitHub Pages → 浏览器的部署链路正常。

网站地址：<https://lzww0608.github.io/>

## 当前版本

- 入口：根目录 `index.html`。
- 内容：Hello World 和历史网站简介。
- 部署：GitHub Pages 从 `main` 分支的根目录发布。
- 无构建步骤、运行依赖或后端服务。

## 本地预览

直接使用浏览器打开 `index.html`，或在当前目录执行：

```sh
python3 -m http.server 8000
```

然后访问 <http://localhost:8000/>。按 Ctrl+C 关闭服务。

## 部署设置

仓库 Settings → Pages → Build and deployment：

- Source：Deploy from a branch。
- Branch：`main`。
- Folder：`/ (root)`。

保存设置后，提交并推送 `index.html` 的修改会触发发布。发布记录可在仓库 Actions 中查看。

## 后续方向

围绕五代十国，逐步加入史料检索、人物与事件关联、原文对照阅读。
后续再升级为 Vue 3 + TypeScript + Vite，并配置构建部署；独立域名等内容和方向稳定后再绑定。
