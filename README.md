# 归物 HomeInventory

一个面向家庭场景的物品管理系统。用于记录耐用品、消耗品、存放空间和采购提醒，默认使用 SQLite，也可切换到 MySQL。

## 已实现

- 物品录入、编辑、删除、搜索和分类筛选
- 物品图片上传至阿里云 OSS、可见物品编号与二维码详情
- 搜索快捷联想、提醒中心和跟随系统主题
- 耐用品 / 消耗品两类库存模型
- 消耗品快速扣减，低于阈值时自动加入采购清单
- 采购清单手动添加、完成和删除
- 按家庭空间管理和查找物品
- 临期提醒、库存概览与家庭物品估值
- 响应式布局：手机底部导航、PC 宽屏侧栏和多列卡片
- 深色模式、页面转场、弹层和微交互动效
- PWA Manifest，可从浏览器添加到主屏幕
- SQLite / MySQL 双数据库部署方案
- Docker 健康检查、持久化存储和 GitHub Actions 多架构镜像发布

## 技术栈

- Next.js 16 + React 19 + TypeScript
- Prisma ORM
- Tailwind CSS 4
- Motion + Lucide Icons
- SQLite（默认）或 MySQL 8.4

选择单体 Next.js 是为了让家庭服务器部署只维护一个应用容器，同时保留完整的服务端 API 和后续扩展能力。Prisma 提供类型安全的数据访问，并让两种数据库使用同一套业务代码。

## 本地开发

推荐使用 Node.js 22 LTS（Prisma 6 的正式支持版本）。

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

访问 <http://localhost:3000>。`db:setup` 会创建 SQLite 数据库并写入演示数据；正式部署默认不会自动写入演示数据。

## Docker Compose（默认 SQLite）

首次本地构建：

```powershell
docker compose up -d --build
```

数据库存放在具名卷 `home_inventory_data`。访问 <http://localhost:3000>。

如需演示数据：

```powershell
$env:SEED_DEMO_DATA="true"
docker compose up -d --build
```

首次初始化后请将其恢复为 `false`，避免空库重建时再次写入示例。

## Docker Compose（MySQL）

先创建 `.env` 并修改密码：

```env
MYSQL_DATABASE=homeinventory
MYSQL_USER=homeinventory
MYSQL_PASSWORD=replace-with-a-strong-password
MYSQL_ROOT_PASSWORD=replace-with-another-strong-password
```

然后启动：

```powershell
docker compose -f docker-compose.yml -f docker-compose.mysql.yml up -d --build
```

## 使用 Docker Hub 镜像

把 `HOME_INVENTORY_IMAGE` 设置为发布后的镜像地址：

```powershell
$env:HOME_INVENTORY_IMAGE="你的DockerHub用户名/home-inventory:latest"
docker compose up -d
```

## GitHub 自动发布到 Docker Hub

仓库已包含 `.github/workflows/docker-publish.yml`。在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 添加：

- `DOCKERHUB_USERNAME`：Docker Hub 用户名
- `DOCKERHUB_TOKEN`：Docker Hub Access Token（不要使用账号密码）

推送到 `main` 会发布 `latest` 和 `sha-*`；推送 `v*` 标签会发布对应版本，同时构建 `linux/amd64` 与 `linux/arm64` 镜像。

## 常用环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `3000` | 宿主机访问端口 |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite` 或 `mysql` |
| `DATABASE_URL` | SQLite 文件路径 | Prisma 数据库连接串 |
| `SEED_DEMO_DATA` | `false` | 容器启动时是否写入演示数据 |
| `HOME_INVENTORY_IMAGE` | `home-inventory:local` | Compose 使用的应用镜像 |
| `OSS_REGION` | 空 | 阿里云 OSS Region |
| `OSS_ENDPOINT` | 空 | 自定义 OSS Endpoint |
| `OSS_BUCKET` | 空 | OSS Bucket 名称 |
| `OSS_ACCESS_KEY_ID` | 空 | OSS AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | 空 | OSS AccessKey Secret |
| `OSS_PUBLIC_BASE_URL` | 空 | Bucket 或 CDN 的公开访问域名 |

直接运行 Docker 镜像且未设置数据库变量时，会自动使用 `file:/app/data/home-inventory.db`。请挂载 `/app/data` 目录，否则删除容器后 SQLite 数据也会丢失。

## 数据备份

SQLite 部署只需定期备份 `home_inventory_data` 卷中的 `home-inventory.db`。MySQL 部署建议使用 `mysqldump` 定期导出，并将备份保存在容器卷之外。

## 安全说明

当前版本定位为家庭局域网内的单用户 MVP，尚未加入账号与权限系统。不要直接把端口暴露到公网；如需远程访问，建议先放在带身份认证的反向代理或 VPN（如 Tailscale）之后。多用户登录、家庭成员权限与操作审计适合作为下一阶段功能。
