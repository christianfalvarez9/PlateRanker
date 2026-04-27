FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json backend/
COPY frontend/package*.json frontend/
COPY mobile/package*.json mobile/
RUN npm ci --ignore-scripts

COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
COPY backend/prisma backend/prisma
RUN npm run build -w backend

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/backend/package*.json backend/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma

EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
