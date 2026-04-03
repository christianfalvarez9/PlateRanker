import axios from 'axios';
import { env } from '../config/env';

type PlaceResult = {
  placeId: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
};

type GooglePlaceTextSearchItem = {
  place_id: string;
  name?: string;
  formatted_address?: string;
};

type GooglePlaceTextSearchResponse = {
  status?: string;
  error_message?: string;
  results?: GooglePlaceTextSearchItem[];
};

type GooglePlaceDetailResponse = {
  result?: {
    name?: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    website?: string;
  };
};

const DEFAULT_SEARCH_RADIUS_METERS = 20_000;
const MAX_SEARCH_RESULTS = 10;

function isPostalCodeQuery(query: string): boolean {
  const trimmed = query.trim();
  return /^\d{5}(?:-\d{4})?$/.test(trimmed);
}

function buildRestaurantSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return 'restaurants';
  }

  if (isPostalCodeQuery(trimmed)) {
    return `restaurants in ${trimmed}`;
  }

  if (/\brestaurants?\b/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed} restaurants`;
}

function assertGooglePlacesStatus(
  operation: 'text search' | 'nearby search' | 'details',
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

async function textSearchPlaces(args: {
  query: string;
  lat?: number;
  lng?: number;
}): Promise<GooglePlaceTextSearchItem[]> {
  const params = new URLSearchParams({
    query: args.query,
    key: env.googlePlacesApiKey,
  });

  if (args.lat !== undefined && args.lng !== undefined) {
    params.set('location', `${args.lat},${args.lng}`);
    params.set('radius', String(DEFAULT_SEARCH_RADIUS_METERS));
  }

  const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
  const textSearch = await axios.get<GooglePlaceTextSearchResponse>(textSearchUrl);

  assertGooglePlacesStatus('text search', textSearch.data.status, textSearch.data.error_message);
  return (textSearch.data.results ?? []).slice(0, MAX_SEARCH_RESULTS);
}

async function nearbySearchPlaces(lat: number, lng: number): Promise<GooglePlaceTextSearchItem[]> {
  const nearbyParams = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: String(DEFAULT_SEARCH_RADIUS_METERS),
    keyword: 'restaurant',
    key: env.googlePlacesApiKey,
  });

  const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${nearbyParams.toString()}`;
  const nearbySearch = await axios.get<GooglePlaceTextSearchResponse>(nearbyUrl);

  assertGooglePlacesStatus('nearby search', nearbySearch.data.status, nearbySearch.data.error_message);
  return (nearbySearch.data.results ?? []).slice(0, MAX_SEARCH_RESULTS);
}

function fallbackMockResults(query: string): PlaceResult[] {
  return [
    {
      placeId: `mock-${query.toLowerCase().replace(/\s+/g, '-')}-1`,
      name: `${query} Kitchen`,
      address: '123 Main St',
      phone: '(555) 000-1111',
      website: 'https://example.com',
    },
    {
      placeId: `mock-${query.toLowerCase().replace(/\s+/g, '-')}-2`,
      name: `${query} Bistro`,
      address: '456 Oak Ave',
      phone: '(555) 000-2222',
      website: 'https://example.com',
    },
  ];
}

export async function searchGooglePlaces(args: {
  query: string;
  lat?: number;
  lng?: number;
}): Promise<PlaceResult[]> {
  const { query, lat, lng } = args;

  if (!env.googlePlacesApiKey) {
    return fallbackMockResults(query);
  }

  const searchQuery = buildRestaurantSearchQuery(query);
  let places: GooglePlaceTextSearchItem[] = [];

  if (lat !== undefined && lng !== undefined) {
    places = await nearbySearchPlaces(lat, lng);

    if (!places.length) {
      places = await textSearchPlaces({
        query: searchQuery,
        lat,
        lng,
      });
    }
  } else {
    places = await textSearchPlaces({ query: searchQuery });

    if (!places.length && isPostalCodeQuery(query)) {
      places = await textSearchPlaces({ query: query.trim() });
    }
  }

  const enriched = await Promise.all(
    places.map(async (place) => {
      const placeId = place.place_id;
      if (!placeId) {
        return null;
      }

      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website&key=${env.googlePlacesApiKey}`;
        const detail = await axios.get<GooglePlaceDetailResponse>(detailUrl);
        assertGooglePlacesStatus('details', (detail.data as GooglePlaceTextSearchResponse).status, (detail.data as GooglePlaceTextSearchResponse).error_message);
        const result = detail.data.result ?? {};

        const resolvedName = result.name ?? place.name ?? 'Unknown Restaurant';

        return {
          placeId,
          name: resolvedName,
          address: result.formatted_address ?? place.formatted_address ?? '',
          phone: result.formatted_phone_number,
          website: result.website,
        } as PlaceResult;
      } catch {
        return {
          placeId,
          name: place.name ?? 'Unknown Restaurant',
          address: place.formatted_address ?? '',
        } as PlaceResult;
      }
    }),
  );

  return enriched.filter((item): item is PlaceResult => Boolean(item));
}
