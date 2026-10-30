# kavian.day

Kavian 的个人世界：一个可以用键盘走进去的 3D 卡通渲染（三渲二）网站，会跟着访客本地的 24 小时、真实季节和天气变化，同时承载作品、笔记和生活记录。

> 当前阶段：工程骨架。世界里是灰模占位（一座小岛、车站、码头、角色和狗），时段、季节、天气已经接通。

## 开始

需要 Node 20.19 以上和 pnpm。

```bash
pnpm install
pnpm dev        # 本机 + 局域网开发，端口 3001
pnpm test       # 时段、季节、天气的单元测试
pnpm build      # 生成静态站点到 apps/site/.output/public
```

### 局域网访问

`pnpm dev` 默认监听 `0.0.0.0:3001`。本机使用 `http://localhost:3001/`，同一 Wi-Fi / 局域网内的设备使用终端显示的 Network 地址，例如 `http://192.168.1.20:3001/`。地址以当前电脑实际 IP 为准。

修改启动配置后，先在原终端停止旧服务，再运行 `pnpm dev`。访问期间保持服务运行；如果其他设备无法连通，检查是否在同一网络、网络是否开启客户端隔离，以及 macOS 是否允许 Node 接收入站连接。此地址只用于局域网，不是公网链接。

本地开发时没有天气接口，世界会按季节随机天气；部署到 Cloudflare 之后才是真实天气。

## 目录

```
kavian-day/
├─ apps/site/            Nuxt 4 网站：页面、双语、HUD
├─ packages/
│  ├─ tokens/            设计系统的唯一数据来源（tokens.json、时段 / 季节 / 天气数据），编译出 tokens.css
│  ├─ env/               时段、季节、天气的纯计算 + 单元测试
│  ├─ world/             Three.js 世界：天空、光照、水、天气粒子、角色移动、镜头
│  └─ ui/                Kw* Vue 组件与组件样式
├─ functions/api/env.ts  Cloudflare Pages Function：访客大致位置 + Open-Meteo 天气
└─ doc/                  规划、分析和设计系统文档（以后的分析文件都放这里）
```

## 设计系统

- 在线版：claude.ai 上的「Kai 世界设计系统」（设计规则、组件预览）。
- 仓库里的数值以 `packages/tokens/src/tokens.json` 和 `packages/tokens/data/*.json` 为准；改了设计系统，同步这两处，并在 `doc/design-system/04-决策记录.md` 记一笔。
- 文字版规则在 `doc/design-system/`。

## 操作

`W` `A` `S` `D` 移动，`Shift` 跑，`E` 互动或进门，鼠标拖动转镜头、滚轮缩放，`Tab` 快捷目录，`Esc` 关闭。

## 部署（Cloudflare Pages）

1. 把仓库推到 GitHub。
2. Cloudflare Pages 新建项目，连接仓库：
   - 构建命令：`pnpm install && pnpm build`
   - 输出目录：`apps/site/.output/public`
   - 环境变量：`NODE_VERSION=22`
3. 根目录的 `functions/` 会自动部署成 `/api/env`。
4. 在 Cloudflare 里绑定域名 kavian.day。

## 接下来

- 内容：接入 Nuxt Content，作品 / 笔记 / 生活三类内容和独立页面。
- 角色：定稿概念图 → 三视图 → VRoid Studio 建模，替换灰模（流程见 `doc/design-system/02-世界美术规范.md`）。
- 场景：第一个正式场景（海边车站）的建模和卡通材质。
- 评论与留言板：Giscus。
