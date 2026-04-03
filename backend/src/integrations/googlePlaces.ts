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

function buildRestaurantSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return 'restaurants';
  }

  if (/\brestaurants?\b/i.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed} restaurants`;
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
    const nearbyParams = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: String(DEFAULT_SEARCH_RADIUS_METERS),
      type: 'restaurant',
      key: env.googlePlacesApiKey,
    });

    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${nearbyParams.toString()}`;
    const nearbySearch = await axios.get<GooglePlaceTextSearchResponse>(nearbyUrl);

    if (nearbySearch.data.status && nearbySearch.data.status !== 'OK' && nearbySearch.data.status !== 'ZERO_RESULTS') {
      throw new Error(
        `Google Places nearby search failed: ${nearbySearch.data.status}${
          nearbySearch.data.error_message ? ` - ${nearbySearch.data.error_message}` : ''
        }`,
      );
    }

    places = (nearbySearch.data.results ?? []).slice(0, 10);
  } else {
    const textParams = new URLSearchParams({
      query: searchQuery,
      type: 'restaurant',
      key: env.googlePlacesApiKey,
    });

    const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?${textParams.toString()}`;
    const textSearch = await axios.get<GooglePlaceTextSearchResponse>(textSearchUrl);

    if (textSearch.data.status && textSearch.data.status !== 'OK' && textSearch.data.status !== 'ZERO_RESULTS') {
      throw new Error(
        `Google Places text search failed: ${textSearch.data.status}${
          textSearch.data.error_message ? ` - ${textSearch.data.error_message}` : ''
        }`,
      );
    }

    places = (textSearch.data.results ?? []).slice(0, 10);
  }

  const enriched = await Promise.all(
    places.map(async (place) => {
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website&key=${env.googlePlacesApiKey}`;
      const detail = await axios.get<GooglePlaceDetailResponse>(detailUrl);
      const result = detail.data.result ?? {};

      const resolvedName = result.name ?? place.name ?? 'Unknown Restaurant';

      return {
        placeId: place.place_id,
        name: resolvedName,
        address: result.formatted_address ?? place.formatted_address ?? '',
        phone: result.formatted_phone_number,
        website: result.website,
      } as PlaceResult;
    }),
  );

  return enriched;
}
