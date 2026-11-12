# Project Improvements Summary

## 本轮:首屏优先级 + 录入体验 + 排版质感(桌面/移动实测)

手段:先以第一次使用者的身份把「录入物品」整条路径走一遍(见 `output/findings/entry.md`,12 条 P1/P2),再按「主界面只说一件事 / 辅助信息默认折叠 / 关键时刻才弹出」重构首屏;排版与质感改在 `globals.css`。所有结论都来自构建后真实点击 + DOM 几何/计算样式/网络请求实测。

### 顶部进度效果(翻页与加载)

- 新增 `src/components/top-progress.tsx`,在 `layout.tsx` 的 body 里挂一次:贴顶 2px、`z-index: 200`(高于此前最高 120 的弹窗)、`pointer-events: none`,空闲时 `aria-hidden="true"` 且不占位。
- 三个触发源合并计数:真实路由跳转(`usePathname`)、应用内视图切换(自定义事件 `home-inventory:progress`,由 `openView` 在切换前后派发 start/done)、在途请求(包一层 `window.fetch` 计数,卸载时还原原函数)。任一来源活跃就保持运行,互不打断。
- 实测(`scripts/verify-entry-fixes.mjs`):空闲 `aria-hidden=true / pointer-events=none / z-index=200 / top=0 / height=2px`;派发 start 后 260ms 条宽 175px 且 `aria-hidden=false`;点「物品」切换视图后 60ms 一次的采样立刻出现运行态;视口顶部中点的 `elementFromPoint` 命中内容区而不是进度条(不抢顶栏点击);`prefers-reduced-motion` 与应用内「减少动效」下不做宽度动画。

### 主界面先说清「现在最该做什么」

- 概览顶部换成「最需要做的事」卡片:按 已过期 > 快到期 > 需要补货 的顺序只挑一件,给一句结论 + 一个主按钮(处理这件 / 现在处理 / 加入采购清单 / 盘点一次),空库时是「先录入家里的第一件物品」;超过一件时旁边给「全部 N 项」。原来顶部是「家庭概况 + 大数字 + 4 个统计块」,看完不知道下一步做什么。
- 删掉与卡片重复的渐变提醒横幅(原先同屏两处讲同一件事);低库存/待采购/估算价值降级为卡片底部一行小字。
- 「家庭消费」「更多待处理事项」改为默认折叠的 `<details>`(实测 `open=false`);侧栏默认折叠(实测导航按钮文字为空且有「展开侧栏」按钮);移除侧栏「今日小结」占位卡。
- 辅助信息只在关键时刻自动弹出:库里有已过期物品时,打开应用自动弹一次「提醒中心」,用 `home-inventory-expiry-notice-<日期>` 记一天一次(实测:建一条过期物品后刷新 → 自动弹出;再刷新 → 0 个弹窗)。

### 移除示范数据

- `prisma/seed.ts` 不再写入任何示范物品/空间/采购/消费记录(保留 `SEED_DEMO_DATA` 的读取但已无写入语义),脚本仍可幂等执行且退出码 0。
- `docker-compose.yml` 里已无用的 `SEED_DEMO_DATA` 透传删除;README 里「首次启动会自动准备示范数据」的相关表述全部清理。
- 现有库里的示范数据已清空(items 5→0、locations 4→0、shoppingItems 3→0,删除前备份在 `output/db-backup-before-demo-removal-*`)。

### 录入物品:走查出的 12 条全部修完(5 个 P1 + 7 个 P2)

