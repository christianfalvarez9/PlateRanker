# PlateRank (Food & Restaurant Rating Website)

PlateRank is a responsive full-stack web application for rating restaurants and individual dishes using weighted scoring logic. It supports restaurant discovery, dish reviews, menu management (including historical dish tracking), recipe matching for highly-rated dishes, and a high-repeat-customer badge.

## Tech Stack

- **Frontend:** Next.js (TypeScript) + Tailwind CSS
- **Backend:** Express (TypeScript)
- **Database:** PostgreSQL + Prisma
- **Auth:** JWT
- **Jobs:** node-cron (daily repeat-customer badge recalculation)

---

## Implemented Features

- Auth
  - `POST /auth/register`
  - `POST /auth/login`
- Restaurant discovery and profile
  - `GET /restaurants/search`
  - `GET /restaurants/:id`
  - `GET /restaurants/:id/menu`
  - `POST /restaurants/:id/menu/sync` (auto-sync provider menu with cache/cooldown)
  - `GET /restaurants/:id/reviews`
- Dishes
  - `POST /dishes` (manual add; supports seasonal)
  - `POST /dishes/prepopulate` (manual force refresh; still available)
  - `PATCH /dishes/:id/flag-unavailable` (auto-historical at 5 flags)
- Reviews
  - `POST /meal-reviews` (recommended: one meal with restaurant + multiple dish ratings)
  - `POST /reviews` (legacy single-dish review)
  - Backend computes dish score and recomputes restaurant ratings
  - Recipe trigger when `dish_score >= 8` and user setting is enabled
- Visits / retention
  - `POST /visits`
  - High repeat customers badge logic (90-day window)
  - Daily background badge recalculation job
- User
  - `GET /users/:id/dashboard`
  - `GET /users/:id/reviews`
  - `PATCH /users/:id/preferences/recipe-match`
- Frontend pages
  - `/` search page (query + geolocation shortcut)
  - `/login`, `/register`
  - `/restaurants/[id]` profile with tabs: Overview, Menu, Reviews, Historical
    - Menu auto-sync now runs when user opens Menu tab
    - Reviews tab can trigger one-time auto-sync if menu is empty, so dish picker gets fed automatically
  - `/dashboard`
  - `/profile`

---

## Rating Logic Implemented

### Dish score

```text
dish_score = (taste * 0.50) + (portion * 0.25) + (cost * 0.20) + (presentation * 0.05)
```

### Restaurant food rating

Category weights:
- Appetizers: 25%
- Entrees: 50%
- Sides: 15%
- Desserts: 10%

If some categories are missing, weights are normalized across present categories.

### Overall restaurant rating

If service/atmosphere/value exist:

```text
overall = (food * 0.50) + (service * 0.20) + (atmosphere * 0.15) + (value * 0.15)
```

Fallback:

```text
overall = food
```

### Meal review flow (implemented)

Users can submit **one meal review** that includes:

- Restaurant-level scores: `serviceScore`, `atmosphereScore`, `valueScore`
- A list of dish-level ratings for all dishes eaten in that meal

Restaurant rating components are derived as:

- `foodRating`: weighted category average from dish reviews
- `serviceRating`: average of submitted meal `serviceScore`
- `atmosphereRating`: average of submitted meal `atmosphereScore`
- `valueRating`: average of submitted meal `valueScore`
- `overallRating`: `(food * 0.50) + (service * 0.20) + (atmosphere * 0.15) + (value * 0.15)`

---

## Project Structure

```text
backend/
  prisma/
    schema.prisma
    seed.ts
  src/
    auth/
    dishes/
    integrations/
    jobs/
    middleware/
    restaurants/
    reviews/
    users/
    visits/
    index.ts

frontend/
  src/
    app/
      page.tsx
      login/page.tsx
      register/page.tsx
      restaurants/[id]/page.tsx
      dashboard/page.tsx
      profile/page.tsx
    components/
    lib/
```

---

## Setup Instructions

> **Important:** `npm` / `node` are not currently available in this environment, so commands below could not be executed here. Run them on your machine once Node.js is installed.

### 1) Install prerequisites

- Node.js 20+
- PostgreSQL 14+

### 2) Configure environment files

Copy and edit:

- `backend/.env.example` → `backend/.env`
- `frontend/.env.example` → `frontend/.env.local`

At minimum set:

- `DATABASE_URL`
- `JWT_SECRET`
- `NEXT_PUBLIC_API_BASE_URL` (usually `http://localhost:4000`)

### 3) Install dependencies

```bash
npm install
```

### 4) Generate Prisma client and migrate DB

```bash
npm run prisma:generate -w backend
npm run prisma:migrate -w backend -- --name init
```

### 5) Seed demo data

```bash
npm run seed
```

Demo users:

- `alice@example.com` / `Password123!`
- `bob@example.com` / `Password123!`

### 6) Start app

