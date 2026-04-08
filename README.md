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
  - `GET /restaurants/:id/reviews`
- Dishes
  - `POST /dishes` (manual add; supports seasonal)
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
- Uploads
  - `POST /uploads/dish-photo` (authenticated image upload for dish reviews; stores in Google Cloud Storage)
- Frontend pages
  - `/` search page (query + geolocation shortcut)
  - `/login`, `/register`
  - `/restaurants/[id]` profile with tabs: Overview, Menu, Reviews, Historical
  - `/dashboard`
  - `/profile`

---

## Rating Logic Implemented

### Dish score

```text
dish_score = (taste * 0.60) + (portion_size * 0.15) + (value * 0.15) + (presentation * 0.05) + (uniqueness * 0.05)
```

Notes:
- `portion_size` is stored in Prisma as `portionSizeScore` and mapped to existing DB column `portionScore`.
- `value` is stored in Prisma as `valueScore` and mapped to existing DB column `costScore`.
- `uniqueness` is a new persisted review column (`uniquenessScore`, default `5` for backward compatibility).

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
- Recipe matching uses Google Custom Search + structured recipe metadata parsing to select a highest-rated similar recipe link.
- Recipe matches are persisted per user and surfaced in the private dashboard as saved recipe links.

### Dish photo upload environment variables (Google Cloud)

```text
DISH_PHOTO_BUCKET_NAME="<your-gcs-bucket-name>"
DISH_PHOTO_PUBLIC_BASE_URL=""
DISH_PHOTO_UPLOAD_MAX_BYTES="8388608"
```

- `DISH_PHOTO_BUCKET_NAME`: required in production; GCS bucket used for review images.
- `DISH_PHOTO_PUBLIC_BASE_URL`: optional custom CDN/public base URL. Leave empty to use `https://storage.googleapis.com/<bucket>/<object>`.
- `DISH_PHOTO_UPLOAD_MAX_BYTES`: max accepted upload size in bytes.

For Cloud Run, use a service account with at least `Storage Object Creator` on this bucket, and if you use private uniform buckets with custom delivery, configure your URL strategy accordingly.

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

### Recommended deployment architecture (Google Cloud)

- **Frontend (Next.js):** Cloud Run service (`platerank-web`)
- **Backend (Express API):** Cloud Run service (`platerank-api`)
- **Database (PostgreSQL):** Cloud SQL for PostgreSQL
- **Object storage:** Google Cloud Storage bucket for dish photos
- **Build + image registry:** Cloud Build + Artifact Registry
- **Secrets:** Secret Manager
- **Optional scheduled work:** Cloud Run Job + Cloud Scheduler

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
RECIPE_API_KEY=""
RECIPE_SEARCH_CX=""
BACKGROUND_JOBS_ENABLED="false"

# Dish photos (Google Cloud Storage)
DISH_PHOTO_BUCKET_NAME="<your-gcs-bucket-name>"
DISH_PHOTO_PUBLIC_BASE_URL=""
DISH_PHOTO_UPLOAD_MAX_BYTES="8388608"
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
   For recent updates, ensure at least these migrations are applied before backend rollout:
   - `20260407123000_review_value_portion_uniqueness`
   - `20260407150000_user_default_search_location`
5. Optional: seed data only if you intentionally want demo data in production.
6. Verify API health endpoint:
   - `GET /health` returns `{ "status": "ok" }`
7. End-to-end smoke test:
   - register/login
   - restaurant search
   - restaurant detail/menu/reviews
   - submit meal review
   - dashboard/profile load

### Google Cloud setup checklist (new)

1. **Enable required APIs**
   - Cloud Run Admin API
   - Cloud Build API
   - Artifact Registry API
   - Secret Manager API
   - Cloud SQL Admin API

2. **Create Artifact Registry repository**
   ```bash
   gcloud artifacts repositories create platerank \
     --repository-format=docker \
     --location=us-central1 \
     --description="PlateRank container images"
   ```

3. **Provision Cloud SQL (Postgres)**
   - Create Cloud SQL instance and database.
   - Create DB user and generate `DATABASE_URL` using the Cloud SQL Unix socket path used by Cloud Run:
   ```text
   postgresql://USER:PASSWORD@localhost:5432/platerank?host=/cloudsql/PROJECT:REGION:INSTANCE
   ```

4. **Create Secret Manager secrets**
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `GOOGLE_PLACES_API_KEY`
   - `RECIPE_API_KEY`
   - `RECIPE_SEARCH_CX`

5. **Create runtime service account** (example: `platerank-runner@PROJECT_ID.iam.gserviceaccount.com`) and grant:
   - `roles/run.invoker` (as needed for service-to-service calls)
   - `roles/cloudsql.client`
   - `roles/secretmanager.secretAccessor`
   - `roles/storage.objectCreator` on your dish-photo bucket

6. **Deploy backend**
   - `cloudbuild.backend.yaml` now requires explicit substitutions in Cloud Shell.
   - Recommended: use a release tag once and reuse it across backend/frontend/jobs.
   - Backend Cloud Build now includes a migration gate:
     1) deploy/update Cloud Run Job `${_MIGRATION_JOB}` using backend image,
     2) execute `npm run prisma:migrate:deploy -w backend` via that job,
     3) only then deploy Cloud Run service revision.
   - This ensures schema changes (e.g., `User.defaultSearchLocation`) are applied before serving traffic.
   ```bash
   IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"

   gcloud builds submit --config cloudbuild.backend.yaml \
     --substitutions=_IMAGE_TAG="${IMAGE_TAG}",_CLOUDSQL_INSTANCE="PROJECT_ID:us-central1:platerank-sql",_CORS_ALLOWLIST="https://app.example.com",_DISH_PHOTO_BUCKET="your-dish-photo-bucket"
   ```

7. **Deploy frontend**
   - Read backend URL after backend deploy, then pass it into frontend build.
   ```bash
   BACKEND_URL="$(gcloud run services describe platerank-api --region=us-central1 --format='value(status.url)')"

   gcloud builds submit --config cloudbuild.frontend.yaml \
     --substitutions=_IMAGE_TAG="${IMAGE_TAG}",_NEXT_PUBLIC_API_BASE_URL="${BACKEND_URL}"
   ```

8. **Set up repeat-badge scheduled processing** (recommended over in-process cron on Cloud Run)
   - Deploy the Cloud Run Job definition:
   ```bash
   gcloud builds submit --config cloudbuild.jobs.yaml \
     --substitutions=_IMAGE_TAG="${IMAGE_TAG}",_CLOUDSQL_INSTANCE="PROJECT_ID:us-central1:platerank-sql",_DISH_PHOTO_BUCKET="your-dish-photo-bucket"
   ```
   - Create Cloud Scheduler trigger (daily at 3 AM UTC example):
   ```bash
   gcloud scheduler jobs create http platerank-repeat-badge-daily \
     --schedule="0 3 * * *" \
     --uri="https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT_ID/jobs/platerank-repeat-badge:run" \
     --http-method=POST \
     --oauth-service-account-email=platerank-runner@PROJECT_ID.iam.gserviceaccount.com
   ```

> Cloud Build files intentionally use `REQUIRED_*` defaults for critical substitutions.
> If you forget to pass one in Cloud Shell, build validation fails early with a clear error.

### Cloud Run notes

- Cloud Run should run backend with `BACKGROUND_JOBS_ENABLED=false`.
- Use Cloud Run Jobs + Scheduler for deterministic recurring workloads.
- App listens on port `8080` in Cloud Run Docker images.
- For each backend rollout, keep **migration-before-deploy** in place (or an equivalent release gate) so new Prisma fields are present before new code starts.

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