- **数量填 0 也能保存、保存后哪个列表都看不到**:列表只渲染 `quantity > 0` 的物品,所以提交前就拦下并提示「数量至少填 1。如果东西已经用完,建议先加入采购清单,买到之后再录入。」,不发请求(实测 POST=0)。
- **双击「快速保存」生成两条重复物品**:提交锁改成只在失败时释放,成功路径一直锁到弹层卸载(实测间隔 140ms / 300ms 双击 → POST=1)。
- **单价输入 `.` 之后表单永久卡死**:校验全部移到上锁之前,非法单价那条 `return` 不再把锁留在 true(实测:非法价阶段 POST=0 → 改对价格后 POST=1 且弹窗关闭)。
- **非液体消耗品的「剩余量」白填**:滑块条件从「所有消耗品」改成「液体」,与卡片上的刻度、补货逻辑一致(实测:单位=件 无滑块、单位=瓶 有滑块)。
- **计数单位的小数被静默四舍五入**:数量改成字符串态,输入过程中保持原值,失焦才归一,并在字段下写明「只能填整数(件 / 盒 / 台按整个计数)」或「可以填小数,例如 2.5」(实测输入 2.5 → 失焦 3 且提示可见)。
- 数量可以真正清空(此前清空立刻回填 0,再输入变成 `02.5`);数量补上 `*` 必填标记;图片上传先按类型/体积校验,并把浏览器的英文报错换成中文(实测上传 .txt → 「只支持 JPG / PNG / WebP / GIF 图片,这个文件不是图片」),「最大 5MB」文案改为「选图后自动压缩」以与真实行为一致。
- 可选图片区从首屏移到「数量/单位」之后并默认折叠(实测 数量 y=510 < 图片区 y=598);Escape / 点遮罩 /「取消」在已填内容时会先问「放弃这次的填写?」,选「继续填写」内容保留。
- 底部操作条改 `sticky bottom-0`;弹层监听 `visualViewport`,软键盘弹起时按可视高度收高度,保存键不再被留在键盘后面。
- 名称输入补 `id` + `htmlFor`(此前 `input.labels.length = 0`,读屏不播报)。
- 复核审计报告里「深色说明文字对比度 4.33:1」:用实测 RGB(`#a0aabd` on `#1b2433`)按 WCAG 公式算是 **6.67:1**,已达标,因此没有改主题 token —— 避免为了一个算错的数字动整块暗色配色。

### 排版与高级感(globals.css)

- 标题层级:流体 `clamp` 字号,移动端 26px/29.9 → **27.06px/33.83**,1280 宽维持 36px/45;字距 -0.011em、行高 1.25、`text-wrap: balance`。
- 阅读节奏:正文行高 24 → **26.4px**(1.65),描述行宽 66ch(桌面 541.9px);全局 `tabular-nums`,数字不再跳动。
- 质感:卡片阴影 1 层 → **4 层**(贴地 + 环境 + 主题 `--shadow-sm` + 1px 内高光)+ 发丝级次级分隔线(`--hairline` 由主题 `--border` 派生,深色自动适配);圆角 6 档收敛为 3 档(8/12/16);主按钮双层阴影 + 按下态。
- 节奏与触控:间距统一到 4px 基准 token;输入框 48 → 50px 高;可点控件最小边 36 → **40px**(`<40px` 控件数 3 → 0);`document.documentElement.scrollWidth` 等于视口宽(390/390、1280/1280,深色同),无横向溢出。

### 回归验证

- `scripts/verify-experience.mjs`:**37 项断言全绿** —— 静态深色 token 一致性、弹窗焦点/滚动锁、dashboard 请求计数、搜索浮层遮挡、应用内确认框、404、`/items/[id]` 鉴权、独立路由深色回退、触控尺寸、只读账号、双击去重、公开接口限流、500 错误页等。本轮顺手修了探针自身的两处不稳定:欢迎引导可能比导航栏晚一步挂载导致点击被遮(改成先等它再关);库里不再有示范数据时那条 `/items/[id]` 断言会假失败(改成自动建一条临时物品,检查完永久删除)。
- 新增 `scripts/verify-entry-fixes.mjs`:**35 项断言全绿** —— 逐条覆盖上面 12 条录入修复,外加顶部进度条(空闲/运行/不抢点击)与首屏(一句话结论、旧横幅已移除、消费面板折叠、侧栏折叠、过期时自动弹出且当天只弹一次)。
- 干净库上复跑:items 0 / locations 0 / shoppingItems 0 / priceRecords 0 / 账号只剩 `bgs`,探针账号、临时物品与其价格/活动记录全部清理。


