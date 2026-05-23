# QQNotice

Server酱 风格的 QQ 通知服务。把消息或者文件通过 OneBot(NapCat)机器人池
推送到指定的 QQ 私聊。任何脚本一行 `curl` 就能给手机推消息或推文件。

## 特性

- **多租户自助**:任何人凭部署时配的 `INVITE_CODE` 注册账号,自助管理 SendKey,管理员只负责机器人池。
- **机器人池自动路由**:每个 SendKey 绑定一个目标 QQ,绑定的机器人挂掉或被对方删好友时,下次发送会自动迁移到另一个有该好友的在线机器人,变更持久化。
- **五种调用形态**:`GET` / `POST` 都接受,SendKey 可以放 path、query、`Authorization: Bearer` 头或 body,服务端统一归一。
- **文件推送**:`POST /send/file` 上传 multipart 文件,服务端 base64 转给 NapCat 的 `upload_private_file`,不需要服务和机器人共享文件系统。最大 30 MB。
- **可审计的发送日志**:每次 `/send*` 调用都落库(成功 + 失败都记),内含目标 QQ、内容、耗时、失败原因、原始附件 blob。Web 后台按 SendKey、按用户、跨用户三种粒度查看,文件可以再下载回来。
- **密码以外都不可恢复**:用户名 + bcrypt 密码 + 邀请码;没有邮箱,没有找回。SendKey 创建时也存明文以便随时复制(`/send` 仍然走 bcrypt 验证)。
- **OneBot 健康检测**:WS 状态 + 心跳 `online=true` + 心跳间隔三重判定;NapCat 重连可以自动重启 friend list 拉取。
- **Web UI**:React + Tailwind,SendKey 管理、机器人池监控、用户管理、发送日志(含文件下载),全部在同一个端口的同一个 Node 进程里。

## 仓库布局

```
.
├── server/          # 后端:Node + TypeScript + Fastify + Prisma + ws + vitest
│   ├── prisma/      # Prisma schema 与迁移
│   ├── scripts/     # 工具脚本(Prisma CLI 包装、reactivate-keys 等)
│   └── src/
├── web/             # 前端:React 18 + Vite + Tailwind v3 + TypeScript
└── scripts/         # 仓库级脚本(发布打包等)
```

## 环境要求

- Node.js 20+
- pnpm 9+
- MySQL 8

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

Vite 开发服务器把 `/api/*` 和 `/send*` 反代到 `http://127.0.0.1:3000`,所以前端开发体验和生产同源一致。

后端在生产模式或本地开发模式都会自动检测 `web/dist/index.html`,存在就把前端挂在根路径,所以不需要单独跑前端服务。

## 测试

```sh
pnpm -C server test          # 跑全部后端测试(vitest)
pnpm -C server test:watch    # watch 模式
```

测试需要一个独立的测试库,默认是 `qqnotice_test`(其它 DB 凭据从 `.env` 复用)。深模块(`OneBotClient`、`FriendshipCache`、`Router`)是纯函数 / 可注入依赖,不需要 DB。HTTP 路由测试通过 Fastify 的 `app.inject` 跑,涉及 DB 的部分用真 MySQL 连接。

## 数据库连接配置

把 MySQL 的连接拆成五个变量,而不是一整串 `DATABASE_URL`:

| 变量          | 必填 | 说明                              |
| ------------- | ---- | --------------------------------- |
| `DB_HOST`     | 是   | MySQL 主机地址,例如 `127.0.0.1`  |
| `DB_PORT`     | 是   | MySQL 端口,通常 `3306`           |
| `DB_NAME`     | 是   | 数据库名,例如 `qqnotice`         |
| `DB_USER`     | 是   | 用户名                            |
| `DB_PASSWORD` | 是   | 密码(特殊字符自动 URL 编码)     |

服务启动时把这五项拼成 Prisma 需要的 `DATABASE_URL`。Prisma CLI 通过 `pnpm -C server prisma ...` 调用,内部走 `scripts/with-db-url.mjs` 做同样的拼装。

## 应用必需的环境变量

| 变量              | 必填 | 说明                                                    |
| ----------------- | ---- | ------------------------------------------------------- |
| `DB_HOST` 等 5 项 | 是   | 见上文                                                  |
| `JWT_SECRET`      | 是   | Web UI session token 的对称密钥                         |
| `INVITE_CODE`     | 是   | 注册必须提交这个码                                      |
| `ADMIN_USERNAME`  | 是   | 第一次启动时,这个用户名会被标记为 Operator(管理员)   |
| `PORT`            | 否   | HTTP 端口,默认 `3000`                                  |
| `NODE_ENV`        | 否   | `development`(默认)、`production`、`test`             |

任何必填变量缺失,服务都会启动失败并打印缺哪个。

## 发送 API

### 文本(五种形态全接受)

