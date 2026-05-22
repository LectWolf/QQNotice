# QQNotice

一个 Server酱 风格的 QQ 通知服务。把简短文本通过 OneBot(NapCat)机器人池
推送到指定的 QQ 私聊。任何脚本一行 `curl` 就能给手机推消息。

## 特性(规划中)

- 多租户:任何人凭部署时配的 `INVITE_CODE` 注册账号,自助管理 SendKey。
- 每个 SendKey 绑定一个目标 QQ。机器人池自动路由——绑定的机器人挂了或被
  对方删好友,下一次发送会自动迁移到另一台合适的机器人,并把变化持久化。
- Server酱 风格的 HTTP 端点:`GET` / `POST` 都行,SendKey 可以放在 path、
  query、`Authorization: Bearer` header 或 body,五种形态全接受。
- OneBot 传输:正向 WebSocket 连 NapCat。靠心跳事件判定机器人存活,
  好友列表带缓存(每天全量刷新一次),创建 SendKey 时自动同意目标 QQ
  发来的好友请求。

> 当前状态:仅完成基础骨架。服务可以启动,`/api/ping` 已就绪,React 壳
> 可以渲染,三个最深的内部模块(`OneBotClient`、`FriendshipCache`、
> `Router`)已 TDD 完整覆盖。后续切片(注册登录、SendKey 管理、发送管线、
> 好友握手慢路径、路由韧性、Operator 后台)在 `.scratch/qqnotice/` 中本地
> 跟踪。

## 仓库布局

```
.
├── server/           # 后端:Node + TypeScript + Fastify + Prisma + ws + vitest
│   ├── prisma/       # Prisma schema 与迁移
│   ├── scripts/      # 工具脚本(Prisma CLI 包装等)
│   └── src/
└── web/              # 前端:React + Vite + TypeScript
```

## 环境要求

- Node.js 20+
- pnpm 9+
- MySQL 8(本地直接装,或者用本仓库的 `docker-compose.yml`)

## 本地开发

```sh
# 1. 安装两个 workspace 的依赖
pnpm install

# 2. 配置 env
copy .env.example server\.env
# 用编辑器把 server\.env 里的数据库连接、JWT_SECRET、INVITE_CODE、
# ADMIN_USERNAME 改成本机的值

# 3. 应用数据库迁移
pnpm -C server prisma migrate deploy

# 4. 分别启动后端(:3000)和前端(:5173)
pnpm -C server dev
pnpm -C web dev
```

Vite 开发服务器把 `/api/*` 和 `/send*` 反代到 `http://127.0.0.1:3000`,
所以前端开发体验和生产同源一致。

生产环境单进程部署:Node 同时托管 API 和构建后的静态前端。详见
`Dockerfile` 和 `server/src/index.ts`。

## 测试

```sh
pnpm -C server test            # 跑全部后端测试(vitest)
pnpm -C server test:watch      # watch 模式
```

深模块(`OneBotClient`、`FriendshipCache`、`Router`)和配置加载器都是
纯模块或可注入依赖,测试不需要数据库或真实的 NapCat。后续涉及数据库
或 NapCat 的切片会引入 stub 或专门的集成测试。

## 数据库连接配置

把 MySQL 的连接拆成五个用户友好的变量,而不是一整串 `DATABASE_URL`:

| 变量          | 必填 | 说明                              |
| ------------- | ---- | --------------------------------- |
| `DB_HOST`     | 是   | MySQL 主机地址,例如 `127.0.0.1`  |
| `DB_PORT`     | 是   | MySQL 端口,通常 `3306`           |
| `DB_NAME`     | 是   | 数据库名,例如 `qqnotice`         |
| `DB_USER`     | 是   | 用户名                            |
| `DB_PASSWORD` | 是   | 密码                              |

服务在启动时把这五项拼成 Prisma 需要的 `DATABASE_URL`(密码里的特殊
字符会自动 URL 编码)。Prisma CLI 通过 `pnpm -C server prisma ...` 调用,
内部会做同样的拼装。

## 应用必需的环境变量

| 变量             | 必填 | 说明                                                     |
| ---------------- | ---- | -------------------------------------------------------- |
| `DB_HOST` 等 5 项 | 是   | 见上文                                                   |
| `JWT_SECRET`     | 是   | Web UI session token 的对称密钥                          |
| `INVITE_CODE`    | 是   | 注册必须提交这个码                                        |
| `ADMIN_USERNAME` | 是   | 第一次启动时,这个用户名会被标记为 Operator               |
| `PORT`           | 否   | HTTP 端口,默认 `3000`                                    |
| `NODE_ENV`       | 否   | `development`(默认)、`production`、`test`              |

任何必填变量缺失,服务都会启动失败并打印缺哪个。

## OneBot 连通性 probe(仅开发环境)

`NODE_ENV !== "production"` 时会挂载一个一次性的诊断路由:

```sh
curl -X POST http://127.0.0.1:3000/api/dev/probe ^
  -H "Content-Type: application/json" ^
  -d "{\"wsUrl\":\"ws://127.0.0.1:3001\",\"accessToken\":\"YOUR_NAPCAT_TOKEN\",\"targetQq\":123456789,\"content\":\"hello from probe\"}"
```

服务会连一下 NapCat,等到第一个心跳(完整 payload 会以 INFO 级别打到
stdout,方便比对字段),然后调一次 `send_private_msg`。在把机器人正式
加到池子之前,用它快速验证连通性。

## 生产部署(Node + pnpm 直部署)

不依赖 Docker。在目标机器上:

```sh
# 1. 同步代码
git pull

# 2. 安装依赖
pnpm install

# 3. 构建前后端
pnpm -C web build
pnpm -C server build

# 4. 配置 env(同开发,只是把 NODE_ENV 改成 production)
copy .env.example server\.env
# 编辑 server\.env

# 5. 应用数据库迁移
pnpm -C server prisma migrate deploy

# 6. 启动(生产模式下后端会同时把 web/dist 挂在同一个端口)
pnpm -C server start
```

后台保活推荐用 `pm2`:

```sh
npm i -g pm2
pm2 start "pnpm -C server start" --name qqnotice
pm2 save
pm2 startup     # 让进程随系统启动,按提示执行返回的命令
```

`server/dist/index.js` 会在生产模式下把 `web/dist` 挂在根路径,API 走
`/api/*` 和 `/send*`,前端 SPA 路由走兜底 `index.html`。

## 许可证

待定