## 深度体验优化(本轮:桌面 + 移动 + 流程走查驱动)

手段:真实启动生产构建,用 Playwright 以 1440×900 / 390×844 / 360×640 / 430×932 / 740×360、浅色+深色逐屏走查,全部结论来自 DOM 几何 / 计算样式 / elementFromPoint / 网络请求实测,不靠肉眼判图。逐条证据见 `output/findings/desktop.md`、`output/findings/mobile.md`。

### 阻断与功能性缺陷

- **任务功能整体不可用**:`TasksView` 的主按钮「安排任务」漏写 `onClick={onAdd}`,点击 0 请求 0 弹窗;任务为空时没有第二个入口,用户永远建不了任务(实测点击 2 次无反应)。已补 `onClick`,并给 `TaskModal` 的保存失败从 `alert()` 改为表单内错误提示。
- **批量 AI 识别是无入口死代码**:`BatchAiImport`(上传最多 8 张图 / 小票识别 / 链接导入)完整实现但从未被 import。已在物品页头部补「批量识别」入口并接入弹窗。
- **物品详情页 `/items/[id]` 无鉴权**:未登录 GET 返回 200 且泄露价格、备注、AI 识别信息,按物品编号也能查。已在页面内做 `currentUser()` 校验,未登录 `redirect("/")`(二维码分享对已登录家人仍然可用)。

### 键盘与焦点(此前全站弹层都缺)

- 新增 `src/lib/dialog-focus.ts`:统一管理 `[role=dialog][aria-modal=true]`,打开时把焦点移入弹窗(有 `autoFocus` 字段则保留)、Tab/Shift+Tab 在弹窗内循环、关闭后焦点归还触发元素,并在弹窗打开期间锁定背景滚动(去掉滚动条宽度补偿,避免页面跳动)。
- 修复前实测:8 个弹层打开后焦点全部留在触发按钮;Tab 有 15/28、19/26、23/26、28/28 次走进被遮住的页面控件;关闭后焦点掉到 `body`;弹层打开时滚轮能把背景滚走 400–624px。修复后 33 项验收断言全绿。
- 欢迎引导补 `role="dialog" aria-modal="true"`(此前 `dialogCount=0`,基线探针因此把它整个漏检)。
- AI 助手面板补 `role="dialog"`、Escape 关闭、点空白关闭,关闭键 32×32 → 44×44(此前唯一退出路径是一个 32×32 的按钮)。
- 右键菜单支持键盘:打开即聚焦首个菜单项,↑/↓/Home/End 带环绕,关闭后焦点还给触发元素。
- `useEscapeClose` 不再在 render 期间写 ref(修掉 `react-hooks/refs` 错误)。

### 破坏性操作与确认

- 新增 `src/components/confirm-dialog.tsx`(`ConfirmProvider` + `useConfirm()`,Promise API、可排队、Escape 取消、危险操作默认聚焦取消)。替换掉主界面全部原生 `confirm()`/`alert()`/`window.prompt()`:物品移入回收站、采购项删除、批量移入回收站、任务删除、空间删除,以及空间缩略图(改为编辑弹窗里的正常字段)。
- 采购项删除此前无确认、无提示、静默消失;现在有确认 + 成功 toast。

### 性能与网络

- 导航、类型筛选、分类切换此前每个动作都整包重取 `/api/dashboard`(实测 7 次切视图 = 7 次请求,单次响应 9.2KB)。筛选本就是前端 `useMemo`,现在:切视图走 15s TTL 的 `ensureFresh()` 并合并并发请求,筛选完全不发请求。修复后实测 7 次切视图 = 1 次请求,筛选 = 0 次。
- AI 助手历史轮询从「无条件每 12s」改为「仅在标签页可见时轮询」,后台标签不再持续唤醒服务端。

### 搜索与弹层遮挡

