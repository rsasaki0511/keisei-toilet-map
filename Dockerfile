# トイレマップの配信と情報提供の受け付け（Coolify / ポート 8080）
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs index.html ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
