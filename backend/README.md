# 中国古代史 · Mac 内容服务

GitHub Pages 提供网站页面，这台 Mac 提供 PostgreSQL 数据库和只读 API；Tailscale Funnel 提供固定 HTTPS 入口。当前内容为《旧五代史》《新五代史》各一章的开篇节选，共四段原文。尚未收录译文。

## 本机运行

- Node.js 需要 22.18.0 或更高版本。初始化和测试会读取前端 `src/data.ts` 中的原文节选，使用 Node 内置类型擦除；运行中的 API 仍使用 JavaScript。
- API：`http://127.0.0.1:8787/api/health`
- PostgreSQL：仅监听 `127.0.0.1:55432`，数据库 `ancient_history`。
- 数据、密码、隧道身份、日志和备份：`backend/.local/`，已排除于 Git。配置文件仅当前用户可读写，API 使用只读数据库账户。
- 服务：`~/Library/LaunchAgents/com.lzww.ancient-history.*.plist`。数据库、API、Tailscale 登录后自动启动，进程退出后自动重启。每日 03:15 生成本机备份，并在登录时补做一次。
- 已配置 Amphetamine 5.3.2 与 Power Protect：应用启动时自动开始无期限防休眠，接电和电池供电时均允许合盖运行，屏幕可以熄灭或锁屏。保持联网和足够电量；关机、耗尽电量、断网或暂停防休眠后进入睡眠时，接口会离线。系统重启后需要登录当前 macOS 账户，服务才会启动；这不是登录前运行的系统服务。

Amphetamine 通过 `~/Library/LaunchAgents/com.lzww.ancient-history.amphetamine.plist` 在登录后启动。Power Protect 使用开发者提供的脚本，系统规则只允许当前账户 `lzww` 免密码执行 `/usr/bin/pmset -a disablesleep 1` 和 `/usr/bin/pmset -a disablesleep 0`，没有授予其他管理员此权限。旧安装包的签名检查未通过，因此未运行该安装包；实际安装的是已检查的脚本与收紧后的规则。

**放进包里或需要正常休眠前**，点击菜单栏 Amphetamine 图标，结束当前会话并退出应用。重新打开 Amphetamine 会再次开始防休眠。仅熄灭屏幕或锁屏时无需退出应用。防休眠不支持关机后继续运行，也不能避免电池耗尽。原始应用设置的恢复副本保存在 `.local/amphetamine/preferences-before-2026-10-07.plist`。

此目录是正在使用的服务目录；移动或删除项目前，先停用 LaunchAgent。前端在读取失败时保留随站发布的节选。

```sh
cd backend
npm run status
npm test
npm run backup
npm run backup:verify
```

重建服务配置（保留数据库已有内容）：

```sh
npm ci
npm run setup:mac
node scripts/tunnel.mjs setup
node scripts/tunnel.mjs login
node scripts/tunnel.mjs enable
```

`tunnel.mjs enable` 使用 `--bg`，Funnel 配置保存在隧道状态中，重启后恢复。首次使用需要在 Tailscale 页面同意 HTTPS 与 Funnel 设置。不要启用路由、出口节点或把数据库映射到公网。

本次 Funnel 权限仅允许这台主机的 Tailscale 地址 `100.112.212.75`。当前设备登录授权将在 **2027-04-04** 到期，届时需要重新登录；未关闭密钥到期保护。更换或移除设备后，需重新配置权限和网站地址。

## 内容与翻译

书籍 → 版本 → 章节 → 稳定段落 ID → 原文修订 → 译文版本。译文绑定原文修订号；只有 `published` 且对应当前原文修订的译文会出现在公开接口中。原文修改后，旧译文保留，但不会错误匹配到新原文。

当前段落 ID：`old-1-p1`、`old-1-p2`、`new-1-p1`、`new-1-p2`。`seed` 只补缺失的示例记录，不覆盖已有内容。后续批量章节可按 `db/001-initial.sql` 的结构导入；当前未提供公网管理界面。

将译文写入 UTF-8 文本文件后，通过本机命令导入、检查并发布：

```sh
npm run content -- translation old-1-p1 /absolute/path/translation.txt --translator 译者姓名
npm run content -- list
npm run content -- review 译文ID
npm run content -- publish 译文ID
```

保存原文新修订（保留原文旧版本）：

```sh
npm run content -- original old-1-p1 /absolute/path/original.txt
```

## API

| 请求 | 返回 |
| --- | --- |
| `GET /api/health` | API 与数据库状态 |
| `GET /api/books` | 已发布书籍 |
| `GET /api/books/old/chapters` | 已发布章节目录 |
| `GET /api/chapters/old-1` | 原文、匹配修订的已发布译文、来源与阅读提示 |
| `GET /api/search?q=朱氏` | 当前原文的字面检索，最多 20 条 |

支持 GET、HEAD、OPTIONS；不提供写入接口。CORS 允许 `https://lzww0608.github.io` 与本机开发/预览地址。CORS 只约束浏览器，接口中的已发布内容本身是公开的。

## 备份与恢复

备份文件在 `.local/backups/`，采用 PostgreSQL custom 格式。**本机备份不能应对整机丢失或磁盘损坏**，还需把备份复制到另一台设备或选定的云存储。目前未连接外部存储。

检查备份：

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_restore --list .local/backups/备份文件.dump
```

恢复时先创建独立数据库，检查恢复结果后再切换，避免直接覆盖现有数据库。连接使用 `.local/run` 的本机 Unix socket、端口 55432 和当前 macOS 用户，无需把管理账户密码放入网站。

## 前端地址配置

固定地址保存在 `frontend/.env.production`，开发使用 `frontend/.env.development`。这些值是公开地址，不是凭据。切换设备或重命名 Tailscale 主机、网络后，需要更新生产地址并重新部署前端。

Tailscale Funnel 当前是测试功能且存在带宽限制，适用于 demo 和少量访问；实际运行情况见 `SETUP-RESULT.md`。官方说明：[Funnel](https://tailscale.com/docs/features/tailscale-funnel)、[后台运行与重启恢复](https://tailscale.com/docs/reference/tailscale-cli/funnel#effects-of-rebooting-and-restarting)。
