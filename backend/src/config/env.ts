import dotenv from 'dotenv';

dotenv.config();

type NodeEnv = 'development' | 'test' | 'production';

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }

  return 'development';
}

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
const isProduction = nodeEnv === 'production';

function numberFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function positiveIntFromEnv(key: string, fallback: number): number {
  const value = Math.floor(numberFromEnv(key, fallback));
  if (value <= 0) {
    return fallback;
  }

  return value;
}

function nonNegativeIntFromEnv(key: string, fallback: number): number {
  const value = Math.floor(numberFromEnv(key, fallback));
  if (value < 0) {
    return fallback;
  }

  return value;
}

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function requiredWithSafeProductionValue(key: string, fallback: string): string {
  const value = required(key, fallback);

  if (isProduction && value === fallback) {
    throw new Error(`Environment variable ${key} must be explicitly set in production`);
  }

  return value;
}

function optionalWithSafeProductionValue(key: string): string {
  const value = process.env[key]?.trim() ?? '';

  if (isProduction && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function csvListFromEnv(key: string): string[] {
  const raw = process.env[key];
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsOriginAllowlistFromEnv(): string[] {
  const configuredOrigins = csvListFromEnv('CORS_ORIGIN_ALLOWLIST');
  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (isProduction) {
    throw new Error('Missing required environment variable: CORS_ORIGIN_ALLOWLIST');
  }

  return ['http://localhost:3000'];
}

export const env = {
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: requiredWithSafeProductionValue('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/platerank'),
  jwtSecret: requiredWithSafeProductionValue('JWT_SECRET', 'replace-with-strong-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOriginAllowlist: corsOriginAllowlistFromEnv(),
  googlePlacesApiKey: optionalWithSafeProductionValue('GOOGLE_PLACES_API_KEY'),
  menuProvider: process.env.MENU_PROVIDER ?? 'mock',
  menuApiKey: process.env.MENU_API_KEY ?? '',
  menuCacheTtlHours: positiveIntFromEnv('MENU_CACHE_TTL_HOURS', 24),
  menuMaxRetries: nonNegativeIntFromEnv('MENU_MAX_RETRIES', 3),
  menuMinRequestIntervalMs: nonNegativeIntFromEnv('MENU_MIN_REQUEST_INTERVAL_MS', 250),
  menuMaxConcurrency: positiveIntFromEnv('MENU_MAX_CONCURRENCY', 2),
  menuFailureCooldownMinutes: positiveIntFromEnv('MENU_FAILURE_COOLDOWN_MINUTES', 15),
  recipeApiKey: process.env.RECIPE_API_KEY ?? '',
};