- `SearchBox` 清空后不再把 suggestions 退化成「全部物品前 6 条」并压住筛选行(实测点「消耗品」会被浮层抢走、搜索词被静默改成某个物品名)。现在空值时不列物品、无内容不渲染浮层,并加 `max-h-72 + overflow-y-auto`。
- 批量编辑的下拉里「清除位置」与「不修改」共用 `value=""`,选了立刻回弹、永远清不掉位置;现在用 `__clear__` 哨兵映射 `locationId: null`。

### 移动端

- `viewport` 去掉 `maximum-scale=1`,恢复双指缩放(WCAG 1.4.4)。
- 底部留白改为 `--bottom-nav-space + env(safe-area-inset-bottom)`;`/items/[id]`、`/consume/[id]` 两个独立路由设为 0(此前白空 112px),并给 `/consume/[id]` 补「返回归物」、给 `/items/[id]` 返回链接补 44px 高度。
- 独立路由补 `prefers-color-scheme` 深色回退(此前系统深色下详情页始终浅色 `#f6f7fb`)。
- `.icon-action` 32×32 → 40×40(顺带修掉 6 按钮卡片行的文字溢出/重叠);弹窗与助手关闭键 44×44;设置页「踢出此设备」28→44、「显示密码」「添加成员」32→44、开关 checkbox 13→20(整行 label 44px 为触点)。
- 助手输入框去掉 `nowrap/overflow:hidden`,长问题不再被横向裁掉(42 字:scrollW 685/clientW 174 → 174/174)。
- 悬浮球在下滚时自动让开并不再拦截点击(此前会压住卡片操作行);弹层高度改用 `dvh`,聚焦时把输入框滚入可视区。
- 新增中文 `src/app/not-found.tsx`(此前是英文 404 且无返回入口)。

### 数据安全与失败反馈(流程走查发现)

- **公开扫码接口补频率限制**:`POST /api/public/consume` 按设计无需登录(贴在盒子上的二维码),但此前拿到 `itemId` 就能无限次扣库存。现按 IP 加 30 次/分钟上限,超出返回 429 与「请 N 秒后再试」。实测:第 31 次起返回 429。
- **双击「快速保存」不再产生重复物品**:此前 120ms 内点两次会发出两次 `POST /api/items`、生成两条同名记录(`saving` 状态来不及生效)。现在用 `useRef` 同步锁,第二次点击直接返回。实测:同名记录 1 条(修复前 2 条)。
- **只读账号不再看到写入口**:此前 VIEWER 登录后仍显示「录入物品」和 26 个「编辑物品」、9 个「用掉」,点了才被服务端 403 拒绝,既误导也白跑一次请求。现在视图层按角色渲染,并显示「只读账号:可以查看和搜索,不能新增或修改数据。」实测:写入口 0 个。
- **自动备份改为管理员专属**:`POST /api/backup/auto` 此前任何登录用户都能触发(会写磁盘和活动日志),与导出/恢复的管理员限制不一致;现在与 `/api/backup` 一致,并且前端只在管理员会话下调用它。
- **中文校验与错误边界**:物品名称超长此前透出英文 `String must contain at most 80 character(s)`,现在提示「物品名称最多 80 个字」并给输入框加 `maxLength={80}`;新增 `src/app/error.tsx` 与 `global-error.tsx`,主接口 500 时不再显示 Next 的英文「This page couldn't load」,而是中文「页面没能加载出来 + 重试 / 返回归物」。

### 回归验证

- `scripts/verify-experience.mjs`:**38 项验收断言**,覆盖上述每一条(任务入口、焦点/滚动锁、请求计数、浮层遮挡、助手关闭路径、应用内确认框、批量识别入口、清除位置、右键菜单键盘、404、详情页鉴权、深色回退、触控尺寸、viewport 缩放、输入框换行、悬浮球避让、只读账号写入口、双击去重、公开接口限流、500 错误页),全部通过。运行前需要 `PROBE_PASS=<管理员密码>` 并执行 `node output/experience/make-viewer.cjs` 创建只读探针账号(该账号用完即删)。
- `scripts/dogfood.mjs`(新增):多视口 × 明暗主题的逐屏走查,自动收集文字截断、控件遮挡、横向溢出、小目标、控制台错误与失败请求。
- 已知未彻底解决:`740×360` 横屏下内容区仅 285px、底部导航占 21%,卡片底部的操作行在滚动中仍可能落到固定导航条下方(固定底栏的固有代价,实测滚到底都能躲开);彻底解决需要改版(操作行上移 / 横屏把导航收成图标条)。

