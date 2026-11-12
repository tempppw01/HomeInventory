# 归物 HomeInventory

一款面向家庭与 NAS 自托管的开源库存管理应用，帮助你记录物品与药品、管理保质期和补货，并安排家庭日常任务。

适合部署在家用服务器、NAS 或普通电脑上。默认使用 SQLite，无需单独安装数据库。

👉 [在线体验 HomeInventory](https://homeinventory-test.up.railway.app/)

## v0.0.8 更新

- 医药快捷视图只显示医药分类，不再混入无关分类标签。
- 物品与采购页面收敛为一个明确的“添加采购项”入口，减少重复操作。
- 医药 AI 助手聚焦说明书要点、适应症、常见用量和用药提醒，并明确提示以药品包装、药师或医生指导为准。
- 家庭任务支持按天、周、月或年重复；完成操作可撤销，避免误触后丢失原计划。
- AI 助手对话按账号保存并可跨设备继续，图片附件和待录入物品草稿也会保留。
- 管理员可查看账号登录设备并撤销其他设备会话；登录记录包含 IP、设备及成功或失败状态。
- 新增界面密度、动效、临期提醒、低库存提醒和每周盘点偏好设置。
- 登录后每天最多自动生成一次本地 JSON 备份；完整备份支持合并恢复，不会清空现有家庭数据。
- 登录与注册页重做为左右分栏的家居感界面：左侧说明产品价值，右侧完成操作。
- 用户名实时校验，密码带可见性切换、强度指示和“生成强密码”，提交时显示进度状态。
- 新增“记住我”开关：关闭时为浏览器会话 Cookie，关闭浏览器即失效；开启时保持 30 天。
- 服务不可用时展示专门的“连接不上服务器”提示与重试按钮，不再只有空白页。
- 管理员创建成员账号后可直接复制用户名和初始密码交给家人，密码仅显示一次。
- 管理员重置成员密码改用应用内弹窗，支持强度校验、生成强密码和错误提示。

## v0.0.7 更新

- 打印工作台支持以毫米设置标签宽高、上下/左右边距与行列间距；参数会自动保存。
- 标签内容会随较矮标签自动缩放，并限制在纸张可用宽度内，避免内容丢失或超出 A4。
- 支持指定“从第几行开始打印”，可继续使用已打印部分标签纸。
- 录入物品时可直接新建存放位置，创建后自动选中。
- 设置页优化为可折叠分组；AI 支持多个官方供应商预设、模型图标与模型列表拉取。
- GitHub Actions 会构建并发布 `linux/amd64`、`linux/arm64` Docker 镜像到 `34v0wphix/homeinventory`。
- 移除冰箱温度管理功能，物品管理聚焦库存、消耗与补货。
- 增加可下载的完整 JSON 备份（不包含 AI/OSS 密钥），并增强导入校验与操作记录。
- 首次打开时创建管理员账号，支持成员和只读账号登录。
- 管理员可在设置中直接创建成员账号，无需邮箱服务；账号密码仅保存为不可逆哈希。

## 能做什么

- 记录物品、数量、分类、位置、图片和保质期
- 消耗品不足时自动加入采购清单
- 提醒临期、过期物品
- 记录购买价格，查看本月消费和近 6 个月平均水平
- 管理清洁、保养等周期性家庭任务，并撤销误完成操作
- 生成物品二维码，支持 A4 批量打印
- 消耗品标签可同时提供“查看”和“消耗 1 个单位”二维码；扫码消耗无需登录，库存不足时自动停止并记录操作，管理员可在设置中查看记录并撤销
- 图片默认保存到本地目录，也可切换 OSS 或本地 + OSS 双写
- 可选接入 OpenAI 兼容 AI 助手
- 支持管理员、成员和只读账号；可查看登录记录并管理已登录设备
- 手机和电脑均可使用，支持深色模式
- 忘记密码时可用一次性恢复码在登录页自助重置,不需要邮箱服务

## Docker Compose 部署（极空间 / 威联通 NAS）

Docker Hub 镜像 `34v0wphix/homeinventory:latest` 同时支持 `amd64` 和 `arm64`，可直接用于极空间、威联通等 NAS。在 NAS 的 Docker / Container Station 中新建 Compose 项目，粘贴以下内容并部署：

```yaml
version: "3.8"

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
      # Docker / Container Station 管理的数据卷，重建容器不会丢失
      - home_inventory_data:/app/data

volumes:
  home_inventory_data:
```

部署完成后，在浏览器访问 `http://NAS_IP:3000`。若 3000 端口已被占用，将左侧端口改为其他未占用端口，例如 `"3100:3000"`，再访问 `http://NAS_IP:3100`。

<details>
<summary><strong>极空间 NAS</strong></summary>

在 Docker 应用中创建 Compose 项目，将上方 YAML 作为项目配置。`home_inventory_data` 会由 Docker 管理，部署后可在容器详情中查看日志和运行状态。

</details>

<details>
<summary><strong>威联通 QNAP NAS</strong></summary>

打开 **Container Station**，选择“创建应用”，将下方完整的 Docker Compose 编排粘贴进去后直接部署：

```yaml
version: "3.8"

services:
  home-inventory:
    image: 34v0wphix/homeinventory:latest
    container_name: home-inventory
    restart: unless-stopped
    ports:
      # 威联通常见服务会占用 3000，外部端口改用 3100
      - "3100:3000"
    environment:
      SEED_DEMO_DATA: auto
    volumes:
      # 威联通 Container Station 默认绑定卷
      - /share/Container/homeinventory:/app/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: home-inventory-cloudflared
    restart: unless-stopped
    depends_on:
      - home-inventory
    # 将 YOUR_CLOUDFLARE_TUNNEL_TOKEN 替换为 Cloudflare Tunnel 令牌
    command: tunnel --no-autoupdate run --token YOUR_CLOUDFLARE_TUNNEL_TOKEN
```

数据会保存到威联通的 `/share/Container/homeinventory`，容器内路径固定为 `/app/data`。Container Station 显示容器运行后，使用 `http://NAS_IP:3100` 打开应用。`cloudflared` 通过出站连接提供公网访问，不需要在路由器上做端口转发。

</details>

### Cloudflare Tunnel 设置

1. 先将自己的域名接入 Cloudflare，并在 [Cloudflare One](https://one.dash.cloudflare.com/) 打开 **网络 → Tunnels（隧道）**，创建一个 **Cloudflared** Tunnel。
2. 在 Tunnel 的 Docker 安装步骤中复制 `--token` 后面的令牌，替换威联通 Compose 中的 `YOUR_CLOUDFLARE_TUNNEL_TOKEN`。令牌等同于连接凭据，只保存在 NAS 的 Compose 配置中，不要提交到 GitHub。
3. 为该 Tunnel 添加 **Public Hostname**，例如 `inventory.example.com`；服务类型选择 **HTTP**，服务地址填写 **`http://home-inventory:3000`**。这是 Compose 内部服务名和容器端口，不要填写 NAS IP、`localhost` 或外部的 `3100` 端口。
4. 部署后访问 `https://inventory.example.com`。建议在 Cloudflare Zero Trust 的 **Access → Applications** 中为该域名添加登录策略，避免家庭库存直接公开到互联网。

如果使用仓库中的本地 Compose，可在 `.env` 中设置 `CLOUDFLARE_TUNNEL_TOKEN`，然后执行：

```bash
docker compose --profile cloudflare up -d
```

### NAS 更新镜像

在 Compose 项目的终端或 NAS SSH 中执行：

```bash
docker compose pull
docker compose up -d
```

这只会替换应用容器，数据卷中的物品数据会保留。

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
- 图片存储：默认本地目录，也可选择阿里云 OSS 或本地 + OSS 双写
- 图片上传支持 JPG、PNG、WebP、GIF；浏览器会自动压缩，最终限制 5MB

浅色、深色或跟随系统主题可直接在页面右上角切换。

如果 AI 接口运行在宿主机，而应用运行在 Docker 中，请使用 `host.docker.internal`，不要填写 `localhost`。本地图片会保存在 Docker 卷中的 `/app/data/uploads`。

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
- 使用数据库账号登录；管理员可在“设置 → 账号与家庭成员”中创建成员或只读账号
- 角色分为管理员、成员和只读；只读账号不能修改数据，系统设置仅管理员可修改
- 不要直接将端口暴露到公网；远程使用建议配合 VPN、Tailscale 或带登录保护的反向代理

### 忘记密码怎么办

本项目不依赖邮箱服务,所以找回密码用的是**一次性恢复码**。按下面的顺序处理:

1. **自己在登录页重置**:登录页点「忘记密码?」,输入用户名 + 恢复码 + 新密码即可。重置成功后旧恢复码立即失效,页面上会给出**新的恢复码**。恢复码在「设置 → 账号与家庭成员 → 密码与恢复码」里生成,生成时需要用当前密码确认身份,**只显示一次**,请抄在纸上或存进密码管理器。
2. **请管理员重置**:管理员在「设置 → 账号与家庭成员」里给成员重置密码,重置时会同时给出新的恢复码,可以直接发给对方。
3. **管理员自己也进不去**:到部署这套系统的机器上执行

   ```bash
   npm run db:reset-password -- admin '新的安全密码'
   ```

   这条命令直接改写数据库里的密码哈希,并踢掉该账号的所有登录会话(所有设备都要重新登录),同时打印一个新的恢复码。它比走接口重置更强,请只在本机使用。

恢复码只保存不可逆哈希(scrypt,与登录密码同一套),重置成功后立即轮换;重置失败不会区分「用户不存在」和「恢复码不对」。重置接口有按 IP、按账号、按全局三层限流,详见下方部署提示。
> 部署提示:重置接口按 IP、按账号、按全局三层限流。按 IP 这一层读 `X-Forwarded-For`,如果你把服务直接暴露到公网,请在反向代理上剥离或改写这个头(例如 Nginx `proxy_set_header X-Forwarded-For $remote_addr;`),否则这一层形同虚设 —— 但按账号(5 次/10 分钟)与全局(60 次/10 分钟)两层仍然生效。

## 技术说明

项目使用 Next.js、React、TypeScript、Prisma 和 Tailwind CSS，可部署到 `linux/amd64` 与 `linux/arm64` 设备。

当前版本：`0.0.8`
