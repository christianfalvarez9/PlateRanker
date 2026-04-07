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

export type MenuProviderId = 'google-places' | 'website-scrape';

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
    website?: string;
    url?: string;
  };
};

let activeProviderRequests = 0;
let lastProviderRequestAt = 0;
const providerQueue: Array<() => void> = [];

const MAX_MENU_ITEMS = 30;
const MAX_HTML_BYTES = 2_000_000;
const SCRAPE_TIMEOUT_MS = 9000;

const MENU_PATH_CANDIDATES = [
  '/',
  '/menu',
  '/menus',
  '/food-menu',
  '/our-menu',
  '/dining/menu',
  '/eat/menu',
  '/order',
];

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

const FOOD_SIGNAL_KEYWORDS = [
  'burger',
  'chicken',
  'beef',
  'steak',
  'pork',
  'lamb',
  'turkey',
  'fish',
  'salmon',
  'tuna',
  'shrimp',
  'crab',
  'lobster',
  'oyster',
  'clam',
  'mussel',
  'sushi',
  'sashimi',
  'ramen',
  'udon',
  'pho',
  'pasta',
  'spaghetti',
  'linguine',
  'fettuccine',
  'ravioli',
  'lasagna',
  'gnocchi',
  'pizza',
  'calzone',
  'taco',
  'burrito',
  'quesadilla',
  'enchilada',
  'fajita',
  'nacho',
  'sandwich',
  'panini',
  'wrap',
  'sub',
  'fries',
  'salad',
  'soup',
  'rice',
  'noodle',
  'dumpling',
  'bao',
  'curry',
  'biryani',
  'shawarma',
  'gyro',
  'falafel',
  'kebab',
  'bbq',
  'ribs',
  'brisket',
  'wings',
  'tenders',
  'omelet',
  'pancake',
  'waffle',
  'toast',
  'dessert',
  'cake',
  'cookie',
  'brownie',
  'cheesecake',
  'pie',
  'gelato',
  'sorbet',
  'ice cream',
  'mochi',
];

const NON_MENU_TERMS = [
  'menu',
  'home',
  'about',
  'contact',
  'privacy',
  'terms',
  'location',
  'hours',
  'order online',
  'book now',
  'reservation',
  'sign in',
  'create account',
  'gift card',
  'review',
  'reviews',
  'restaurant',
  'service',
  'staff',
  'book now',
  'book a table',
  'reserve',
  'reservations',
  'order now',
  'delivery',
  'pickup',
  'takeout',
  'catering',
  'events',
  'careers',
  'jobs',
  'faq',
  'help',
  'support',
  'accessibility',
  'sitemap',
  'newsletter',
  'subscribe',
  'cookie policy',
  'all rights reserved',
  'terms of service',
  'terms and conditions',
  'privacy policy',
  'view all',
  'see all',
  'load more',
  'follow us',
  'instagram',
  'facebook',
  'twitter',
  'tiktok',
  'youtube',
  'open now',
  'closed now',
  'directions',
  'call now',
  'contact us',
];

const MENU_HEADING_TERMS = new Set([
  'appetizer',
  'appetizers',
  'entree',
  'entrees',
  'main',
  'mains',
  'main course',
  'side',
  'sides',
  'dessert',
  'desserts',
  'drinks',
  'beverages',
  'cocktails',
  'beer',
  'wine',
  'coffee',
  'tea',
  'kids menu',
  'lunch',
  'dinner',
  'brunch',
  'specials',
]);

const SINGLE_WORD_DISH_ALLOWLIST = new Set([
  'ramen',
  'udon',
  'pho',
  'sushi',
  'sashimi',
  'tacos',
  'nachos',
  'dumplings',
  'falafel',
  'shawarma',
  'gyro',
  'paella',
  'risotto',
  'gnocchi',
  'lasagna',
  'ravioli',
  'bibimbap',
  'biryani',
  'teriyaki',
  'ceviche',
  'poutine',
  'tiramisu',
  'cheesecake',
  'gelato',
]);

const GENERIC_MENU_ADJECTIVES = new Set([
  'house',
  'signature',
  'special',
  'classic',
  'fresh',
  'new',
  'our',
  'chef',
]);

