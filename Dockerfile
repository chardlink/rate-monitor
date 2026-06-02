# 使用轻量级的 Node.js 18 Alpine 作为镜像底
FROM node:18-alpine

# 设置容器工作目录
WORKDIR /usr/src/app

# 复制 package.json 和 package-lock.json (若存在)
COPY package*.json ./

# 仅安装生产环境依赖
RUN npm install --only=production

# 复制当前目录下的所有静态网页及服务端源码
COPY . .

# 暴露 Express 默认服务端口
EXPOSE 80

# 挂载本地持久卷，确保汇率历史和配置文件重新启动时不丢失
VOLUME ["/usr/src/app/data"]

# 启动 Node 服务
CMD ["npm", "start"]
