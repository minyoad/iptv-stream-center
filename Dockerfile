# 使用轻量级 Node.js 20 Alpine 镜像作为构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 支持通过 --build-arg APK_MIRROR=<mirror> 自定义 Alpine 镜像源（如 mirrors.aliyun.com）
# 默认使用 Alpine 官方 CDN，兼容国内外 GitHub Actions、Docker Hub 及国内本地编译
ARG APK_MIRROR=""
RUN if [ -n "$APK_MIRROR" ]; then \
      sed -i "s/dl-cdn.alpinelinux.org/$APK_MIRROR/g" /etc/apk/repositories ; \
    fi \
    && apk add --no-cache python3 make g++

# 复制依赖定义文件
COPY package*.json ./

# 支持通过 --build-arg NPM_REGISTRY=<registry> 自定义 npm 镜像源（如 https://registry.npmmirror.com）
# 默认优先使用官方 npm 源，跳过 Puppeteer 的 Chrome 浏览器下载，保障国内外网络构建稳定性
ARG NPM_REGISTRY=""
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN if [ -n "$NPM_REGISTRY" ]; then \
      npm config set registry "$NPM_REGISTRY" ; \
    fi \
    && (npm ci || npm install)

# 复制所有源代码
COPY . .

# 执行构建：这将调用 vite build 构建前端 UI，并使用 esbuild 构建后端到 dist/server.cjs
RUN npm run build

# 剔除开发依赖，只保留生产依赖及其已编译好的原生模块 (如 better-sqlite3)
RUN npm prune --production


# 使用轻量级 Node.js 20 Alpine 镜像作为运行阶段
FROM node:20-alpine AS runner

WORKDIR /app

# 设置生产环境变量
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

# 复制构建阶段编译好的产物与原生依赖
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# 创建持久化数据目录
RUN mkdir -p data

# 声明容器对外暴露的端口
EXPOSE 3000

# 运行生产服务
CMD ["npm", "run", "start"]