const DAY_OR_TIME_REGEX =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|\d{1,2}:\d{2})\b/i;
const UI_ACTION_REGEX =
  /^(?:order|book|reserve|get|view|read|learn|follow|call|contact|sign|log|download|share)\b/i;

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
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[•·\-–—*\u2022\u25CF\u25AA\u25E6\u2043\u2219\s]+/, '')
    .replace(/[|•·]+\s*$/, '')
    .trim()
    .slice(0, 120);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, group: string) => {
      const codePoint = Number(group);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, group: string) => {
      const codePoint = parseInt(group, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    });
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeDishCandidate(candidate: string): string {
  return cleanItemName(candidate)
    .replace(/\$\s*\d+(?:\.\d{1,2})?/g, ' ')
    .replace(/\b\d+(?:\.\d{1,2})?\s*(?:usd|dollars?)\b/gi, ' ')
    .replace(/\b(?:cal|kcal|calories?)\b/gi, ' ')
    .replace(/\b(?:add to cart|order now|learn more|read more)\b/gi, ' ')
    .replace(/["'“”]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeCandidate(candidate: string): string[] {
  return candidate
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasFoodSignal(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return FOOD_SIGNAL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isMenuHeadingCandidate(candidate: string): boolean {
  const normalized = candidate.toLowerCase().replace(/\s+/g, ' ').trim();
  if (MENU_HEADING_TERMS.has(normalized)) {
    return true;
  }

  if (normalized.endsWith(' menu')) {
    const withoutMenu = normalized.replace(/\s+menu$/, '').trim();
    return MENU_HEADING_TERMS.has(withoutMenu);
  }

  return false;
}

function hasSuspiciousNoise(candidate: string): boolean {
  if (DAY_OR_TIME_REGEX.test(candidate)) {
    return true;
  }

  if (UI_ACTION_REGEX.test(candidate.toLowerCase())) {
    return true;
  }

  if (/[<>{}@[\]#%^*_=`~]+/.test(candidate)) {
    return true;
  }

  const symbolCount = (candidate.match(/[!$%^*_=+~`<>|]/g) ?? []).length;
  return symbolCount > 3;
}

function looksLikeDrink(name: string): boolean {
  const lower = name.toLowerCase();
  return DRINK_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isLikelyDishCandidate(candidate: string): boolean {
  if (!candidate) {
    return false;
  }

  if (candidate.length < 3 || candidate.length > 80) {
    return false;
  }

  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) {
    return false;
  }

  const lower = candidate.toLowerCase();
  const tokens = tokenizeCandidate(candidate);

  if (!tokens.length) {
    return false;
  }

  if (NON_MENU_TERMS.some((term) => lower.includes(term))) {
    return false;
  }

  if (isMenuHeadingCandidate(candidate)) {
    return false;
  }

  if (looksLikeDrink(candidate)) {
    return false;
  }

  if (hasSuspiciousNoise(candidate)) {
    return false;
  }

  if (/https?:\/\//i.test(candidate) || /@/.test(candidate)) {
    return false;
  }

  const hasFoodKeyword = hasFoodSignal(candidate);

  if (words.length === 1) {
    const token = tokens[0];
    if (!SINGLE_WORD_DISH_ALLOWLIST.has(token) && !hasFoodKeyword) {
      return false;
    }
  }

  if (
    !hasFoodKeyword &&
    tokens.length <= 2 &&
    tokens.every((token) => GENERIC_MENU_ADJECTIVES.has(token))
  ) {
    return false;
  }

  return /[a-z]/i.test(candidate);
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

  if (!isLikelyDishCandidate(cleanedName)) {
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

async function resolveWebsiteFromGooglePlace(input: FetchMenuInput): Promise<string | null> {
  if (!env.googlePlacesApiKey) {
    return null;
  }

  const placeId = await resolveGooglePlaceId(input);
  if (!placeId) {
    return null;
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'website,url',
    key: env.googlePlacesApiKey,
  });

  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
  const detailsResponse = await requestWithRetry(() =>
    axios.get<GooglePlaceDetailsResponse>(detailsUrl, {
      timeout: 8000,
    }),
  );

  if (detailsResponse.data.status === 'NOT_FOUND') {
    return null;
  }

  assertGooglePlacesStatus('details', detailsResponse.data.status, detailsResponse.data.error_message);

  return detailsResponse.data.result?.website ?? detailsResponse.data.result?.url ?? null;
}

function normalizeWebsiteUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function buildMenuCandidateUrls(rawWebsiteUrl: string): string[] {
  const normalized = normalizeWebsiteUrl(rawWebsiteUrl);
  if (!normalized) {
    return [];
  }

  const baseOrigin = `${normalized.protocol}//${normalized.host}`;
  const candidates = new Set<string>();

  for (const path of MENU_PATH_CANDIDATES) {
    candidates.add(new URL(path, baseOrigin).toString());
  }

  if (normalized.pathname && normalized.pathname !== '/') {
    candidates.add(new URL(normalized.pathname, baseOrigin).toString());
  }

  return Array.from(candidates);
}

async function resolveWebsiteCandidates(input: FetchMenuInput): Promise<string[]> {
  const websites = new Set<string>();

  if (input.website) {
    websites.add(input.website);
  }

  const googleResolvedWebsite = await resolveWebsiteFromGooglePlace(input).catch(() => null);
  if (googleResolvedWebsite) {
    websites.add(googleResolvedWebsite);
  }

  const candidateUrls = new Set<string>();
  for (const website of websites) {
    for (const candidate of buildMenuCandidateUrls(website)) {
      candidateUrls.add(candidate);
    }
  }

  return Array.from(candidateUrls);
}

async function fetchHtmlPage(url: string): Promise<string | null> {
  try {
    const response = await requestWithRetry(() =>
      axios.get<string>(url, {
        timeout: SCRAPE_TIMEOUT_MS,
        responseType: 'text',
        maxContentLength: MAX_HTML_BYTES,
        maxBodyLength: MAX_HTML_BYTES,
        headers: {
          'User-Agent': 'PlateRankMenuBot/1.0 (+https://platerank.local)',
          Accept: 'text/html,application/xhtml+xml',
        },
      }),
    );

    const contentTypeHeader = response.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

    if (!contentType || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return null;
    }

    return typeof response.data === 'string' ? response.data : null;
  } catch {
    return null;
  }
}

function parseJsonLdPayload(payload: string): unknown[] {
  const trimmed = payload.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function toTypeList(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

function collectMenuItemsFromJsonLd(node: unknown, sink: string[], inMenuContext = false): void {
  if (Array.isArray(node)) {
    node.forEach((item) => collectMenuItemsFromJsonLd(item, sink, inMenuContext));
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;
  const types = toTypeList(record['@type']).map((type) => type.toLowerCase());

  const isMenuContext =
    inMenuContext ||
    types.some((type) => type.includes('menu')) ||
    'hasMenuItem' in record ||
    'hasMenuSection' in record ||
    'menu' in record ||
    'itemListElement' in record;

  const name = typeof record.name === 'string' ? normalizeDishCandidate(record.name) : '';
  const hasMenuItemType = types.some((type) => type.includes('menuitem'));
  const hasPriceLikeData = 'offers' in record || 'price' in record;

  if (name && (hasMenuItemType || (isMenuContext && hasPriceLikeData))) {
    sink.push(name);
  }

  for (const value of Object.values(record)) {
    collectMenuItemsFromJsonLd(value, sink, isMenuContext);
  }
}

function extractMenuCandidatesFromJsonLd(html: string): string[] {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates: string[] = [];

  for (const match of html.matchAll(scriptRegex)) {
    const payload = match[1] ?? '';
    const parsedBlocks = parseJsonLdPayload(payload);
    for (const parsed of parsedBlocks) {
      collectMenuItemsFromJsonLd(parsed, candidates);
    }
  }

  return candidates
    .map((candidate) => normalizeDishCandidate(candidate))
    .filter((candidate) => isLikelyDishCandidate(candidate));
}

function extractTaggedTextCandidates(html: string, sourceUrl: string): string[] {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');

  const menuBlockRegex =
    /<(?:section|div|ul|ol)[^>]*(?:id|class)=["'][^"']*(?:menu|menus|food|dish|entree)[^"']*["'][^>]*>([\s\S]{0,120000}?)<\/(?:section|div|ul|ol)>/gi;
  const tagRegex = /<(?:li|h2|h3|h4|p|span)[^>]*>([\s\S]*?)<\/(?:li|h2|h3|h4|p|span)>/gi;

  const blocks = Array.from(stripped.matchAll(menuBlockRegex)).map((match) => match[1] ?? '');
  const hasMenuPathHint = /\/(?:menu|menus|food-menu|our-menu|dining\/menu|eat\/menu|order)(?:\/|$|\?)/i.test(
    sourceUrl,
  );
  const sources = blocks.length ? blocks : hasMenuPathHint ? [stripped] : [];

  const candidates: string[] = [];

  for (const source of sources) {
    for (const match of source.matchAll(tagRegex)) {
      const text = normalizeDishCandidate(stripTags(match[1] ?? ''));
      if (isLikelyDishCandidate(text)) {
        candidates.push(text);
      }
    }
  }

  return candidates;
}

async function fetchWebsiteMenuItems(input: FetchMenuInput): Promise<ExternalMenuItem[]> {
  const candidateUrls = await resolveWebsiteCandidates(input);
  if (!candidateUrls.length) {
    return [];
  }

  const rawCandidates: string[] = [];

  for (const url of candidateUrls) {
    const html = await fetchHtmlPage(url);
    if (!html) {
      continue;
    }

    rawCandidates.push(...extractMenuCandidatesFromJsonLd(html));
    rawCandidates.push(...extractTaggedTextCandidates(html, url));

    if (rawCandidates.length >= MAX_MENU_ITEMS * 6) {
      break;
    }
  }

  const mapped = rawCandidates
    .map((candidate) => mapToExternalMenuItem(candidate))
    .filter((item): item is ExternalMenuItem => Boolean(item));

  return dedupeItems(mapped).slice(0, MAX_MENU_ITEMS);
}

/**
 * Google Places does not provide a reliable structured list of full menu items.
 * We therefore never derive dishes from Google review/editorial text.
 * Instead, we use Places metadata (website/place identity) and scrape menu pages.
 */
export async function fetchMenuForRestaurant(input: FetchMenuInput): Promise<ExternalMenuFetchResult> {
  const websiteItems = await fetchWebsiteMenuItems(input);

  return {
    provider: websiteItems.length ? 'website-scrape' : 'google-places',
    items: websiteItems,
  };
}
