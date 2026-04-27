import axios from 'axios';
import { env } from '../config/env';

type PlaceResult = {
  placeId: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  types: string[];
};

type GooglePlaceTextSearchItem = {
  place_id: string;
  name?: string;
  formatted_address?: string;
  types?: string[];
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

type GooglePlaceTextSearchResponse = {
  status?: string;
  error_message?: string;
  next_page_token?: string;
  results?: GooglePlaceTextSearchItem[];
};

type GooglePlaceDetailResponse = {
  status?: string;
  error_message?: string;
  result?: {
    name?: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    website?: string;
    types?: string[];
  };
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
};

type LatLng = {
  lat: number;
  lng: number;
};

const DEFAULT_SEARCH_RADIUS_MILES = 5;
const SUPPORTED_RADIUS_MILES = new Set([5, 10, 20, 50]);
const MILES_TO_METERS = 1_609.34;
const MAX_GOOGLE_RADIUS_METERS = 50_000;
const MAX_SEARCH_RESULTS = 80;
const NEXT_PAGE_TOKEN_DELAY_MS = 2_000;
const NEXT_PAGE_TOKEN_RETRY_DELAY_MS = 1_000;
const NEXT_PAGE_TOKEN_MAX_RETRIES = 3;
const STRONG_RESTAURANT_NAME_MATCH_SCORE = 2;

const BROAD_RESTAURANT_QUERY_WORDS = new Set([
  'restaurant',
  'restaurants',
  'food',
  'dining',
  'near',
  'nearby',
  'local',
  'best',
  'top',
  'pizza',
  'burgers',
  'burger',
  'sushi',
  'tacos',
  'mexican',
  'italian',
  'chinese',
  'thai',
  'indian',
  'japanese',
  'korean',
  'vietnamese',
  'bbq',
  'barbecue',
  'steak',
  'seafood',
  'vegan',
  'vegetarian',
  'breakfast',
  'brunch',
  'diner',
  'cafe',
  'coffee',
]);

function normalizeRestaurantMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNormalizedRestaurantText(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.split(' ').filter((token) => token.length >= 2);
}

function tokenizeRestaurantMatchText(value: string): string[] {
  return tokenizeNormalizedRestaurantText(normalizeRestaurantMatchText(value));
}

function computeRestaurantNameMatchScore(query: string, candidateName?: string): number {
  const normalizedQuery = normalizeRestaurantMatchText(query);
  const normalizedCandidate = normalizeRestaurantMatchText(candidateName ?? '');

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (normalizedCandidate === normalizedQuery) {
    return 4;
  }

  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
    return 3;
  }

  const queryTokens = tokenizeNormalizedRestaurantText(normalizedQuery);
  const candidateTokens = tokenizeNormalizedRestaurantText(normalizedCandidate);
  if (!queryTokens.length || !candidateTokens.length) {
    return 0;
  }

  const candidateTokenSet = new Set(candidateTokens);
  const overlapCount = queryTokens.filter((token) => candidateTokenSet.has(token)).length;
  if (overlapCount === queryTokens.length && queryTokens.length >= 2) {
    return 2;
  }

  if (queryTokens.length >= 2 && overlapCount / queryTokens.length >= 0.75) {
    return 1;
  }

  return 0;
}

function hasStrongRestaurantNameMatch(places: GooglePlaceTextSearchItem[], query: string): boolean {
  return places.some(
    (place) => computeRestaurantNameMatchScore(query, place.name) >= STRONG_RESTAURANT_NAME_MATCH_SCORE,
  );
}

function filterStrongRestaurantNameMatches(
  places: GooglePlaceTextSearchItem[],
  query: string,
): GooglePlaceTextSearchItem[] {
  return places.filter(
    (place) => computeRestaurantNameMatchScore(query, place.name) >= STRONG_RESTAURANT_NAME_MATCH_SCORE,
  );
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function isLikelyExactRestaurantNameQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  if (isPostalCodeQuery(trimmed) || queryLooksLikeLocation(trimmed)) {
    return false;
  }

  const tokens = tokenizeRestaurantMatchText(trimmed);
  if (!tokens.length) {
    return false;
  }

  if (tokens.length === 1) {
    return !BROAD_RESTAURANT_QUERY_WORDS.has(tokens[0]);
  }

  return !tokens.every((token) => BROAD_RESTAURANT_QUERY_WORDS.has(token));
}

