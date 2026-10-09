# 中国古代史 · Mac 内容服务

GitHub Pages 提供网站页面，这台 Mac 提供 PostgreSQL、公开只读 API 和受密码保护的译文校订入口；Tailscale Funnel 提供固定 HTTPS 入口。当前公开原文归档共9部史料、178篇、7,870段：旧史77篇、1,485段，新史23篇、782段，其余为《资治通鉴》五代选卷及笔记、典章和考异。选卷不等于旧史150卷或新史74卷全本，完整卷保留其他人物、后嗣及校勘。

本轮李克用将领专题38人、24新增及14复用身份，统一目录102人。追加旧史卷15、61、65共59段文白内容，按582个原文单位核对后拼成完整段落，已在独立恢复库验证同批次原子导入后授权正式发布与导出。正式库共9部史料、180个章节、7,874段原文、7,870条已发布译文，包含原有两个兼容节选章节和四段原文。此前350份来源／正文文件和六个既有原文／译文身份表的校验均不变；校订历史和兼容记录保留。静态副本更新仍需构建、部署与线上验证。

当前7,870条公开译文包括：《旧五代史》1,485条、《新五代史》782条、《资治通鉴》3,022条、《五代会要》1,922条、《五代春秋》76条、《五代史阙文》44条、《五代史补》214条、《北梦琐言》147条、《资治通鉴考异》178条。统计含标题、夹注、辑佚与校勘注；各书范围见公开文库目录。页面统一显示“白话译文”，实际来源与审核状态保留在元数据，工具核对不冒充人工审核。

## 本机运行

- Node.js 需要 22.18.0 或更高版本。初始化和测试读取 `content/five-dynasties/` 中的公开原文归档；运行中的 API 使用 JavaScript。
- API：`http://127.0.0.1:8787/api/health`
- PostgreSQL：仅监听 `127.0.0.1:55432`，数据库 `ancient_history`。
- 数据、密码、隧道身份、日志和备份：`backend/.local/`，已排除于 Git。配置文件仅当前用户可读写。公开阅读继续使用只读账户 `history_reader`；校订使用独立账户 `history_editor`，只获授专用修订函数的执行权限，没有原文或译文表的直接写入权限。
- 服务：`~/Library/LaunchAgents/com.lzww.ancient-history.*.plist`。数据库、API、Tailscale 登录后自动启动，进程退出后自动重启。每日 03:15 生成本机备份，并在登录时补做一次。
- 已配置 Amphetamine 5.3.2 与 Power Protect：应用启动时自动开始无期限防休眠，接电和电池供电时均允许合盖运行，屏幕可以熄灭或锁屏。保持联网和足够电量；关机、耗尽电量、断网或暂停防休眠后进入睡眠时，接口会离线。系统重启后需要登录当前 macOS 账户，服务才会启动；这不是登录前运行的系统服务。

Amphetamine 通过 `~/Library/LaunchAgents/com.lzww.ancient-history.amphetamine.plist` 在登录后启动。Power Protect 使用开发者提供的脚本，系统规则只允许当前账户 `lzww` 免密码执行 `/usr/bin/pmset -a disablesleep 1` 和 `/usr/bin/pmset -a disablesleep 0`，没有授予其他管理员此权限。旧安装包的签名检查未通过，因此未运行该安装包；实际安装的是已检查的脚本与收紧后的规则。

**放进包里或需要正常休眠前**，点击菜单栏 Amphetamine 图标，结束当前会话并退出应用。重新打开 Amphetamine 会再次开始防休眠。仅熄灭屏幕或锁屏时无需退出应用。防休眠不支持关机后继续运行，也不能避免电池耗尽。原始应用设置的恢复副本保存在 `.local/amphetamine/preferences-before-2026-10-07.plist`。

此目录是正在使用的服务目录；移动或删除项目前，先停用 LaunchAgent。前端在 API 不可用时继续读取随站发布的完整原文和已发布译文副本；离线期间不能保存校订。

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

AI 批次首先按 `draft` 保存。`translations.metadata` 记录 AI 来源、生成时间、批次及内容校验值、翻译标准、底本校验值和 `reviewNotes` 校核提示；`humanReviewed: false` 记录初译时尚未人工校订的事实。用户明确授权的批次可通过 `translations:publish-ai` 公开，发布状态与审核状态分开。按用户最新显示要求，网站统一使用“白话译文”，不展示 AI／待修订提示。发布不能伪造人工审核；原文表和原有译文版本保持完整。

章节 ID 例如 `old-v110`、`new-v11`、`tongjian-v290`、`quewen-v001`；段落 ID 例如 `old-v110-p1`。原有 `old-1-p1` 等兼容节选 ID 继续可用。`seed` 与 `content:import` 只补缺失记录，不覆盖已有原文修订、译文或发布状态。阅读页提供受保护的逐段译文校订，不提供原文或数据库管理界面。

