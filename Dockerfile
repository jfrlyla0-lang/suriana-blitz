FROM node:22-bookworm-slim AS frontend
WORKDIR /build/app

COPY app/package*.json ./
RUN npm ci

COPY app/ ./
RUN npm run build


FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server ./server
COPY --from=frontend /build/app/dist ./app/dist

RUN mkdir -p /app/server/uploads/avatars \
    /app/server/uploads/messages \
    /app/server/uploads/receipts

USER node

EXPOSE 8080

CMD ["node", "server/index.js"]
