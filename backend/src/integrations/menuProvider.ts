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
};

export type MenuProviderId = 'mock' | 'spoonacular' | 'spoonacular-fallback-mock';

export type ExternalMenuFetchResult = {
  provider: MenuProviderId;
  items: ExternalMenuItem[];
};

type SpoonacularMenuSearchResponse = {
  menuItems?: Array<{ title?: string }>;
  results?: Array<{ title?: string }>;
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

function fallbackMockResults(_restaurantName: string): ExternalMenuItem[] {
  return [
    {
      name: 'House Salad',
      category: DishCategory.APPETIZER,
      source: DishSource.API,
      status: DishStatus.ACTIVE,
    },
    {
      name: 'Signature Burger',
      category: DishCategory.ENTREE,
      source: DishSource.API,
      status: DishStatus.ACTIVE,
    },
    {
      name: 'Truffle Fries',
      category: DishCategory.SIDE,
      source: DishSource.API,
      status: DishStatus.ACTIVE,
    },
    {
      name: 'Chocolate Cake',
      category: DishCategory.DESSERT,
      source: DishSource.API,
      status: DishStatus.SEASONAL,
    },
  ];
}

function configuredMenuProvider(): 'mock' | 'spoonacular' {
  return env.menuProvider.toLowerCase() === 'spoonacular' ? 'spoonacular' : 'mock';
}

async function fetchSpoonacularMenuItems(input: FetchMenuInput): Promise<ExternalMenuItem[]> {
  const response = await requestWithRetry(() =>
    axios.get<SpoonacularMenuSearchResponse>('https://api.spoonacular.com/food/menuItems/search', {
      params: {
        query: input.name,
        number: 40,
        apiKey: env.menuApiKey,
      },
      timeout: 8000,
    }),
  );

  const rawItems = [...(response.data.menuItems ?? []), ...(response.data.results ?? [])];
  const mapped = rawItems
    .map((entry) => entry.title ?? '')
    .map((name) => mapToExternalMenuItem(name))
    .filter((item): item is ExternalMenuItem => Boolean(item));

  return dedupeItems(mapped);
}

export async function fetchMenuForRestaurant(input: FetchMenuInput): Promise<ExternalMenuFetchResult> {
  const provider = configuredMenuProvider();

  if (provider === 'spoonacular') {
    if (!env.menuApiKey) {
      return {
        provider: 'spoonacular-fallback-mock',
        items: fallbackMockResults(input.name),
      };
    }

    const items = await fetchSpoonacularMenuItems(input);
    return {
      provider: 'spoonacular',
      items,
    };
  }

  return {
    provider: 'mock',
    items: fallbackMockResults(input.name),
  };
}
