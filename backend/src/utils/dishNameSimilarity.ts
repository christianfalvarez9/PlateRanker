export type DishNameSimilarityReason = 'EXACT' | 'TOKEN_SET' | 'FUZZY';

export type DishNameSimilarityMatch = {
  existingName: string;
  reason: DishNameSimilarityReason;
  score: number;
};

const TOKEN_EXPANSIONS: Record<string, string> = {
  n: 'and',
  w: 'with',
  chkn: 'chicken',
  chk: 'chicken',
  parm: 'parmesan',
  parmigiana: 'parmesan',
  bbq: 'barbecue',
  chz: 'cheese',
  mozz: 'mozzarella',
};

function tokenizeDishName(value: string): string[] {
  const prepared = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' and ')
    .replace(/\bw\s*\//g, ' with ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!prepared) {
    return [];
  }

  return prepared
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => TOKEN_EXPANSIONS[token] ?? token);
}

function canonicalizeDishName(value: string): string {
  return tokenizeDishName(value).join(' ');
}

function buildTokenSetKey(tokens: string[]): string {
  return Array.from(new Set(tokens)).sort((a, b) => a.localeCompare(b)).join(' ');
}

function tokenSetJaccardSimilarity(firstTokens: string[], secondTokens: string[]): number {
  const first = new Set(firstTokens);
  const second = new Set(secondTokens);

  if (!first.size || !second.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of first) {
    if (second.has(token)) {
      overlap += 1;
    }
  }

  const unionSize = first.size + second.size - overlap;
  return unionSize === 0 ? 0 : overlap / unionSize;
}

function levenshteinDistance(first: string, second: string): number {
  if (first === second) {
    return 0;
  }

  if (!first.length) {
    return second.length;
  }

  if (!second.length) {
    return first.length;
  }

  const previousRow: number[] = [];
  for (let index = 0; index <= second.length; index += 1) {
    previousRow.push(index);
  }

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const currentRow = [firstIndex];

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;

      currentRow[secondIndex] = Math.min(
        previousRow[secondIndex] + 1,
        currentRow[secondIndex - 1] + 1,
        previousRow[secondIndex - 1] + substitutionCost,
      );
    }

    for (let secondIndex = 0; secondIndex <= second.length; secondIndex += 1) {
      previousRow[secondIndex] = currentRow[secondIndex];
    }
  }

  return previousRow[second.length];
}

function normalizedStringSimilarity(first: string, second: string): number {
  if (!first || !second) {
    return 0;
  }

  if (first === second) {
    return 1;
  }

  const distance = levenshteinDistance(first, second);
  return 1 - distance / Math.max(first.length, second.length);
}

export function findSimilarDishName(
  inputName: string,
  existingDishNames: string[],
): DishNameSimilarityMatch | null {
  const inputTokens = tokenizeDishName(inputName);
  const inputCanonical = inputTokens.join(' ');
  if (!inputCanonical) {
    return null;
  }

  const inputTokenSetKey = buildTokenSetKey(inputTokens);
  let bestFuzzyMatch: DishNameSimilarityMatch | null = null;

  for (const existingName of existingDishNames) {
    const existingCanonical = canonicalizeDishName(existingName);
    if (!existingCanonical) {
      continue;
    }

    if (existingCanonical === inputCanonical) {
      return {
        existingName,
        reason: 'EXACT',
        score: 1,
      };
    }

    const existingTokens = tokenizeDishName(existingName);
    if (buildTokenSetKey(existingTokens) === inputTokenSetKey) {
      return {
        existingName,
        reason: 'TOKEN_SET',
        score: 0.99,
      };
    }

    const charSimilarity = normalizedStringSimilarity(inputCanonical, existingCanonical);
    const tokenSimilarity = tokenSetJaccardSimilarity(inputTokens, existingTokens);
    const shortestCanonicalLength = Math.min(inputCanonical.length, existingCanonical.length);

    const isFuzzyDuplicate =
      (shortestCanonicalLength >= 10 && charSimilarity >= 0.88 && tokenSimilarity >= 0.5) ||
      (shortestCanonicalLength >= 6 && charSimilarity >= 0.92) ||
      (tokenSimilarity >= 0.85 && charSimilarity >= 0.8);

    if (!isFuzzyDuplicate) {
      continue;
    }

    const score = charSimilarity * 0.75 + tokenSimilarity * 0.25;
    if (!bestFuzzyMatch || score > bestFuzzyMatch.score) {
      bestFuzzyMatch = {
        existingName,
        reason: 'FUZZY',
        score,
      };
    }
  }

  return bestFuzzyMatch;
}