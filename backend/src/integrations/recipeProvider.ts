import axios from 'axios';
import { env } from '../config/env';

export type RecipeMatch = {
  title: string;
  link: string;
};

type GoogleCustomSearchItem = {
  title?: string;
  link?: string;
};

type GoogleCustomSearchResponse = {
  items?: GoogleCustomSearchItem[];
};

type RecipePageCandidate = {
  title: string;
  link: string;
  ratingValue: number;
  ratingCount: number;
  similarity: number;
};

const MAX_SEARCH_RESULTS = 8;
const MAX_PAGE_BYTES = 1_500_000;
const SEARCH_TIMEOUT_MS = 7000;
const PAGE_TIMEOUT_MS = 7000;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function similarityScore(dishName: string, recipeTitle: string): number {
  const dishTokens = new Set(tokenize(dishName));
  const titleTokens = new Set(tokenize(recipeTitle));

  if (!dishTokens.size || !titleTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of dishTokens) {
    if (titleTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(dishTokens.size, titleTokens.size);
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
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

function isRecipeNode(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') {
    return false;
  }

  const typeValue = (node as Record<string, unknown>)['@type'];

  if (typeof typeValue === 'string') {
    return typeValue.toLowerCase().includes('recipe');
  }

  if (Array.isArray(typeValue)) {
    return typeValue.some((item) => typeof item === 'string' && item.toLowerCase().includes('recipe'));
  }

  return false;
}

function collectRecipeNodes(node: unknown, sink: Array<Record<string, unknown>>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRecipeNodes(item, sink);
    }
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;

  if (isRecipeNode(record)) {
    sink.push(record);
  }

  if (Array.isArray(record['@graph'])) {
    collectRecipeNodes(record['@graph'], sink);
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      collectRecipeNodes(value, sink);
    }
  }
}

function extractRecipeMetadataFromHtml(html: string, fallbackTitle: string, link: string): RecipePageCandidate | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const recipeNodes: Array<Record<string, unknown>> = [];

  for (const match of html.matchAll(scriptRegex)) {
    const payload = match[1] ?? '';
    const blocks = parseJsonLdPayload(payload);
    for (const block of blocks) {
      collectRecipeNodes(block, recipeNodes);
    }
  }

  const candidateNode = recipeNodes.find((node) => typeof node.name === 'string') ?? recipeNodes[0];

  const resolvedTitle =
    (candidateNode && typeof candidateNode.name === 'string' ? candidateNode.name.trim() : '') || fallbackTitle;

  const aggregateRating = (candidateNode?.aggregateRating ?? null) as
    | Record<string, unknown>
    | Array<Record<string, unknown>>
    | null;

  const ratingRecord = Array.isArray(aggregateRating) ? aggregateRating[0] : aggregateRating;

  const ratingValue = parseNumber(ratingRecord?.ratingValue);
  const ratingCount = parseNumber(ratingRecord?.ratingCount ?? ratingRecord?.reviewCount);

  return {
    title: resolvedTitle,
    link,
    ratingValue,
    ratingCount,
    similarity: 0,
  };
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await axios.get<string>(url, {
      timeout: PAGE_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: MAX_PAGE_BYTES,
      maxBodyLength: MAX_PAGE_BYTES,
      headers: {
        'User-Agent': 'PlateRankRecipeBot/1.0 (+https://platerank.local)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

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

function rankCandidates(dishName: string, candidates: RecipePageCandidate[]): RecipePageCandidate[] {
  const scored = candidates.map((candidate) => ({
    ...candidate,
    similarity: similarityScore(dishName, candidate.title),
  }));

  const pool = scored.some((candidate) => candidate.similarity > 0)
    ? scored.filter((candidate) => candidate.similarity > 0)
    : scored;

  return pool.sort((a, b) => {
    if (b.ratingValue !== a.ratingValue) {
      return b.ratingValue - a.ratingValue;
    }

    if (b.ratingCount !== a.ratingCount) {
      return b.ratingCount - a.ratingCount;
    }

    if (b.similarity !== a.similarity) {
      return b.similarity - a.similarity;
    }

    return a.title.localeCompare(b.title);
  });
}

function fallbackGoogleSearchLink(query: string): RecipeMatch {
  return {
    title: `${query} recipe results`,
    link: `https://www.google.com/search?q=${encodeURIComponent(`${query} recipe`)}`,
  };
}

async function searchGoogleRecipePages(query: string): Promise<GoogleCustomSearchItem[]> {
  if (!env.recipeApiKey || !env.recipeSearchCx) {
    return [];
  }

  const params = new URLSearchParams({
    key: env.recipeApiKey,
    cx: env.recipeSearchCx,
    q: `${query} recipe`,
    num: String(MAX_SEARCH_RESULTS),
  });

  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  const response = await axios.get<GoogleCustomSearchResponse>(url, {
    timeout: SEARCH_TIMEOUT_MS,
  });

  return response.data.items ?? [];
}

export async function findRecipeMatch(query: string): Promise<RecipeMatch | null> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return null;
  }

  const searchItems = await searchGoogleRecipePages(trimmedQuery).catch(() => []);

  if (!searchItems.length) {
    return fallbackGoogleSearchLink(trimmedQuery);
  }

  const pageCandidates: RecipePageCandidate[] = [];

  for (const item of searchItems) {
    if (!item.link) {
      continue;
    }

    const pageHtml = await fetchHtml(item.link);
    if (!pageHtml) {
      continue;
    }

    const metadata = extractRecipeMetadataFromHtml(pageHtml, item.title ?? trimmedQuery, item.link);
    if (!metadata) {
      continue;
    }

    pageCandidates.push(metadata);
  }

  if (!pageCandidates.length) {
    const first = searchItems.find((item) => item.link);
    if (!first?.link) {
      return fallbackGoogleSearchLink(trimmedQuery);
    }

    return {
      title: first.title?.trim() || `${trimmedQuery} recipe`,
      link: first.link,
    };
  }

  const ranked = rankCandidates(trimmedQuery, pageCandidates);
  const best = ranked[0];

  return {
    title: best.title,
    link: best.link,
  };
}
