FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
COPY backend/package*.json backend/
COPY frontend/package*.json frontend/
COPY mobile/package*.json mobile/

RUN npm ci --ignore-scripts

COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/next.config.js frontend/next.config.js
COPY frontend/postcss.config.js frontend/postcss.config.js
COPY frontend/tailwind.config.ts frontend/tailwind.config.ts
COPY frontend/next-env.d.ts frontend/next-env.d.ts
COPY frontend/public frontend/public
COPY frontend/src frontend/src

ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ARG NEXT_PUBLIC_MENU_ADMIN_EMAILS
ENV NEXT_PUBLIC_MENU_ADMIN_EMAILS=${NEXT_PUBLIC_MENU_ADMIN_EMAILS}

RUN npm run build -w frontend

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/package*.json ./
COPY --from=build /app/frontend/package*.json frontend/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/frontend/.next ./frontend/.next
COPY --from=build /app/frontend/public ./frontend/public
COPY --from=build /app/frontend/next.config.js ./frontend/next.config.js

EXPOSE 8080
CMD ["npm", "run", "start", "-w", "frontend", "--", "-p", "8080"]