```sh
# GET,key 放 path
curl "http://your-host:3000/send/<sendkey>?content=hello"

# GET,key 放 query
curl "http://your-host:3000/send?key=<sendkey>&title=WARN&content=stuff%20broken"

# POST,key 放 path,JSON body
curl -X POST http://your-host:3000/send/<sendkey> \
  -H "Content-Type: application/json" \
  -d '{"title":"WARN","content":"事情不太对劲"}'

# POST,key 放 Authorization 头(推荐,反代日志里 key 不会被记录)
curl -X POST http://your-host:3000/send \
  -H "Authorization: Bearer <sendkey>" \
  -H "Content-Type: application/json" \
  -d '{"title":"WARN","content":"事情不太对劲"}'

# POST,key 放 body
curl -X POST http://your-host:3000/send \
  -H "Content-Type: application/json" \
  -d '{"key":"<sendkey>","content":"hi"}'
```

`title` 可选,最长 100 字;`content` 必填,最长 4000 字。响应 `{ "code": 0, "message": "ok" }` 表示已投递到 QQ。带 `title` 时 NapCat 收到的格式是 `【{title}】\n{content}`,不带就直接发 `content`。

### 文件

```sh
# multipart/form-data 上传,key 在 Authorization 头里
curl -X POST http://your-host:3000/send/file \
  -H "Authorization: Bearer <sendkey>" \
  -F "file=@/path/to/report.pdf"

# 也可以把 key 放 path,显式覆盖文件名
curl -X POST "http://your-host:3000/send/file/<sendkey>" \
  -F "file=@./local-name.bin" \
  -F "name=对方看到的名字.pdf"
```

只接受一个 `file` 字段,上限 30 MB(超出返回 `413 file_too_large`)。可选 `name` 字段覆盖对方看到的文件名;不传就用上传时的原始文件名。

服务端把文件作为 `base64://...` 转给 NapCat 的 `upload_private_file`,所以服务和机器人不需要共享文件系统。每次文件发送同时落进 SendLog 的 `SendLogFile` blob 副表,Web 后台日志卡片右侧会出现可点击下载的文件块,中文文件名通过 RFC 5987 `filename*` 编码原样回传。

### 响应码

| code | HTTP | 含义                                              |
| ---: | ---: | ------------------------------------------------- |
|    0 |  200 | 已投递到 QQ                                       |
|  400 |  400 | `missing_key` / `missing_content` / `missing_file` / 字段超长 |
|  401 |  401 | `invalid_send_key` / `send_key_disabled`          |
|  413 |  413 | `file_too_large`                                  |
|  429 |  429 | 触发限流,见 `Retry-After` 头                     |
|  502 |  502 | `no_alive_friendly_bot` / `send_failed`           |
|  503 |  503 | `bot_pool_empty`                                  |

## OneBot 连通性 probe(仅开发环境)

`NODE_ENV !== "production"` 时会挂载一个一次性的诊断路由:

```sh
curl -X POST http://127.0.0.1:3000/api/dev/probe ^
  -H "Content-Type: application/json" ^
  -d "{\"wsUrl\":\"ws://127.0.0.1:3001\",\"accessToken\":\"YOUR_NAPCAT_TOKEN\",\"targetQq\":123456789,\"content\":\"hello from probe\"}"
```

服务会连一下 NapCat,等到第一个心跳(完整 payload 以 INFO 级别打到 stdout,方便比对字段),然后调一次 `send_private_msg`。在把机器人正式加到池里之前,用它快速验证连通性。

## 生产部署

不依赖 Docker,后端 Node 进程同时托管 API 和构建后的前端。两条路:

### 路径 A:从 git 部署

```sh
# 在目标机器上
git clone https://github.com/LectWolf/QQNotice.git
cd QQNotice

# 配置 env(同开发,但 NODE_ENV 建议设 production)
cp .env.example server/.env
# 编辑 server/.env,填 DB_*、JWT_SECRET、INVITE_CODE、ADMIN_USERNAME

# 装依赖 → 生成 Prisma Client → 跑迁移
pnpm install --frozen-lockfile
pnpm -C web build
pnpm -C server build
pnpm -C server prisma generate
pnpm -C server prisma migrate deploy

# 启动
pnpm start
```

### 路径 B:从 release zip 部署

仓库提供了一个打包脚本 `scripts/package-release.ps1`(Windows),会把构建好的 `server/dist` + `web/dist` + Prisma 迁移 + 部署模板压成一个 zip(典型 280 KB)。把 zip 解压到目标机器后:

```sh
# 首次部署
cp .env.example server/.env
# 编辑 server/.env

pnpm setup        # = pnpm install --prod + prisma generate + migrate deploy
pnpm start

# 升级到新版本(覆盖解压旧目录,保留 server/.env)
pnpm setup        # 自动跑新增的迁移
pm2 restart qqnotice    # 或者直接 pnpm start
```

zip 内自带 `DEPLOY.md`(详细中文说明)和 `start.cmd`(Windows 双击启动)。

### 后台保活(pm2)

```sh
npm i -g pm2
pm2 start "pnpm start" --name qqnotice --cwd "/绝对路径/qqnotice"
pm2 save
pm2 startup       # 让 pm2 随系统启动,按提示执行返回的命令
```

### 工作原理

`server/dist/index.js` 启动时会检查相对路径 `../../web/dist/index.html`,存在就把前端挂在根路径(`/`),API 走 `/api/*`,推送走 `/send*`,SPA 路由走 `setNotFoundHandler` 兜底返回 `index.html`。所以单进程同源,不需要 nginx 转发也不需要分离前后端。

## 许可证

待定
