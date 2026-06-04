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

# 构建完成后，在 builder 阶段剔除开发依赖，从而在 node_modules 中只保留生产依赖及其已编译好的 .node 库
RUN npm prune --production --registry=https://registry.npmmirror.com


# 使用轻量级 Node.js Alpine 镜像作为运行阶段
FROM node:20-alpine AS runner

WORKDIR /app

# 设置生产环境变量
ENV NODE_ENV=production

# 免去在 runner 阶段安装 python3/make/g++ 的需求，也完全避免了二次 C++ 编译
# 直接将构建阶段编译好的源码和已编译好的原生生产依赖复制过来
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# 创建持久化数据目录
RUN mkdir -p data

# 声明容器对外暴露的端口
EXPOSE 3000

# 运行生产服务
CMD ["npm", "run", "start"]
