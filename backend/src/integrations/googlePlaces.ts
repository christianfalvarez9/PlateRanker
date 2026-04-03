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

type GooglePlaceDetailResponse = {
  result?: {
    name?: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    website?: string;
  };
};

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

  const locationBias = lat !== undefined && lng !== undefined ? `&locationbias=circle:20000@${lat},${lng}` : '';
  const textSearchUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      `${query} restaurants`,
    )}${locationBias}&key=${env.googlePlacesApiKey}`;

  const textSearch = await axios.get<{ results?: GooglePlaceTextSearchItem[] }>(textSearchUrl);
  const places = (textSearch.data.results ?? []).slice(0, 10);

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
