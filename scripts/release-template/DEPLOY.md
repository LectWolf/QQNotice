# QQNotice 生产环境部署

这个 zip 已经包含编译好的后端(`server/dist`)和前端(`web/dist`),
**后端进程会在同一个端口同时托管前端**。从用户角度只有一个服务,一个命令。

## 环境要求

- Node.js 20+
- pnpm 9+(`npm i -g pnpm`)
- MySQL 8

## 首次部署(一次性,3 条命令)

```sh
# 1. 复制环境变量模板,然后按里面注释改值
copy .env.example server\.env

# 2. 装依赖 + 跑数据库迁移(自动按顺序执行)
pnpm setup

# 3. 启动
pnpm start
```

打开浏览器访问 `http://your-host:3000` 即可:API 走 `/api/*` 和 `/send*`,
其余路径都返回前端 SPA。

## 日常启动(每次 1 条命令)

```sh
pnpm start
```

> Windows 用户可以直接双击解压目录里的 `start.cmd`,效果一致。

## 用 pm2 后台保活(推荐)

```sh
npm i -g pm2
pm2 start "pnpm start" --name qqnotice --cwd "/绝对路径/qqnotice"
pm2 save
pm2 startup    # 让 pm2 随系统启动,按提示执行返回的命令
```

## 升级到新版本

把新的 zip 解压覆盖现有目录(注意保留你的 `server\.env`),然后:

```sh
pnpm setup            # 重装依赖 + 跑新增的数据库迁移
pm2 restart qqnotice  # 或者 pnpm start
```

## 必填环境变量速查

| 变量             | 说明                                            |
| ---------------- | ----------------------------------------------- |
| `DB_HOST`        | MySQL 主机                                      |
| `DB_PORT`        | MySQL 端口,通常 `3306`                         |
| `DB_NAME`        | 数据库名                                        |
| `DB_USER`        | 用户名                                          |
| `DB_PASSWORD`    | 密码                                            |
| `JWT_SECRET`     | Web 鉴权对称密钥,随便长一点的随机串            |
| `INVITE_CODE`    | 注册邀请码                                      |
| `ADMIN_USERNAME` | 这个用户名首次登录后会被自动标记为 Operator(管理员)|
| `PORT`           | 可选,默认 `3000`                               |
| `NODE_ENV`       | 生产环境填 `production`                         |