共享人物资料在 `content/five-dynasties/emperors.json`，收录五代实际在位的十四位皇帝，包括朱友珪；未实际即位的刘赟不计入。姓名、别名、在位年份、来源及 `readingStarts` 主阅读入口由前端统一读取，整篇人物关联保存在公开目录的 `subjects`，不是数据库中的人物传记表。本纪／专传按记载对象关联，编年史允许在位交接卷关联多帝，补充史料只依据明确姓名或可辨认帝号。更新关联不改写既有原文、修订号或译文。人物年份按实际西历跨年保存，与粗略政权年表分开；界面仍只展示后梁、后唐、后晋、后汉、后周。

共享人物目录由 `emperors.json`、`taibao.json`、`zhu-wen-generals.json` 和 `li-keyong-generals.json` 派生。专题复用成员只引用同一稳定ID，不重复建立人物；李克用专题新增24人、复用14人，全部军职须在李克用在世时有依据，后续转仕另述。十三太保区分亲子、养子、赐姓名与部将，演义用名不当作史实。人物记载、关系与展示资料不覆盖既有原文和译文。

人物片段索引独立保存在 `content/person-passages/index.json`，覆盖当前归档范围。数据库用 `passages` 保存共享片段、`passage_spans` 保存原文段落与 Unicode 字符范围、`person_passages` 保存人物关联和记载类别；`passage_people` 保存稳定人物 ID，`person_passage_index` 保存覆盖统计。一个片段可以关联多人，读取只返回该片段引用的段落，不将整章作为人物传记。

每个范围绑定原文修订号和 SHA-256。SQL 仅公开书籍、章节已发布且所有范围仍匹配当前原文的片段；任一修订、校验值或范围失效后，该片段暂停展示并计入人物列表的 `unavailableCount`。译文沿用完整章节的规则，只读取对应当前原文的最新已发布版本，草稿不公开。人物关系与片段索引都不修改繁体底本、稳定段落 ID、原文修订或译文。

首次新库初始化会导入索引；重跑 `seed` 时保留已有索引。已有原文修订与归档不一致而索引为空时，仅创建索引表并保留原文，跳过自动导入。正式更新索引使用严格校验的本机命令，先备份并验证：

```sh
npm run backup
npm run backup:verify
npm run passages:import
```

也可传入经共享校验器验证的索引文件：`npm run passages:import -- /absolute/path/index.json`。导入用一个事务核对整个归档与数据库的当前原文，锁定原文直到提交，然后同步独立索引表。来源不一致或中途失败时整批撤销；相同索引重复导入不重复写入。`004-person-passages.sql` 只建立索引表并给 `history_reader` 授予 SELECT，`history_editor` 仍只有原有校订函数权限。管理连接仅在本机导入命令使用，不进入公网 API 服务。

导入已校验的公开归档（先备份；不需要重启 API）：

```sh
npm run backup
npm run backup:verify
npm run content:import
```

来源与版本见 [归档说明](../content/five-dynasties/README.md)。归档是公开原文，`.local/` 是私有运行数据，不要混用。

将译文写入 UTF-8 文本文件后，通过本机命令导入、检查并发布：

```sh
npm run content -- translation old-1-p1 /absolute/path/translation.txt --translator 译者姓名
npm run content -- list
npm run content -- review 译文ID
npm run content -- publish 译文ID
```

AI 初译批量导入（先备份并验证）：

```sh
npm run backup
npm run backup:verify
npm run translations:import -- .local/translations/2026-10-07-chunqiu/batch.json
```

`import-translations.mjs` 要求所选篇章逐段完整对应，核对原文修订号和 SHA-256，再以一个事务导入。数据库原文不匹配或中途写入失败时，整批撤销。同一批次重复执行不会复制译文；改变内容需另用批次 ID，产生新译文版本，保留已有稿件。批量工具始终只导入待修订草稿，不执行审核或发布。`002-translation-metadata.sql` 为已有译文表追加元数据列，不改写其正文。

公开已获用户授权的 AI 批次并导出离线副本：

```sh
npm run translations:publish-ai -- .local/translations/2026-10-07-chunqiu/batch.json
npm run translations:publish-ai -- .local/translations/2026-10-07-new/batch.json
npm run translations:export -- chunqiu
npm run translations:export -- new
```