function isPostalCodeQuery(query: string): boolean {
  const trimmed = query.trim();
  return /^\d{5}(?:-\d{4})?$/.test(trimmed);
}

function buildRestaurantSearchQuery(query: string, location?: string): string {
  const trimmed = query.trim();
  const trimmedLocation = location?.trim();

  const appendLocation = (value: string): string => {
    if (!trimmedLocation) {
      return value;
    }

    if (value.toLowerCase().includes(trimmedLocation.toLowerCase())) {
      return value;
    }

    return `${value} in ${trimmedLocation}`;
  };

  if (!trimmed) {
    return appendLocation('restaurants');
  }

  if (isLikelyExactRestaurantNameQuery(trimmed)) {
    return appendLocation(trimmed);
  }

  if (isPostalCodeQuery(trimmed)) {
    return `restaurants in ${trimmed}`;
  }

  if (/\brestaurants?\b/i.test(trimmed)) {
    return appendLocation(trimmed);
  }

  return appendLocation(`${trimmed} restaurants`);
}

function queryLooksLikeLocation(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  if (isPostalCodeQuery(trimmed)) {
    return true;
  }

  if (/\d{1,5}\s+\w+/.test(trimmed)) {
    return true;
  }

  return trimmed.includes(',');
}

function buildNearbyKeyword(query: string): string {
  const trimmed = query.trim();
  if (!trimmed || isPostalCodeQuery(trimmed)) {
    return 'restaurant';
  }

  if (/^restaurants?$/i.test(trimmed)) {
    return 'restaurant';
  }

  return trimmed;
}

function assertGooglePlacesStatus(
  operation: 'text search' | 'nearby search' | 'details' | 'geocode',
  status?: string,
  errorMessage?: string,
): void {
  if (!status || status === 'OK' || status === 'ZERO_RESULTS') {
    return;
  }

  throw new Error(
    `Google Places ${operation} failed: ${status}${errorMessage ? ` - ${errorMessage}` : ''}`,
  );
}

function normalizeRadiusMiles(radiusMiles?: number): number {
  if (radiusMiles && SUPPORTED_RADIUS_MILES.has(radiusMiles)) {
    return radiusMiles;
  }

  return DEFAULT_SEARCH_RADIUS_MILES;
}

function milesToMeters(miles: number): number {
  return Math.round(miles * MILES_TO_METERS);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function calculateDistanceMeters(from: LatLng, to: LatLng): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPlaceCoordinates(place: GooglePlaceTextSearchItem): LatLng | null {
  const location = place.geometry?.location;
  if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') {
    return null;
  }

  return {
    lat: location.lat,
    lng: location.lng,
  };
}