```bash
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

---

## Troubleshooting Prisma `P1001` (Can't reach database server)

If you see:

```text
Error: P1001: Can't reach database server at `localhost:5432`
```

your PostgreSQL server is not running (or not reachable on port `5432`).

### Option A: Start PostgreSQL via Docker (fastest)

This repo includes `docker-compose.yml` for Postgres.

```bash
docker compose up -d db
```

Then verify:

```bash
docker compose ps
```

### Option B: Use local PostgreSQL service

1. Start PostgreSQL service on your machine.
2. Ensure database `platerank` exists.
3. Ensure `backend/.env` has the correct connection string:

```text
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/platerank"
```

### Retry after DB is running

```bash
npm run prisma:generate -w backend
npm run prisma:migrate -w backend -- --name init
npm run seed
```

---

## External API Notes

- Google Places integration is implemented with fallback mock results when API key is missing in local development.
- In production, `GOOGLE_PLACES_API_KEY` is required and backend startup will fail fast if it is missing.
- Menu provider integration supports:
  - `MENU_PROVIDER=mock|spoonacular`
  - automatic provider fetch for menu sync endpoint
  - DB-backed sync state cache (`MenuSyncState`) with TTL/cooldown/error tracking
  - retry + throttling controls via env variables
- Recipe provider includes mock/default behavior and can be swapped to live provider calls by setting API keys.

### Menu sync environment variables

```text
MENU_PROVIDER="mock"
MENU_API_KEY=""
MENU_CACHE_TTL_HOURS="24"
MENU_MAX_RETRIES="3"
MENU_MIN_REQUEST_INTERVAL_MS="250"
MENU_MAX_CONCURRENCY="2"
MENU_FAILURE_COOLDOWN_MINUTES="15"
```

---

## MVP Status

This repository now contains a complete MVP implementation for:

- Search + discovery
- Restaurant profile + menu tabs
- Dish review flow + weighted score engine
- Top/bottom dishes
- Historical dish threshold at 5 unavailable flags
- Recipe match trigger at score >= 8 (if enabled)
- Repeat-customer badge logic

---

## Production Go-Live Runbook

Use this checklist when launching PlateRank to production.

### Recommended deployment architecture

- **Frontend (Next.js):** Vercel
- **Backend (Express API):** Railway / Render / Fly.io / container host
- **Database (PostgreSQL):** managed service (Neon, Supabase, RDS, etc.)
- **DNS + TLS:** custom domain with HTTPS enabled

### Required environment variables

#### Backend (`backend/.env` in local, platform secrets in prod)

```text
NODE_ENV="production"
PORT=4000
DATABASE_URL="postgresql://..."
JWT_SECRET="<strong-random-secret>"
JWT_EXPIRES_IN="7d"
CORS_ORIGIN_ALLOWLIST="https://your-frontend-domain.com"

GOOGLE_PLACES_API_KEY="<required-in-production>"
MENU_PROVIDER="mock"
MENU_API_KEY=""
MENU_CACHE_TTL_HOURS="24"
MENU_MAX_RETRIES="3"
MENU_MIN_REQUEST_INTERVAL_MS="250"
MENU_MAX_CONCURRENCY="2"
MENU_FAILURE_COOLDOWN_MINUTES="15"
RECIPE_API_KEY=""
```

> `CORS_ORIGIN_ALLOWLIST` accepts comma-separated origins, for example:
> `"https://app.example.com,https://www.app.example.com"`

#### Frontend (`frontend/.env.local` in local, platform env in prod)

```text
NEXT_PUBLIC_API_BASE_URL="https://api.your-domain.com"
```

In production, `NEXT_PUBLIC_API_BASE_URL` is required.

### Pre-launch checklist

1. **Provision production Postgres** with backups enabled.
2. **Set all environment variables** in backend and frontend hosting platforms.
3. **Install dependencies and build**:
   ```bash
   npm install
   npm run build
   ```
4. **Run production DB migrations**:
   ```bash
   npm run prisma:migrate:deploy
   ```
5. Optional: seed data only if you intentionally want demo data in production.
6. Verify API health endpoint:
   - `GET /health` returns `{ "status": "ok" }`
7. End-to-end smoke test:
   - register/login
   - restaurant search
   - restaurant detail/menu/reviews
   - submit meal review
   - dashboard/profile load

### Launch day checklist

1. Deploy backend.
2. Confirm backend health and logs are clean.
3. Deploy frontend with correct `NEXT_PUBLIC_API_BASE_URL`.
4. Verify browser app connectivity to API in production.
5. Monitor logs and error rates for the first 1–2 hours.
6. Keep rollback plan ready (previous deploy + DB restore strategy).

### Post-launch checklist (first week)

1. Monitor uptime, error rates, and latency.
2. Validate scheduled jobs run correctly (repeat-customer badge recalculation).
3. Confirm backup snapshots and test a restore workflow.
4. Rotate secrets if required by policy and keep them in secret manager only.
5. Patch dependencies and set a recurring maintenance cadence.