当前公开副本位于 `content/published-translations/`：`chunqiu.json`（76 条）、`new.json`（782 条）、`quewen.json`（44 条）、`shibu.json`（214 条）、`beimeng.json`（147 条）、`kaoyi.json`（178 条）、`old.json`（1,485 条）、`huiyao.json`（1,922 条）及 `tongjian.json`（3,022 条）；合计 7,870 条，每条均保留来源、译文版本、原文修订绑定及校核提示。导出后仍需构建、部署前端，才能更新 API 离线时所用的副本。

首批试译文件均在 Git 忽略的 `.local/translations/2026-10-07-chunqiu/`：

- `batch.json`：76 条逐段初译，包含 50 条校核提示。
- `review.md`：直接从数据库已保存稿件生成的文白对照稿，列出段落号、译文 ID、版本和疑点，供本地阅读及人工修订。
- `before-import.json`、`database-verification.json`：原文完整性与实际入库核对记录。

日期和专名以底本为准。疑似讹字、吴／晋等不同时期称谓、其他史书的记载差异，单列为校核提示，不在翻译时静默修正底本。编辑 `review.md` 不会自动修改数据库；人工修订可通过本机 `content translation` 命令另存新版本，也可使用阅读页的在线校订入口。未发布草稿不会进入静态网站副本。

### 在线校订

本机运行 `npm run editor:setup` 初始化专用数据库函数与校订凭据。首次生成强随机密码，已有配置重跑不轮换密码；`backend/.local/editor-key.txt` 保存供所有者本机查看的校订密码，`backend/.local/editor-config.json` 保存密码的 SHA-256 校验值及独立数据库账户配置，文件权限均为 0600。不要把这些文件内容复制到 Git、网页、说明、截图或日志。API 启动时加载独立校订配置；未配置时写入口返回 503，公开阅读仍可用。

在阅读页进入校订，输入所有者密码后，可逐段修改已发布译文、署名及校核提示。密码只保留当前页面内存，不写入浏览器持久存储或 Cookie；刷新或退出校订后重新输入。写请求必须来自允许的网站 Origin，并携带 Bearer 密钥。

保存调用 `public.revise_published_translation`，锁定当前原文段落并检查原文修订、当前已发布译文 ID 及书籍／篇章发布状态。每次保存追加新的已发布译文版本，标记 `origin: human`、`reviewStatus: owner-edited`，通过 `basedOnTranslationId` 和 `aiSourceTranslationId` 保留修改链与 AI 来源。这表示所有者已修改，不表示经过专业审核。原文、历史译文及原文归档都不会覆盖；原文或译文已有新版本时返回 409，要求重新读取后再修改。

`history_reader` 保持只读。独立 `history_editor` 仅获数据库连接、schema 使用和专用函数执行权限，不使用 owner 数据库账户处理公网写请求。函数固定搜索路径、显式引用 `public` 表，并撤销 PUBLIC 执行权。接口限制正文为 256 KiB、译文为 20,000 字符；无效鉴权按连接地址限流，正确密码不因失败次数被锁定。

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
| `GET /api/chapters/old-v110` | 原文、匹配修订的已发布译文、来源与阅读提示 |
| `GET /api/people/zhu-wen/passages?bookId=new&limit=50&cursor=0` | 当前归档内的人物片段、来源、已发布译文与分页统计 |
| `GET /api/passages/passage-new-v01-p2` | 单个可见片段及关联人物 |
| `GET /api/search?q=朱氏` | 当前原文的字面检索，最多 20 条 |
| `GET /api/editor/status` | 在线校订是否启用，不返回凭据 |
| `POST /api/editor/session` | 验证 Origin 与 Bearer 密钥 |
| `POST /api/editor/translations/new-v04-p1` | 验证身份与预期版本后追加已发布译文版本 |

公开阅读接口仅支持 GET、HEAD、OPTIONS。仅 `/api/editor/` 下的校订入口允许受保护的 POST，预检允许 `Content-Type` 与 `Authorization`。CORS 允许 `https://lzww0608.github.io` 与本机开发/预览地址；写入还必须通过 Bearer 鉴权。CORS 只约束浏览器，接口中的已发布内容本身是公开的。

人物片段列表的 `bookId` 可省略，省略时汇总所有公开史料；`limit` 默认为 50、范围为 1—100，`cursor` 默认为 `0`、仅接受非负整数字符串。结果按书籍 ID、章节目录位置、段落位置及片段 ID 稳定排序，`total` 仅计可见片段，`nextCursor` 在末页为 `null`。`resultSetRevision` 是同一 SQL 快照中完整可见片段 ID 集合的 SHA-256，分页参数不影响它；客户端可在集合或读取来源变化时从第一页重新读取，避免偏移游标跳过片段。未知人物或书籍返回 404，无效分页参数返回 400；已停止公开或原文绑定失效的单片段返回 404。完整章节接口保持兼容。

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
