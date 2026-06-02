# 使用极轻量级的高性能 Nginx Alpine 镜像作为基底
FROM nginx:alpine

# 将当前目录下的所有静态网页文件复制到 Nginx 默认的 HTML 静态资源托管目录下
COPY . /usr/share/nginx/html/

# 暴露 80 端口（Nginx 默认 HTTP 服务端口）
EXPOSE 80

# 容器启动时默认运行 Nginx
CMD ["nginx", "-g", "daemon off;"]
