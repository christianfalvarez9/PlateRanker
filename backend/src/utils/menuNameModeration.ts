const BLOCKED_TERMS = [
  'asshole',
  'bastard',
  'bitch',
  'bullshit',
  'damn',
  'dick',
  'fuck',
  'fucker',
  'fucking',
  'shit',
] as const;

function normalizeForModeration(value: string): string {
  return value
    .toLowerCase()
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

function tokenize(value: string): string[] {
  const normalized = normalizeForModeration(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  return normalized.split(' ').filter(Boolean);
}

export function findBlockedTermInDishName(name: string): string | null {
  const tokens = tokenize(name);
  if (!tokens.length) {
    return null;
  }

  for (const blockedTerm of BLOCKED_TERMS) {
    if (tokens.includes(blockedTerm)) {
      return blockedTerm;
    }
  }

  return null;
}
