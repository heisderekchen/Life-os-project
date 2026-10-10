FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY sql ./sql
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
