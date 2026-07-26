# 归物 HomeInventory

一个简单易用的家庭物品管理系统，帮助你知道家里有什么、放在哪里、什么时候需要补货或处理。

适合部署在家用服务器、NAS 或普通电脑上。默认使用 SQLite，无需单独安装数据库。

👉 [在线体验 HomeInventory](https://homeinventory-test.up.railway.app/)

## v0.0.5 更新

- 打印工作台支持以毫米设置标签宽高、上下/左右边距与行列间距；参数会自动保存。
- 标签内容会随较矮标签自动缩放，并限制在纸张可用宽度内，避免内容丢失或超出 A4。
- 支持指定“从第几行开始打印”，可继续使用已打印部分标签纸。
- 录入物品时可直接新建存放位置，创建后自动选中。
- 设置页优化为可折叠分组；AI 支持多个官方供应商预设、模型图标与模型列表拉取。
- GitHub Actions 会构建并发布 `linux/amd64`、`linux/arm64` Docker 镜像到 `34v0wphix/homeinventory`。

## 能做什么

- 记录物品、数量、分类、位置、图片和保质期
- 消耗品不足时自动加入采购清单
- 提醒临期、过期物品和冰箱温度异常
- 记录购买价格，查看本月消费和近 6 个月平均水平
- 生成物品二维码，支持 A4 批量打印
- 可选接入 OSS 图片存储和 OpenAI 兼容 AI 助手
- 手机和电脑均可使用，支持深色模式

## Docker Compose 部署（极空间 / 威联通 NAS）

Docker Hub 镜像 `34v0wphix/homeinventory:latest` 同时支持 `amd64` 和 `arm64`，可直接用于极空间、威联通等 NAS。在 NAS 的 Docker / Container Station 中新建 Compose 项目，粘贴以下内容并部署：

```yaml
services:
  home-inventory:
    image: 34v0wphix/homeinventory:latest
    container_name: home-inventory
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      # 设为 false 可关闭首次启动时的示范数据
      SEED_DEMO_DATA: auto
    volumes:
      # 把数据保存到 Compose 项目目录下，重建容器不会丢失
      - ./data:/app/data
```

部署完成后，在浏览器访问 `http://NAS_IP:3000`。若 3000 端口已被占用，将左侧端口改为其他未占用端口，例如 `"3100:3000"`，再访问 `http://NAS_IP:3100`。

<details>
<summary><strong>极空间 NAS</strong></summary>

在 Docker 应用中创建 Compose 项目，将上方 YAML 作为项目配置。建议将项目保存到一个方便备份的共享文件夹；其中 `./data` 会在该项目目录下创建并保存 SQLite 数据库。部署后可在容器详情中查看日志和运行状态。

</details>

<details>
<summary><strong>威联通 QNAP NAS</strong></summary>

打开 **Container Station**，新建应用 / Compose 项目并粘贴上方 YAML。建议把项目目录放在共享文件夹中，方便通过 File Station 备份 `data` 目录。Container Station 中显示容器运行后，使用 `http://NAS_IP:3000` 打开应用。

</details>

### NAS 更新镜像

在 Compose 项目的终端或 NAS SSH 中执行：

```bash
docker compose pull
docker compose up -d
```

这只会替换应用容器，`./data` 中的物品数据会保留。

## 从源码三步启动

电脑需要先安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。

```powershell
git clone https://github.com/tempppw01/HomeInventory.git
cd HomeInventory
docker compose up -d --build
```

浏览器打开：<http://localhost:3000>

首次启动时会自动准备少量示范数据，方便了解库存、提醒、采购和消费功能。已有数据时不会重复添加。

## 常用命令

```powershell
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f

# 更新代码并重新启动
git pull
docker compose up -d --build

# 停止服务，但保留数据
docker compose down
```

物品数据保存在 Docker 卷 `home_inventory_data` 中，正常更新或重建容器不会丢失。

## 可选设置

进入应用的“设置”页面，可以配置：

- AI 模型接口：可快捷选择 OpenAI、DeepSeek、火山引擎、阿里千问、Gemini 或 Claude 官方端点
- 阿里云 OSS：用于保存物品图片，并可指定 Bucket 内的存储目录

浅色、深色或跟随系统主题可直接在页面右上角切换。

如果 AI 接口运行在宿主机，而应用运行在 Docker 中，请使用 `host.docker.internal`，不要填写 `localhost`。

<details>
<summary><strong>不需要示范数据</strong></summary>

首次启动前执行：

```powershell
$env:SEED_DEMO_DATA="false"
docker compose up -d --build
```

</details>

<details>
<summary><strong>使用 MySQL</strong></summary>

在项目目录创建 `.env`：

```env
MYSQL_DATABASE=homeinventory
MYSQL_USER=homeinventory
MYSQL_PASSWORD=请修改为安全密码
MYSQL_ROOT_PASSWORD=请修改为另一个安全密码
```

然后启动：

```powershell
docker compose -f docker-compose.yml -f docker-compose.mysql.yml up -d --build
```

</details>

<details>
<summary><strong>本地开发</strong></summary>

需要 Node.js 22：

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

访问 <http://localhost:3000>。

</details>

<details>
<summary><strong>使用 Docker Hub 镜像</strong></summary>

```powershell
$env:HOME_INVENTORY_IMAGE="34v0wphix/homeinventory:latest"
docker compose up -d
```

仓库中的 GitHub Actions 可自动发布 Docker 镜像。需要在 GitHub Actions Secrets 中配置：

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

</details>

## 数据与安全

- SQLite 数据文件位于容器内的 `/app/data/home-inventory.db`
- 建议定期备份 `home_inventory_data` 卷
- 当前版本是家庭单用户模式，没有账号权限系统
- 不要直接将端口暴露到公网；远程使用建议配合 VPN、Tailscale 或带登录保护的反向代理

## 技术说明

项目使用 Next.js、React、TypeScript、Prisma 和 Tailwind CSS，可部署到 `linux/amd64` 与 `linux/arm64` 设备。

当前版本：`0.0.5`