## 忘记密码(一次性恢复码)

部署在家庭 NAS 上没有邮件服务,所以「忘记密码」没有走「发链接到邮箱」那条路,而是用**一次性恢复码**:

### 流程

- 恢复码在「设置 → 账号与家庭成员 → 密码与恢复码」生成,生成时要求输入**当前密码**确认身份 —— 只有已登录会话、不知道密码的人拿不到恢复码。
- 登录页「忘记密码?」→ 用户名 + 恢复码 + 新密码 → 重置成功。
- 管理员创建成员、重置成员密码时,服务端在**同一个事务里**为该成员生成恢复码,和初始密码一起一次性展示,方便直接交给家人。
- 成功页会给出**轮换后的新恢复码**:旧码在重置成功的一刻作废(真正的单次使用),新码只在那一次响应里出现。

### 安全设计

- 格式:16 位、取自去掉 `I/O/0/1` 的 32 字符表(约 80 位熵),展示为 `XXXX-XXXX-XXXX-XXXX`;输入忽略大小写、分隔符与空格。
- 存储:与登录密码同一套 scrypt 哈希(`salt:hash`),数据库里没有明文;`GET /api/auth/recovery` 只返回「是否设置过 + 生成时间」。
- 角色例外:只读账号(VIEWER)也可以生成/轮换**自己**的恢复码 —— 恢复码只能重置自己的密码,既不提权也碰不到别人的数据,而只读账号同样需要能找回密码。这是刻意保留的例外,已在 `src/app/api/auth/recovery/route.ts` 注释里写明。
- 反向代理注意:按 IP 的那一层读 `X-Forwarded-For`,如果直接把端口暴露到公网而不在代理上剥离该头,攻击者可以伪造它来换桶;此时仍有按用户名与全局两层兜住。部署建议见 README。
- 重置成功后会清空该账号的**全部登录会话**,所有设备必须用新密码重新登录。
- 限流:重置接口三重限流 —— 按 IP 10 次 / 10 分钟、按用户名 5 次 / 10 分钟、全局 60 次 / 10 分钟,三层文案各不相同(「当前网络尝试次数过多」/「该账号尝试次数过多」/「服务器正忙」),便于排障;生成恢复码按账号 5 次 / 分钟。按用户名这一层不读 `X-Forwarded-For`,是防定向爆破的主控制。
- 防用户名枚举:账号不存在、未设置恢复码、恢复码错误都返回同一个 401 与同一句「用户名或恢复码不正确」,并且对不存在/未设置的情况同样跑一次 scrypt,让耗时也一致。
- 审计:每次均写入 `LoginRecord`(成功与失败都记),生成恢复码与重置密码分别写 `ActivityLog`(`RECOVERY_CODE_CREATE` / `PASSWORD_RESET`)。

### 运维兜底

- `npm run db:reset-password -- <用户名> <新密码>`:管理员连恢复码都没保存又忘了密码时,在部署机器上直接改写密码哈希、踢掉该账号全部会话,并打印一个新恢复码。
- 脚本复用 `src/lib/account-auth.ts` 的 `hashPassword` 与 `src/lib/password.ts` 的 `PASSWORD_MIN_LENGTH`,不另写一套哈希规则。

### 验证

- 验证:独立验证同学产出 `output/findings/recovery.md`(83 条断言 / 81 通过,2 条失败经复核为探针自身缺陷并已复测更正);Lead 侧自查:`output/experience/lead-recovery-smoke.mjs` 走通「设置页生成 → 登录页忘记密码 → 重置 → 新码轮换 → 旧密码失效 → 新密码可登录」9/9,既有 38 项体验验收断言在新构建上 38/38(无回归)。验证中发现的 3 条真实缺陷已处理:按 IP 限流可被伪造 XFF 绕过(已加全局层 + 文档说明)、只读账号可生成自己的恢复码(判定为刻意例外并注释)、缺字段英文提示(已补中文 `required_error`)。

