import axios from 'axios';
import { DishCategory, DishSource, DishStatus } from '@prisma/client';
import { env } from '../config/env';
import { normalizeDishName } from '../utils/ratings';

export type ExternalMenuItem = {
  name: string;
  category: DishCategory;
  source: DishSource;
  status: DishStatus;
};

export type FetchMenuInput = {
  restaurantId: string;
  name: string;
  address?: string | null;
  website?: string | null;
  googlePlacesRef?: string | null;
};

export type MenuProviderId = 'google-places';

export type ExternalMenuFetchResult = {
  provider: MenuProviderId;
  items: ExternalMenuItem[];
};

type GooglePlaceSearchResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    place_id?: string;
  }>;
};

type GooglePlaceDetailsResponse = {
  status?: string;
  error_message?: string;
  result?: {
    editorial_summary?: {
      overview?: string;
    };
    reviews?: Array<{
      text?: string;
    }>;
  };
};

let activeProviderRequests = 0;
let lastProviderRequestAt = 0;
const providerQueue: Array<() => void> = [];

const DRINK_KEYWORDS = [
  'drink',
  'beverage',
  'coffee',
  'latte',
  'espresso',
  'tea',
  'soda',
  'smoothie',
  'cocktail',
  'beer',
  'wine',
];

const NON_MENU_TERMS = [
  'restaurant',
  'service',
  'staff',
  'waiter',
  'waitress',
  'ambience',
  'atmosphere',
  'experience',
  'location',
  'place',
  'parking',
  'price',
  'portion',
  'owner',
  'manager',
  'table',
  'reservation',
  'bathroom',
];

const MAX_MENU_ITEMS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireProviderSlot(): Promise<void> {
  if (activeProviderRequests < env.menuMaxConcurrency) {
    activeProviderRequests += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    providerQueue.push(resolve);
  });
  activeProviderRequests += 1;
}

function releaseProviderSlot(): void {
  activeProviderRequests = Math.max(0, activeProviderRequests - 1);
  const next = providerQueue.shift();
  if (next) {
    next();
  }
}

async function runRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  await acquireProviderSlot();

  try {
    const elapsed = Date.now() - lastProviderRequestAt;
    const waitMs = Math.max(0, env.menuMinRequestIntervalMs - elapsed);
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    lastProviderRequestAt = Date.now();
    return await fn();
  } finally {
    releaseProviderSlot();
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  const status = error.response.status;
  return status === 429 || status >= 500;
}

function getRetryDelayMs(attemptNumber: number): number {
  const base = Math.min(4000, 500 * 2 ** (attemptNumber - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

async function requestWithRetry<T>(requestFn: () => Promise<T>): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await runRateLimited(requestFn);
    } catch (error) {
      attempt += 1;

      if (!isRetryableProviderError(error) || attempt > env.menuMaxRetries) {
        throw error;
      }

      await sleep(getRetryDelayMs(attempt));
    }
  }
}

