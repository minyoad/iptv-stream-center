# 使用轻量级 Node.js Alpine 镜像作为构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 安装原生模块构建依赖，并切换为阿里云 APK 镜像站提高国内下载速度
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache python3 make g++

# 复制依赖定义文件
COPY package*.json ./

# 使用镜像源安装完整依赖（包括开发依赖以支持构建）
RUN npm install --registry=https://registry.npmmirror.com

# 复制所有源代码
COPY . .

# 执行构建：这将调用 vite build 构建前端，并使用 esbuild 构建后端到 dist/server.cjs
RUN npm run build

# 使用轻量级 Node.js Alpine 镜像作为运行阶段
FROM node:20-alpine AS runner

WORKDIR /app

# 设置生产环境变量
ENV NODE_ENV=production

# 仅复制 package.json
COPY package*.json ./

# 切换为阿里云 APK 镜像站，安装生产依赖编译依赖组，并通过腾讯/淘宝镜像源高速下载依赖，编译完成后自动清除临时构建工具
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm install --omit=dev --registry=https://registry.npmmirror.com \
    && apk del .build-deps

# 从构建阶段复制编译输出文件（/app/dist 包含了静态前端托管和 CJS 后端代码）
COPY --from=builder /app/dist ./dist

# 创建持久化数据目录
RUN mkdir -p data

# 声明容器对外暴露的端口
EXPOSE 3000

# 运行生产服务
CMD ["npm", "run", "start"]