## 已完成

### 搜索历史

- `src/components/search-box.tsx`：独立搜索框组件，带历史下拉与快捷跳转。
- `src/components/search-history.tsx`：展示最近搜索，支持一键清除。
- `src/app/api/search-history/route.ts`：GET 读取 / POST 写入 / DELETE 清空。
- `prisma/schema.prisma`：新增 `SearchHistory` 模型。
- 已在 `src/components/inventory-app.tsx` 中接入（桌面顶栏 + 移动端物品页）。

### 批量编辑

- `src/components/batch-edit-modal.tsx`：批量编辑弹窗，支持类型、单位、起始数量、分类、位置。
- `src/lib/validation.ts`：`bulkItemPatchSchema` 已包含 `type` / `unit` / `minQuantity` 字段。
- 已在 `src/components/inventory-app.tsx` 中接入（物品页多选工具条 → “批量编辑”）。

### 账号与登录体验

- `src/components/auth-gate.tsx`：登录/注册页重做为左右分栏布局，含品牌区、表单区、密码强度、可见性切换、记住我和服务不可用重试页。
- `src/components/account-settings.tsx`：创建成员账号表单、初始密码凭据面板（可复制）、重置密码弹窗、已登录设备与踢出。
- `src/app/api/auth/login/route.ts`：登录接口支持 `remember`，关闭时使用会话 Cookie。
- `src/lib/password.ts`：统一的密码生成与强度评估。
- `src/app/globals.css`：新增 `.input-icon` / `.input-icon-end`，修复图标与输入文字重叠。

### 界面图标对齐

- 根因：`globals.css` 中 `.btn-ghost` / `.btn-primary` / `.input` 带 `min-height: var(--control-height)`，而 `min-height` 无法被 Tailwind 的 `size-*` / `h-*` 覆盖，导致 `size-8` 按钮实际渲染成 32x44 的竖长方框，图标在框内偏上。
- 修法：为所有方形按钮补上与 `size-*` / `h-*` 匹配的 `min-h-*`，让最小高度与显式高度一致（响应式写法如 `min-h-10 md:min-h-9`）。
- 涉及文件：`inventory-app.tsx`、`ai-assistant-modal.tsx`、`ai-chat.tsx`、`batch-ai-import.tsx`、`batch-edit-modal.tsx`、`print-studio.tsx`、`recycle-bin-modal.tsx`、`data-tools.tsx`、`account-settings.tsx`、`search-box.tsx`。
- `search-box.tsx` 的搜索图标改用 `top-1/2 -translate-y-1/2`，去掉写死的 `top-[22px]` 偏移。
- 回归结果：6 个视图 + 5 个弹窗 + 移动端共 300 余个 `svg`，图标槽位居中偏差均为 0（阈值 1.5px）；输入框前后缀图标与原生 `select` 行高同样无偏移。

### CSS 分层

- `globals.css` 改为 `@layer theme, base, components, utilities;` 分层，组件类只负责基础外观，Tailwind 工具类可以正常覆盖。
- `font: inherit` 曾压死 `text-xs` / `font-bold`，已移除。
- 少数需要保留组件契约的声明（卡片圆角、次要按钮文字色、危险按钮文字色）留在 `@layer components` 之外作为显式锁定。

### 物品卡片标题

- 问题：带「需补货」徽章的卡片，标题被压成「洗…」「牛..」，物品名基本不可读。
- 原因：标题行是 `flex min-w-0 items-center gap-1.5`，名称按钮 `min-w-0 truncate` 会一直让位给数量、类型和「需补货」三个 `shrink-0` 徽章。
- 修法：标题行改为 `flex-wrap` 并加 `gap-y-1`，空间不足时徽章换到第二行，名称保留完整；「需补货」徽章补 `shrink-0`。

### 弹窗与键盘体验

