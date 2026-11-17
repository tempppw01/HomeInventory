# 镜像体积优化要点(见文末「体积账」):
# 1) init-tools 只装 prisma + tsx 两个命令,不再整棵 npm ci(省 ~360MB);
# 2) Prisma 只生成当前平台引擎,不再打包全平台二进制(省 ~50-100MB);
# 3) HEALTHCHECK 用 node 自带 fetch,不装 curl(省 ~10MB)。

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 构建期需要 devDependencies(typescript/tailwind),构建完即丢。
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:../data/build.db"
RUN npx prisma generate --schema prisma/schema.prisma && npm run build

# 运行时只需要两个 CLI:
#   prisma —— 建表 / db push;tsx —— 跑初始化与回填脚本。
# 以前这里跑 `npm ci --omit=dev`,把 next(203MB)、lucide-react(37MB) 等整棵生产依赖
# 一起搬进镜像,单这个目录就 ~450MB,占整个镜像一多半。用最小 package.json 只装这两个包。
FROM node:22-alpine AS init-tools
WORKDIR /app
# 版本范围从仓库的 package.json 里取,避免这里硬编码导致与依赖漂移。
COPY package.json ./
RUN node -e "const p=require('./package.json');const d=p.dependencies||{};require('fs').writeFileSync('package.json',JSON.stringify({name:'home-inventory-init-tools',private:true,dependencies:{prisma:d.prisma,tsx:d.tsx}},null,2))" \
 && npm install --no-audit --no-fund --omit=dev \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/* /var/cache/apk/*

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Next 的 standalone 产物(带 traced node_modules)+ 静态资源 + 运行期需要的目录。
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

# Prisma CLI 在启动时按常规模块解析找 @prisma/client 与引擎,因此保留生成好的客户端。
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# 只保留 prisma + tsx 的精简工具目录(不再是一整棵生产依赖)。
COPY --from=init-tools /app/node_modules ./init-tools/node_modules
COPY --from=init-tools /app/package.json ./init-tools/package.json

COPY docker/entrypoint.sh /usr/local/bin/home-inventory-entrypoint
RUN chmod +x /usr/local/bin/home-inventory-entrypoint \
 && mkdir -p /app/data \
 && rm -rf /root/.npm /tmp/*

EXPOSE 3000
# 用 node 自带 fetch 做健康检查,省掉 `apk add curl` 的安装层。
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["home-inventory-entrypoint"]