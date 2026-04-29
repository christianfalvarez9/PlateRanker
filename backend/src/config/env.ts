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

function booleanFromEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
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

function optionalJwtExpiresInFromEnv(): string | undefined {
  const value = process.env.JWT_EXPIRES_IN?.trim();
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === 'none' || normalized === 'off' || normalized === 'disabled') {
    return undefined;
  }

  return value;
}

function emailAllowlistFromEnv(key: string): string[] {
  return csvListFromEnv(key).map((email) => email.toLowerCase());
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
  jwtExpiresIn: optionalJwtExpiresInFromEnv(),
  corsOriginAllowlist: corsOriginAllowlistFromEnv(),
  googlePlacesApiKey: optionalWithSafeProductionValue('GOOGLE_PLACES_API_KEY'),
  dishPhotoBucketName: optionalWithSafeProductionValue('DISH_PHOTO_BUCKET_NAME'),
  dishPhotoPublicBaseUrl: process.env.DISH_PHOTO_PUBLIC_BASE_URL?.trim() ?? '',
  dishPhotoUploadMaxBytes: positiveIntFromEnv('DISH_PHOTO_UPLOAD_MAX_BYTES', 8 * 1024 * 1024),
  recipeApiKey: process.env.RECIPE_API_KEY ?? '',
  recipeSearchCx: process.env.RECIPE_SEARCH_CX ?? '',
  menuAdminEmails: emailAllowlistFromEnv('MENU_ADMIN_EMAILS'),
  backgroundJobsEnabled: booleanFromEnv('BACKGROUND_JOBS_ENABLED', !isProduction),
};