- 此前全项目弹窗都没有 Escape 关闭（只有右键菜单和搜索框处理了 Escape），键盘用户打开弹窗后只能点遮罩或按钮退出。
- 新增 `src/lib/use-escape-close.ts`：共享的 Escape 监听，内部维护挂载栈，嵌套弹窗（如物品弹窗上的图片预览）只有最内层响应。
- 接入范围：`inventory-app.tsx` 的共用 `Modal`、`WelcomeModal`、`QuickLocationDialog`、图片预览，以及 `recycle-bin-modal.tsx`、`print-studio.tsx`、`batch-edit-modal.tsx`、`batch-ai-import.tsx`、`ai-assistant-modal.tsx`。
- 共用 `Modal` 补上 `role="dialog"` / `aria-modal="true"` / `aria-label`，其余独立弹窗同样补了对话框语义。
- 共用 `Modal` 的关闭按钮原先只有 `sm:hidden`，桌面端没有可见关闭入口，现改为所有断点常显。

### 可访问名称

- 修复 4 处没有可访问名称的控件：顶栏「录入物品」（宽度小于 1100px 时只剩 `+` 图标）、采购清单的勾选与删除按钮、数据工具里的「添加成员」图标按钮。
- 采购清单的删除按钮原本要 `group-hover` 才出现，触屏设备上不可见却可点，现补 `max-md:opacity-100`。

### 移动端底部遮挡

- 右下角可拖动的助手悬浮球会压住列表最后一行的操作按钮（例如采购清单最后一行的删除）。
- 移动端 `body` 底部留白从 `76px` 提到 `112px`。实测：76px 时最后一行删除按钮与悬浮球重叠，112px 及以上不再重叠，且该结论与视口高度无关。

## 验证脚本

`scripts/` 下的脚本用于本地回归，需要可用的 Chromium 与 Playwright：

- `verify-auth.mjs`：多分辨率 / 明暗主题截图 + 元素重叠检测。
- `verify-auth-flows.mjs`：注册、登录、记住我、错误提示链路。
- `verify-account-ui.mjs`：管理员面板、成员创建、凭据复制、重置密码、成员登录。
- `prepare-auth-test.mjs`：临时数据库的用户管理（`clear` / `reset-admin` / `set-password`）。
- `probe-icon-only.mjs`：遍历各视图的纯图标按钮，检查图标是否在按钮内居中。
- `probe-modals.mjs`：检查欢迎引导、提醒、AI 助手、录入物品、设置、回收站、盘点等弹窗内的图标按钮。
- `probe-input-icons.mjs`：检查输入框内覆盖图标的垂直偏移。
- `probe-svg-center.mjs`：通用扫描各视图与弹窗中的全部 `svg`，校验图标在图标槽位内是否居中。
- `probe-box-icons.mjs`：检查输入框前后缀图标是否落在字段中线，以及原生 `select` 的内容行高是否对齐。
- `probe-modal-dismiss.mjs`：校验弹窗能打开、带 `role="dialog"` / `aria-modal`、桌面有可见关闭按钮、按 Escape 能关闭。
- `audit-experience.mjs`：全流程走查，汇总控制台报错、失败请求和各视图的接口请求数。
- `shoot.mjs` / `shoot-dark.mjs`：桌面与移动端、浅色与深色主题的整页截图。
- `snapshot-computed.mjs`：导出各视图的计算样式快照，用于改动前后对比。

## 后续建议

1. `src/components/inventory-app.tsx` 体积约 1000 行，建议按视图拆分为独立组件。
2. 账号设置目前仅管理员可见，成员无法自助修改密码，建议补一个面向所有角色的“我的账号”面板。
3. 物品搜索与筛选在前端全量数据上进行，数据量增长后建议改为服务端分页。
4. `prompt()` / `confirm()` 仍散落在主界面若干交互中，建议逐步替换为应用内弹窗。
5. 尚无自动化测试套件，可将 `scripts/` 下的验证脚本整理为 Playwright Test 用例并接入 CI。
6. 远程字体依赖外部 CDN，离线或内网部署时会有回退抖动，建议将字体文件本地化或改用系统字体栈。