function filterPlacesWithinRadius(
  places: GooglePlaceTextSearchItem[],
  center: LatLng,
  radiusMeters: number,
): GooglePlaceTextSearchItem[] {
  return places.filter((place) => {
    const coordinates = getPlaceCoordinates(place);
    if (!coordinates) {
      return false;
    }

    return calculateDistanceMeters(center, coordinates) <= radiusMeters;
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function offsetLatLng(origin: LatLng, northMeters: number, eastMeters: number): LatLng {
  const earthRadiusMeters = 6_378_137;
  const dLat = northMeters / earthRadiusMeters;
  const cosLatitude = Math.max(0.01, Math.cos((origin.lat * Math.PI) / 180));
  const dLng = eastMeters / (earthRadiusMeters * cosLatitude);

  return {
    lat: origin.lat + (dLat * 180) / Math.PI,
    lng: origin.lng + (dLng * 180) / Math.PI,
  };
}

function buildCoverageCenters(lat: number, lng: number, radiusMeters: number): Array<LatLng & { radiusMeters: number }> {
  if (radiusMeters <= MAX_GOOGLE_RADIUS_METERS) {
    return [{ lat, lng, radiusMeters }];
  }

  const offsetMeters = radiusMeters - MAX_GOOGLE_RADIUS_METERS;
  const origin = { lat, lng };
  const offsetPairs: Array<{ north: number; east: number }> = [
    { north: 0, east: 0 },
    { north: offsetMeters, east: 0 },
    { north: -offsetMeters, east: 0 },
    { north: 0, east: offsetMeters },
    { north: 0, east: -offsetMeters },
    { north: offsetMeters, east: offsetMeters },
    { north: offsetMeters, east: -offsetMeters },
    { north: -offsetMeters, east: offsetMeters },
    { north: -offsetMeters, east: -offsetMeters },
  ];

  return offsetPairs.map((pair) => {
    const shifted = offsetLatLng(origin, pair.north, pair.east);
    return {
      ...shifted,
      radiusMeters: MAX_GOOGLE_RADIUS_METERS,
    };
  });
}

function dedupePlaceItems(items: GooglePlaceTextSearchItem[]): GooglePlaceTextSearchItem[] {
  const byPlaceId = new Map<string, GooglePlaceTextSearchItem>();

  for (const item of items) {
    if (!item.place_id || byPlaceId.has(item.place_id)) {
      continue;
    }

    byPlaceId.set(item.place_id, item);
  }

  return Array.from(byPlaceId.values());
}

async function fetchPaginatedPlaceResults(args: {
  endpoint: 'textsearch' | 'nearbysearch';
  operation: 'text search' | 'nearby search';
  params: URLSearchParams;
}): Promise<GooglePlaceTextSearchItem[]> {
  const results: GooglePlaceTextSearchItem[] = [];
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;

  while (results.length < MAX_SEARCH_RESULTS) {
    const requestParams = new URLSearchParams(args.params.toString());

    if (nextPageToken) {
      requestParams.set('pagetoken', nextPageToken);
      await wait(NEXT_PAGE_TOKEN_DELAY_MS);
    }

    const url = `https://maps.googleapis.com/maps/api/place/${args.endpoint}/json?${requestParams.toString()}`;
    let response = await axios.get<GooglePlaceTextSearchResponse>(url);

    if (nextPageToken && response.data.status === 'INVALID_REQUEST') {
      let retries = 0;
      while (response.data.status === 'INVALID_REQUEST' && retries < NEXT_PAGE_TOKEN_MAX_RETRIES) {
        retries += 1;
        await wait(NEXT_PAGE_TOKEN_RETRY_DELAY_MS);
        response = await axios.get<GooglePlaceTextSearchResponse>(url);
      }

      if (response.data.status === 'INVALID_REQUEST') {
        break;
      }
    }

    assertGooglePlacesStatus(args.operation, response.data.status, response.data.error_message);
    results.push(...(response.data.results ?? []));

    if (results.length >= MAX_SEARCH_RESULTS) {
      break;
    }

    const token = response.data.next_page_token;
    if (!token || seenTokens.has(token)) {
      break;
    }

    seenTokens.add(token);
    nextPageToken = token;
  }

  return results.slice(0, MAX_SEARCH_RESULTS);
}

async function textSearchPlaces(args: {
  query: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}): Promise<GooglePlaceTextSearchItem[]> {
  const params = new URLSearchParams({
    query: args.query,
    key: env.googlePlacesApiKey,
  });

  if (args.lat !== undefined && args.lng !== undefined) {
    params.set('location', `${args.lat},${args.lng}`);

    if (args.radiusMeters !== undefined) {
      params.set('radius', String(Math.min(args.radiusMeters, MAX_GOOGLE_RADIUS_METERS)));
    }
  }

  return fetchPaginatedPlaceResults({
    endpoint: 'textsearch',
    operation: 'text search',
    params,
  });
}

async function nearbySearchPlaces(args: {
  lat: number;
  lng: number;
  radiusMeters: number;
  keyword: string;
}): Promise<GooglePlaceTextSearchItem[]> {
  const nearbyParams = new URLSearchParams({
    location: `${args.lat},${args.lng}`,
    radius: String(Math.min(args.radiusMeters, MAX_GOOGLE_RADIUS_METERS)),
    keyword: args.keyword,
    key: env.googlePlacesApiKey,
  });

  return fetchPaginatedPlaceResults({
    endpoint: 'nearbysearch',
    operation: 'nearby search',
    params: nearbyParams,
  });
}

async function geocodeQueryToLatLng(query: string): Promise<LatLng | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const geocodeParams = new URLSearchParams({
    address: trimmed,
    key: env.googlePlacesApiKey,
  });

  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?${geocodeParams.toString()}`;
  const geocode = await axios.get<GoogleGeocodeResponse>(geocodeUrl);
  assertGooglePlacesStatus('geocode', geocode.data.status, geocode.data.error_message);

  const location = geocode.data.results?.[0]?.geometry?.location;
  if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') {
    return null;
  }

  return {
    lat: location.lat,
    lng: location.lng,
  };
}

function fallbackMockResults(query: string): PlaceResult[] {
  return [
    {
      placeId: `mock-${query.toLowerCase().replace(/\s+/g, '-')}-1`,
      name: `${query} Kitchen`,
      address: '123 Main St',
      phone: '(555) 000-1111',
      website: 'https://example.com',
      types: ['restaurant'],
    },
    {
      placeId: `mock-${query.toLowerCase().replace(/\s+/g, '-')}-2`,
      name: `${query} Bistro`,
      address: '456 Oak Ave',
      phone: '(555) 000-2222',
      website: 'https://example.com',
      types: ['restaurant'],
    },
  ];
}

export async function searchGooglePlaces(args: {
  query: string;
  location?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
}): Promise<PlaceResult[]> {
  const { query, location, lat, lng } = args;
  const normalizedRadiusMiles = normalizeRadiusMiles(args.radiusMiles);
  const radiusMeters = milesToMeters(normalizedRadiusMiles);

  if (!env.googlePlacesApiKey) {
    return fallbackMockResults(query);
  }

  const searchQuery = buildRestaurantSearchQuery(query, location);
  const exactNameIntent = isLikelyExactRestaurantNameQuery(query);
  const nearbyKeyword = buildNearbyKeyword(query);
  const geocodeTarget = location?.trim() || (queryLooksLikeLocation(query) ? query.trim() : undefined);
  let places: GooglePlaceTextSearchItem[] = [];

  const resolvedLocation =
    lat !== undefined && lng !== undefined
      ? { lat, lng }
      : geocodeTarget
        ? await geocodeQueryToLatLng(geocodeTarget)
        : null;

  if (resolvedLocation) {
    const centers = buildCoverageCenters(resolvedLocation.lat, resolvedLocation.lng, radiusMeters);
    const nearbyResults = await Promise.all(
      centers.map((center) =>
        nearbySearchPlaces({
          lat: center.lat,
          lng: center.lng,
          radiusMeters: center.radiusMeters,
          keyword: nearbyKeyword,
        }),
      ),
    );

    places = dedupePlaceItems(nearbyResults.flat());
    places = filterPlacesWithinRadius(places, resolvedLocation, radiusMeters);

    if (!places.length) {
      const fallbackTextResults = await Promise.all(
        centers.map((center) =>
          textSearchPlaces({
            query: searchQuery,
            lat: center.lat,
            lng: center.lng,
            radiusMeters: center.radiusMeters,
          }),
        ),
      );

      places = dedupePlaceItems(fallbackTextResults.flat());
      places = filterPlacesWithinRadius(places, resolvedLocation, radiusMeters);
    }

    if (exactNameIntent) {
      const exactNameQueries = uniqueNonEmptyStrings([query, searchQuery]);

      const exactNameResults = await Promise.all(
        exactNameQueries.map((exactNameQuery) =>
          textSearchPlaces({
            query: exactNameQuery,
          }),
        ),
      );

      const strongNameMatches = filterStrongRestaurantNameMatches(
        dedupePlaceItems(exactNameResults.flat()),
        query,
      );

      if (strongNameMatches.length) {
        places = dedupePlaceItems([...strongNameMatches, ...places]);
      }
    }
  } else {
    places = await textSearchPlaces({ query: searchQuery });

    if (!places.length && isPostalCodeQuery(query) && !location?.trim()) {
      places = await textSearchPlaces({ query: query.trim() });
    }
  }

  const placesToEnrich = dedupePlaceItems(places).slice(0, MAX_SEARCH_RESULTS);

  const enriched = await Promise.all(
    placesToEnrich.map(async (place) => {
      const placeId = place.place_id;
      if (!placeId) {
        return null;
      }

      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,types&key=${env.googlePlacesApiKey}`;
        const detail = await axios.get<GooglePlaceDetailResponse>(detailUrl);
        assertGooglePlacesStatus('details', detail.data.status, detail.data.error_message);
        const result = detail.data.result ?? {};

        const resolvedName = result.name ?? place.name ?? 'Unknown Restaurant';

        return {
          placeId,
          name: resolvedName,
          address: result.formatted_address ?? place.formatted_address ?? '',
          phone: result.formatted_phone_number,
          website: result.website,
          types: result.types ?? place.types ?? [],
        } as PlaceResult;
      } catch {
        return {
          placeId,
          name: place.name ?? 'Unknown Restaurant',
          address: place.formatted_address ?? '',
          types: place.types ?? [],
        } as PlaceResult;
      }
    }),
  );

  return enriched.filter((item): item is PlaceResult => Boolean(item));
}
