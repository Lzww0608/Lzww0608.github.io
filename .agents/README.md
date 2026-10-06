# 项目开发 skills

已为中国古代史网站收录 8 个开源技能，并维护 1 个项目自有技能，覆盖当前 React + TypeScript 前端、Node.js API、PostgreSQL、测试与古文阅读。它们是供 AI 编程助手按任务读取的开发指导，不会增加网站运行时依赖。

## 技能目录

| 技能 | 用途 | 来源 | 授权 |
| --- | --- | --- | --- |
| [frontend-design](skills/frontend-design/SKILL.md) | 新页面、布局、字体与视觉设计 | [Anthropic](https://github.com/anthropics/skills/tree/683bc88e56f3e09ba94f7055977f3d3aa499f202/skills/frontend-design) | Apache-2.0 |
| [vercel-react-best-practices](skills/vercel-react-best-practices/SKILL.md) | React 性能、请求并行、渲染与打包优化 | [Vercel](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices) | MIT |
| [web-design-guidelines](skills/web-design-guidelines/SKILL.md) | 界面审查、可访问性、焦点与交互体验 | [Vercel](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines) | MIT |
| [typescript-advanced-types](skills/typescript-advanced-types/SKILL.md) | 泛型、联合类型、API 客户端与类型安全 | [wshobson/agents](https://github.com/wshobson/agents/tree/46891e7e60da0e52baf1050b7b6391b64e84c6d9/plugins/javascript-typescript/skills/typescript-advanced-types) | MIT |
| [nodejs-backend-patterns](skills/nodejs-backend-patterns/SKILL.md) | Node.js 服务结构、异常处理、数据库连接与安全 | [wshobson/agents](https://github.com/wshobson/agents/tree/46891e7e60da0e52baf1050b7b6391b64e84c6d9/plugins/javascript-typescript/skills/nodejs-backend-patterns) | MIT |
| [api-design-principles](skills/api-design-principles/SKILL.md) | REST 接口、状态码、分页与兼容性设计 | [wshobson/agents](https://github.com/wshobson/agents/tree/46891e7e60da0e52baf1050b7b6391b64e84c6d9/plugins/backend-development/skills/api-design-principles) | MIT |
| [supabase-postgres-best-practices](skills/supabase-postgres-best-practices/SKILL.md) | PostgreSQL 表结构、索引、查询、连接池与权限 | [Supabase](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices) | MIT |
| [javascript-testing-patterns](skills/javascript-testing-patterns/SKILL.md) | JS/TS 测试设计、异常场景与数据库隔离 | [wshobson/agents](https://github.com/wshobson/agents/tree/46891e7e60da0e52baf1050b7b6391b64e84c6d9/plugins/javascript-typescript/skills/javascript-testing-patterns) | MIT |

## 项目自有技能

[historical-text-reading](skills/historical-text-reading/SKILL.md) 维护古文繁简切换、阅读偏好、底本与译文完整性。新增史料、原文阅读入口及相关 API／导入功能时读取；这是本项目维护的约定，与第三方技能正文分开更新。

## 本项目如何使用

Codex 可从项目 `.agents/skills/` 发现技能，新增技能在下一轮对话中可用。可以直接说“使用 frontend-design 改进史料阅读页”或“使用 nodejs-backend-patterns 设计章节 API”。同名技能若也已在用户目录安装，可明确指定本项目中的 `SKILL.md` 路径。

- 前端以已有 React 19、Vite、严格 TypeScript 和 CSS 为基础。Vercel 技能也包含 Next.js、服务端组件等内容，只选用当前项目适用的规则。
- 视觉设计沿用“中国古代史”、五代史料与现有山水风格，设计以阅读和来源清晰为目的。
- 后端保留原生 Node HTTP 只读 API；技能中的框架和身份验证示例按新增功能需要评估。
- Supabase 的 PostgreSQL 通用规则适用于本机数据库，托管服务与 Supabase Auth 示例按实际需求选择。
- 测试沿用当前 `node:test`，不因为示例使用 Jest/Vitest 就更换工具。涉及清理数据库的示例只能用于独立测试数据库。
- `web-design-guidelines` 在审查时需要联网读取 Vercel 最新界面指南；其他技能的参考文档已一并收录，可在本地阅读。

## 来源、许可证与更新

收录日期为 2026-10-07。上述 8 个第三方技能的来源固定到完整 Git 提交，而非浮动的 `main`。上游正文保持原样，并保留其参考目录与模板。Anthropic 使用技能目录内的 `LICENSE.txt`；Supabase 与 wshobson 使用上游 `LICENSE`。Vercel 仓库在 README 的 License 节声明 MIT，但该版本没有独立许可证文件，因此保留原始 README 为 `UPSTREAM-README.md`，不编造上游版权声明。

`.agents/skills.lock.json` 记录每个技能的上游路径、提交、许可证证据和全部收录文件的 SHA-256。`localSkills` 登记项目自有技能名称，其正文跟随项目版本管理，不伪造上游提交或固定校验值。检查完整性：

```sh
python3 .agents/verify-skills.py
```

更新时先审阅新的上游提交及许可证，再替换对应技能目录、刷新锁文件和上述目录中的来源链接。保留现有许可和署名信息；项目适用规则放在本文件及根目录 `AGENTS.md`，与第三方正文分开维护。