function cleanItemName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function looksLikeDrink(name: string): boolean {
  const lower = name.toLowerCase();
  return DRINK_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function inferCategory(name: string): DishCategory {
  const lower = name.toLowerCase();

  if (
    lower.includes('cake') ||
    lower.includes('dessert') ||
    lower.includes('cookie') ||
    lower.includes('pie') ||
    lower.includes('ice cream')
  ) {
    return DishCategory.DESSERT;
  }

  if (
    lower.includes('fries') ||
    lower.includes('chips') ||
    lower.includes('slaw') ||
    lower.includes('side') ||
    lower.includes('rice')
  ) {
    return DishCategory.SIDE;
  }

  if (
    lower.includes('appetizer') ||
    lower.includes('starter') ||
    lower.includes('small plate') ||
    lower.includes('soup') ||
    lower.includes('salad')
  ) {
    return DishCategory.APPETIZER;
  }

  return DishCategory.ENTREE;
}

function inferStatus(name: string): DishStatus {
  const lower = name.toLowerCase();
  if (
    lower.includes('seasonal') ||
    lower.includes('limited') ||
    lower.includes('lto') ||
    lower.includes('special')
  ) {
    return DishStatus.SEASONAL;
  }

  return DishStatus.ACTIVE;
}

function buildDeduplicationKey(name: string): string {
  return normalizeDishName(
    name.replace(/\b(?:small|medium|large|xl|xxl|\d+\s?(?:oz|ounce|ounces|in|inch|inches|lb|lbs))\b/gi, ' '),
  );
}

function mapToExternalMenuItem(name: string): ExternalMenuItem | null {
  const cleanedName = cleanItemName(name);

  if (cleanedName.length < 2 || looksLikeDrink(cleanedName)) {
    return null;
  }

  return {
    name: cleanedName,
    category: inferCategory(cleanedName),
    source: DishSource.API,
    status: inferStatus(cleanedName),
  };
}

function dedupeItems(items: ExternalMenuItem[]): ExternalMenuItem[] {
  const seen = new Set<string>();
  const deduped: ExternalMenuItem[] = [];

  for (const item of items) {
    const key = buildDeduplicationKey(item.name);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function normalizeDishCandidate(candidate: string): string {
  return cleanItemName(candidate)
    .replace(/^the\s+/i, '')
    .replace(/\b(?:at|here|there|tonight|today)\b.*$/i, '')
    .replace(/["'“”]+/g, '')
    .trim();
}

function isLikelyDishCandidate(candidate: string): boolean {
  if (!candidate) {
    return false;
  }

  if (candidate.length < 3 || candidate.length > 60) {
    return false;
  }

  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) {
    return false;
  }

  const lower = candidate.toLowerCase();
  if (NON_MENU_TERMS.some((term) => lower.includes(term))) {
    return false;
  }

  if (looksLikeDrink(candidate)) {
    return false;
  }

  return /[a-z]/i.test(candidate);
}

function extractDishCandidatesFromText(text: string): string[] {
  const rawCandidates: string[] = [];

  for (const match of text.matchAll(/"([^"\n]{3,80})"/g)) {
    rawCandidates.push(match[1]);
  }

  const patterns = [
    /(?:ordered|had|got|tried|try|recommend(?:ed)?|loved?|favorite|best)\s+(?:the\s+)?([a-z][a-z0-9'&\- ]{2,80})/gi,
    /(?:must\s+try|go\s+for)\s+(?:the\s+)?([a-z][a-z0-9'&\- ]{2,80})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      rawCandidates.push(match[1]);
    }
  }

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const raw of rawCandidates) {
    const normalized = normalizeDishCandidate(raw);
    if (!isLikelyDishCandidate(normalized)) {
      continue;
    }

    const key = buildDeduplicationKey(normalized);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(normalized);
  }

  return candidates;
}

function assertGooglePlacesStatus(operation: string, status?: string, errorMessage?: string): void {
  if (!status || status === 'OK' || status === 'ZERO_RESULTS') {
    return;
  }

  throw new Error(
    `Google Places ${operation} failed: ${status}${errorMessage ? ` - ${errorMessage}` : ''}`,
  );
}

async function resolveGooglePlaceId(input: FetchMenuInput): Promise<string | null> {
  if (input.googlePlacesRef) {
    return input.googlePlacesRef;
  }

  if (!env.googlePlacesApiKey) {
    return null;
  }

  const query = [input.name, input.address ?? ''].filter(Boolean).join(' ').trim();
  if (!query) {
    return null;
  }

  const params = new URLSearchParams({
    query,
    type: 'restaurant',
    key: env.googlePlacesApiKey,
  });

  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
  const response = await requestWithRetry(() =>
    axios.get<GooglePlaceSearchResponse>(searchUrl, {
      timeout: 8000,
    }),
  );

  assertGooglePlacesStatus('text search', response.data.status, response.data.error_message);

  return response.data.results?.[0]?.place_id ?? null;
}

async function fetchGooglePlacesMenuItems(input: FetchMenuInput): Promise<ExternalMenuItem[]> {
  if (!env.googlePlacesApiKey) {
    return [];
  }

  const placeId = await resolveGooglePlaceId(input);
  if (!placeId) {
    return [];
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'reviews,editorial_summary',
    key: env.googlePlacesApiKey,
  });

  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
  const detailsResponse = await requestWithRetry(() =>
    axios.get<GooglePlaceDetailsResponse>(detailsUrl, {
      timeout: 8000,
    }),
  );

  if (detailsResponse.data.status === 'NOT_FOUND') {
    return [];
  }

  assertGooglePlacesStatus('details', detailsResponse.data.status, detailsResponse.data.error_message);

  const textSources = [
    detailsResponse.data.result?.editorial_summary?.overview ?? '',
    ...(detailsResponse.data.result?.reviews ?? []).map((review) => review.text ?? ''),
  ].filter(Boolean);

  const candidates = textSources.flatMap((text) => extractDishCandidatesFromText(text));
  const mapped = candidates
    .map((name) => mapToExternalMenuItem(name))
    .filter((item): item is ExternalMenuItem => Boolean(item));

  return dedupeItems(mapped).slice(0, MAX_MENU_ITEMS);
}

export async function fetchMenuForRestaurant(input: FetchMenuInput): Promise<ExternalMenuFetchResult> {
  const items = await fetchGooglePlacesMenuItems(input);

  return {
    provider: 'google-places',
    items,
  };
}
