'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { Restaurant } from '@/lib/types';
import { getToken, getUser } from '@/lib/auth';

type WantToVisitResponse = {
  id: string;
  createdAt: string;
  restaurant: {
    id: string;
    name: string;
  };
};

type SearchLocationPreferenceResponse = {
  defaultSearchLocation: string | null;
  updatedAt: string;
};

type DiscoveryPlateItem = {
  dishId: string;
  dishName: string;
  restaurantId: string;
  restaurantName: string;
  currentDishRating: number;
  reviewCount: number;
  trendIncrease?: number;
  trendLabel?: string;
};

type DiscoveryResponse = {
  location: string;
  topRatedPlates: DiscoveryPlateItem[];
  topRestaurants: Array<{
    restaurantId: string;
    restaurantName: string;
    overallRating: number;
  }>;
  trendingPlates: {
    available: boolean;
    reason: 'OK' | 'NO_RESULTS_FOR_LOCATION' | 'INSUFFICIENT_7_DAY_TREND_DATA';
    items: DiscoveryPlateItem[];
  };
};

type Viewer = {
  id: string;
  name: string;
  email: string;
  defaultSearchLocation?: string | null;
};

const RADIUS_OPTIONS = [5, 10, 20, 50] as const;
const RESULTS_PAGE_SIZE = 10;

type RadiusMiles = (typeof RADIUS_OPTIONS)[number];

type SearchContext = {
  query: string;
  lat?: number;
  lng?: number;
  mode: 'typed' | 'location';
};

type FilterState = {
  cuisineFilters: string[];
  dishTypeFilters: string[];
};

type ActiveFilterChip = {
  kind: 'cuisine' | 'dishType';
  value: string;
};

function toggleValue(values: string[], value: string): string[] {
  if (values.includes(value)) {
    return values.filter((item) => item !== value);
  }

  return [...values, value];
}

export default function HomePage() {
  const viewer = getUser<Viewer>();
  const token = getToken();

  const [query, setQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState(viewer?.defaultSearchLocation ?? '');
  const [savedDefaultLocation, setSavedDefaultLocation] = useState(viewer?.defaultSearchLocation ?? '');
  const [results, setResults] = useState<Restaurant[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [wantToVisitIds, setWantToVisitIds] = useState<Set<string>>(new Set());
  const [radiusMiles, setRadiusMiles] = useState<RadiusMiles>(5);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [wantToVisitSyncWarning, setWantToVisitSyncWarning] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [saveLoadingByRestaurantId, setSaveLoadingByRestaurantId] = useState<Record<string, boolean>>({});
  const [hasSearched, setHasSearched] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    cuisineFilters: [],
    dishTypeFilters: [],
  });
  const lastSearchContextRef = useRef<SearchContext | null>(null);

  useEffect(() => {
    const loadWantToVisit = async () => {
      if (!token) {
        return;
      }

      try {
        const entries = await apiRequest<Array<{ restaurant: { id: string } }>>('/users/me/want-to-visit', {
          token,
        });

        setWantToVisitIds(new Set(entries.map((entry) => entry.restaurant.id)));
        setWantToVisitSyncWarning(null);
      } catch {
        setWantToVisitSyncWarning(
          'Could not load your saved Want to Visit flags. You can still search and try toggling again.',
        );
      }
    };

    void loadWantToVisit();
  }, [token]);

  useEffect(() => {
    const loadDefaultSearchLocation = async () => {
      if (!token) {
        setSavedDefaultLocation('');
        return;
      }

      try {
        const result = await apiRequest<SearchLocationPreferenceResponse>('/users/me/preferences/search-location', {
          token,
        });
        const nextLocation = result.defaultSearchLocation ?? '';
        setSavedDefaultLocation(nextLocation);
        setLocationQuery(nextLocation);
      } catch {
        setSavedDefaultLocation('');
      }
    };

    void loadDefaultSearchLocation();
  }, [token]);

  useEffect(() => {
    const loadDiscovery = async () => {
      if (!savedDefaultLocation.trim()) {
        setDiscovery(null);
        setDiscoveryError(null);
        return;
      }

      setDiscoveryLoading(true);
      setDiscoveryError(null);

      try {
        const params = new URLSearchParams({
          location: savedDefaultLocation,
          radiusMiles: String(radiusMiles),
        });
        const result = await apiRequest<DiscoveryResponse>(`/restaurants/discovery?${params.toString()}`);
        setDiscovery(result);
      } catch (err) {
        setDiscoveryError(err instanceof Error ? err.message : 'Failed to load personalized discovery data');
        setDiscovery(null);
      } finally {
        setDiscoveryLoading(false);
      }
    };

    void loadDiscovery();
  }, [savedDefaultLocation, radiusMiles]);

  const runSearch = async (context: SearchContext) => {
    const params = new URLSearchParams({
      query: context.query,
      radiusMiles: String(radiusMiles),
    });

    if (context.lat !== undefined && context.lng !== undefined) {
      params.set('lat', String(context.lat));
      params.set('lng', String(context.lng));
    }

    const data = await apiRequest<Restaurant[]>(`/restaurants/search?${params.toString()}`);
    setResults(data);
    setVisibleCount(RESULTS_PAGE_SIZE);
    setHasSearched(true);
    lastSearchContextRef.current = context;
  };

  useEffect(() => {
    const context = lastSearchContextRef.current;
    if (!context) {
      return;
    }

    let cancelled = false;

    const rerunSearchForRadius = async () => {
      setError(null);

      if (context.mode === 'location') {
        setLocationLoading(true);
      } else {
        setLoading(true);
      }

      try {
        await runSearch(context);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to refresh search for selected radius');
        }
      } finally {
        if (!cancelled) {
          if (context.mode === 'location') {
            setLocationLoading(false);
          } else {
            setLoading(false);
          }
        }
      }
    };

    void rerunSearchForRadius();

    return () => {
      cancelled = true;
    };
  }, [radiusMiles]);

  const toggleWantToVisit = async (restaurantId: string) => {
    if (!token) {
      setError('Please login to save restaurants to your Want to Visit list.');
      return;
    }

    const isSaved = wantToVisitIds.has(restaurantId);

    setSaveLoadingByRestaurantId((prev) => ({ ...prev, [restaurantId]: true }));
    setError(null);
    setWantToVisitSyncWarning(null);

    try {
      if (isSaved) {
        await apiRequest<{ success: true }>(`/users/me/want-to-visit/${restaurantId}`, {
          method: 'DELETE',
          token,
        });
        setWantToVisitIds((prev) => {
          const next = new Set(prev);
          next.delete(restaurantId);
          return next;
        });
      } else {
        await apiRequest<WantToVisitResponse>('/users/me/want-to-visit', {
          method: 'POST',
          token,
          body: { restaurantId },
        });
        setWantToVisitIds((prev) => new Set(prev).add(restaurantId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update want to visit list');
    } finally {
      setSaveLoadingByRestaurantId((prev) => ({ ...prev, [restaurantId]: false }));
    }
  };

  const onSearch = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedQuery = query.trim();
    const trimmedLocation = locationQuery.trim();
    if (!trimmedQuery && !trimmedLocation) {
      setError('Enter a search term, a location, or both.');
      return;
    }

    const composedQuery =
      trimmedQuery && trimmedLocation ? `${trimmedQuery} ${trimmedLocation}` : trimmedQuery || trimmedLocation;

    setLoading(true);
    setError(null);

    try {
      setFilters({
        cuisineFilters: [],
        dishTypeFilters: [],
      });
      await runSearch({
        query: composedQuery,
        mode: 'typed',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search restaurants');
    } finally {
      setLoading(false);
    }
  };

  const searchNearMe = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setLocationLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          setFilters({
            cuisineFilters: [],
            dishTypeFilters: [],
          });
          await runSearch({
            query: query.trim() || locationQuery.trim() || 'nearby restaurants',
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            mode: 'location',
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to search near your location');
        } finally {
          setLocationLoading(false);
        }
      },
      () => {
        setError('Unable to access your location.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const allCuisineFilters = Array.from(new Set(results.flatMap((restaurant) => restaurant.cuisines ?? []))).sort((a, b) =>
    a.localeCompare(b),
  );
  const allDishTypeFilters = Array.from(new Set(results.flatMap((restaurant) => restaurant.dishTypes ?? []))).sort((a, b) =>
    a.localeCompare(b),
  );
  const hasActiveFilters = filters.cuisineFilters.length > 0 || filters.dishTypeFilters.length > 0;
  const activeFilterChips: ActiveFilterChip[] = [
    ...filters.cuisineFilters.map((value) => ({ kind: 'cuisine' as const, value })),
    ...filters.dishTypeFilters.map((value) => ({ kind: 'dishType' as const, value })),
  ];

  const filteredResults = results.filter((restaurant) => {
    const cuisinePass =
      filters.cuisineFilters.length === 0 ||
      filters.cuisineFilters.some((filterValue) => (restaurant.cuisines ?? []).includes(filterValue));
    const dishTypePass =
      filters.dishTypeFilters.length === 0 ||
      filters.dishTypeFilters.some((filterValue) => (restaurant.dishTypes ?? []).includes(filterValue));

    return cuisinePass && dishTypePass;
  });

  const filteredVisibleResults = filteredResults.slice(0, visibleCount);
  const canLoadMoreFiltered = visibleCount < filteredResults.length;

  return (
    <>
      <NavBar />

      <section className="app-card">
        <h1 className="app-title">Find restaurants and rate plates</h1>
        <p className="app-muted mt-2">
          Search by restaurant name, cuisine, plate type, ZIP code, city, or address.
        </p>
        <p className="app-muted mt-1 text-xs">
          {savedDefaultLocation
            ? `Your saved default location is ${savedDefaultLocation}. One-time edits below won't overwrite it.`
            : 'Tip: Save a default location in your profile to personalize discovery boxes.'}
        </p>

        <form className="mt-4 grid gap-3" onSubmit={onSearch}>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="app-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What are you looking for? (restaurant, cuisine, plate type)"
            />
            <input
              className="app-input"
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="Location (city, ZIP code, or full address)"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
            <label htmlFor="radiusMiles" className="text-sm whitespace-nowrap text-slate-300">
              Radius
            </label>
            <select
              id="radiusMiles"
              className="app-select w-full min-w-[100px]"
              value={radiusMiles}
              onChange={(event) => {
                const nextRadius = Number(event.target.value);
                if (RADIUS_OPTIONS.includes(nextRadius as RadiusMiles)) {
                  setRadiusMiles(nextRadius as RadiusMiles);
                }
              }}
            >
              {RADIUS_OPTIONS.map((radiusOption) => (
                <option key={radiusOption} value={radiusOption}>
                  {radiusOption} miles
                </option>
              ))}
            </select>

            <div className="grid gap-2 sm:grid-cols-2">
              <button className="app-btn-primary w-full" disabled={loading}>
                {loading ? 'Searching...' : 'Search'}
              </button>
              <button
                type="button"
                className="app-btn-secondary w-full"
                onClick={searchNearMe}
                disabled={locationLoading}
              >
                {locationLoading ? 'Locating...' : 'Use my location'}
              </button>
            </div>
          </div>
        </form>

        {error && <p className="app-error mt-3">{error}</p>}
        {wantToVisitSyncWarning && <p className="app-error mt-3">{wantToVisitSyncWarning}</p>}
      </section>

      <section className="app-card mt-6">
        <h2 className="app-section-title">Discovery</h2>
        {!token && (
          <p className="app-muted mt-2 text-sm">
            Login and save a default search location in your profile to get personalized discovery lists.
          </p>
        )}

        {token && !savedDefaultLocation && (
          <div className="mt-2 text-sm">
            <p className="app-muted">No default location saved yet.</p>
            <Link href="/profile" className="mt-2 inline-block text-teal-300 underline hover:text-teal-200">
              Add a default location in Profile
            </Link>
          </div>
        )}

        {token && savedDefaultLocation && (
          <>
            <p className="app-muted mt-2 text-sm">
              Showing discoveries for your saved default location: <span className="text-slate-100">{savedDefaultLocation}</span>
            </p>
            {discoveryLoading && <p className="app-muted mt-3 text-sm">Loading discovery boxes...</p>}
            {discoveryError && <p className="app-error mt-3">{discoveryError}</p>}

            {!discoveryLoading && !discoveryError && discovery && (
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <article className="app-card-soft">
                  <h3 className="text-sm font-semibold text-slate-100">Top 10 Rated Plates</h3>
                  <ul className="mt-3 space-y-2">
                    {discovery.topRatedPlates.length ? (
                      discovery.topRatedPlates.map((plate) => (
                        <li key={`top-${plate.dishId}-${plate.restaurantId}`}>
                          {plate.restaurantId ? (
                            <Link
                              href={`/restaurants/${plate.restaurantId}`}
                              className="block rounded-lg border border-slate-800 bg-slate-900/50 p-2 transition hover:border-teal-400/50 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-400/60"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-100 break-words">{plate.dishName}</p>
                                  <p className="mt-0.5 text-xs text-slate-400 break-words">{plate.restaurantName}</p>
                                </div>
                                <span className="shrink-0 rounded-md border border-teal-400/30 bg-teal-400/10 px-2 py-1 text-xs font-semibold text-teal-200">
                                  {plate.currentDishRating.toFixed(2)}
                                </span>
                              </div>
                            </Link>
                          ) : (
                            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                              <p className="text-sm font-medium text-slate-100 break-words">{plate.dishName}</p>
                              <p className="mt-0.5 text-xs text-slate-400 break-words">Link unavailable</p>
                            </div>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="app-muted text-sm">No plate ratings yet for this location.</li>
                    )}
                  </ul>
                </article>

                <article className="app-card-soft">
                  <h3 className="text-sm font-semibold text-slate-100">Trending Plates</h3>
                  {discovery.trendingPlates.available ? (
                    <ul className="mt-3 space-y-2">
                      {discovery.trendingPlates.items.map((plate) => (
                        <li key={`trend-${plate.dishId}-${plate.restaurantId}`}>
                          {plate.restaurantId ? (
                            <Link
                              href={`/restaurants/${plate.restaurantId}`}
                              className="block rounded-lg border border-slate-800 bg-slate-900/50 p-2 transition hover:border-teal-400/50 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-400/60"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-100 break-words">{plate.dishName}</p>
                                  <p className="mt-0.5 text-xs text-slate-400 break-words">{plate.restaurantName}</p>
                                  {plate.trendLabel && (
                                    <p className="mt-1 text-[11px] text-emerald-300 break-words">{plate.trendLabel}</p>
                                  )}
                                </div>
                                <span className="shrink-0 rounded-md border border-teal-400/30 bg-teal-400/10 px-2 py-1 text-xs font-semibold text-teal-200">
                                  {plate.currentDishRating.toFixed(2)}
                                </span>
                              </div>
                            </Link>
                          ) : (
                            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                              <p className="text-sm font-medium text-slate-100 break-words">{plate.dishName}</p>
                              <p className="mt-0.5 text-xs text-slate-400 break-words">Link unavailable</p>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-300">
                      {discovery.trendingPlates.reason === 'NO_RESULTS_FOR_LOCATION'
                        ? 'No nearby results were found for your saved location.'
                        : 'Not enough 7-day trend data yet. Trending plates will appear once enough recent and prior-week ratings are available.'}
                    </div>
                  )}
                </article>

                <article className="app-card-soft">
                  <h3 className="text-sm font-semibold text-slate-100">Top 10 Restaurants</h3>
                  <ul className="mt-3 space-y-2">
                    {discovery.topRestaurants.length ? (
                      discovery.topRestaurants.map((restaurant) => (
                        <li key={`rest-${restaurant.restaurantId}`}>
                          {restaurant.restaurantId ? (
                            <Link
                              href={`/restaurants/${restaurant.restaurantId}`}
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2 transition hover:border-teal-400/50 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-400/60"
                            >
                              <p className="text-sm font-medium text-slate-100 break-words">{restaurant.restaurantName}</p>
                              <span className="shrink-0 rounded-md border border-indigo-400/30 bg-indigo-400/10 px-2 py-1 text-xs font-semibold text-indigo-200">
                                {restaurant.overallRating.toFixed(2)}
                              </span>
                            </Link>
                          ) : (
                            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                              <p className="text-sm font-medium text-slate-100 break-words">{restaurant.restaurantName}</p>
                              <p className="mt-0.5 text-xs text-slate-400 break-words">Link unavailable</p>
                            </div>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="app-muted text-sm">No restaurant ratings yet for this location.</li>
                    )}
                  </ul>
                </article>
              </div>
            )}
          </>
        )}
      </section>

      {(allCuisineFilters.length > 0 || allDishTypeFilters.length > 0) && (
        <section className="app-card mt-6">
          <div className="flex flex-col gap-3">
            {allCuisineFilters.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Filter by cuisine</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allCuisineFilters.map((cuisine) => {
                    const isActive = filters.cuisineFilters.includes(cuisine);
                    return (
                      <button
                        key={cuisine}
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs border ${
                          isActive
                            ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-100'
                            : 'border-slate-600 bg-slate-800 text-slate-200'
                        }`}
                        onClick={() => {
                          setVisibleCount(RESULTS_PAGE_SIZE);
                          setFilters((prev) => ({
                            ...prev,
                            cuisineFilters: toggleValue(prev.cuisineFilters, cuisine),
                          }));
                        }}
                      >
                        {cuisine}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {allDishTypeFilters.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Filter by plate type</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allDishTypeFilters.map((dishType) => {
                    const isActive = filters.dishTypeFilters.includes(dishType);
                    return (
                      <button
                        key={dishType}
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs border ${
                          isActive
                            ? 'border-indigo-300/60 bg-indigo-400/20 text-indigo-100'
                            : 'border-slate-600 bg-slate-800 text-slate-200'
                        }`}
                        onClick={() => {
                          setVisibleCount(RESULTS_PAGE_SIZE);
                          setFilters((prev) => ({
                            ...prev,
                            dishTypeFilters: toggleValue(prev.dishTypeFilters, dishType),
                          }));
                        }}
                      >
                        {dishType}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">Active filters:</span>
                {activeFilterChips.map((chip, index) => (
                  <button
                    key={`${chip.kind}-${chip.value}-${index}`}
                    type="button"
                    className="rounded-full border border-slate-500 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                    onClick={() => {
                      setVisibleCount(RESULTS_PAGE_SIZE);
                      if (chip.kind === 'cuisine') {
                        setFilters((prev) => ({
                          ...prev,
                          cuisineFilters: prev.cuisineFilters.filter((item) => item !== chip.value),
                        }));
                        return;
                      }

                      setFilters((prev) => ({
                        ...prev,
                        dishTypeFilters: prev.dishTypeFilters.filter((item) => item !== chip.value),
                      }));
                    }}
                  >
                    {chip.kind === 'cuisine' ? `Cuisine: ${chip.value}` : `Plate: ${chip.value}`} ✕
                  </button>
                ))}
                <button
                  type="button"
                  className="app-btn-secondary"
                  onClick={() => {
                    setVisibleCount(RESULTS_PAGE_SIZE);
                    setFilters({
                      cuisineFilters: [],
                      dishTypeFilters: [],
                    });
                  }}
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {filteredVisibleResults.map((restaurant) => (
          <article key={restaurant.id} className="app-card-soft">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <h2 className="text-lg font-semibold break-words">{restaurant.name}</h2>
              {restaurant.highRepeatCustomersBadge && (
                <span className="self-start rounded-full border border-amber-300/30 bg-amber-300/15 px-2 py-1 text-xs font-medium text-amber-100 sm:shrink-0">
                  High Repeat Customers
                </span>
              )}
            </div>
            <p className="app-muted mt-1 break-words text-sm">{restaurant.address}</p>
            <p className="mt-1 text-xs text-slate-300">
              Cuisine: {restaurant.cuisines?.length ? restaurant.cuisines.join(', ') : 'Not available'}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Plate types: {restaurant.dishTypes?.length ? restaurant.dishTypes.join(', ') : 'Not available'}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Overall: {restaurant.overallRating ?? 'No ratings yet'} · Food: {restaurant.foodRating ?? 'No ratings yet'}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Link className="app-btn-secondary w-full sm:w-auto" href={`/restaurants/${restaurant.id}`}>
                View Restaurant
              </Link>
              {(() => {
                const isSaved = wantToVisitIds.has(restaurant.id);

                return (
                  <button
                    className={`w-full sm:w-auto ${isSaved ? 'app-btn-secondary' : 'app-btn-primary'}`}
                    onClick={() => void toggleWantToVisit(restaurant.id)}
                    disabled={Boolean(saveLoadingByRestaurantId[restaurant.id])}
                    aria-pressed={isSaved}
                  >
                    {saveLoadingByRestaurantId[restaurant.id]
                      ? 'Saving...'
                      : isSaved
                        ? '★ Want to Visit'
                        : '☆ Want to Visit'}
                  </button>
                );
              })()}
            </div>
          </article>
        ))}
      </section>

      {hasSearched && results.length === 0 && !loading && !locationLoading && !error && (
        <section className="app-card mt-6">
          <p className="app-muted">No results found. Try another restaurant name, cuisine, or plate type.</p>
        </section>
      )}

      {results.length > 0 && filteredResults.length === 0 && (
        <section className="app-card mt-6">
          <p className="app-muted">No matching restaurants for the selected filters.</p>
          <button
            type="button"
            className="app-btn-secondary mt-3"
            onClick={() => {
              setVisibleCount(RESULTS_PAGE_SIZE);
              setFilters({ cuisineFilters: [], dishTypeFilters: [] });
            }}
          >
            Clear filters
          </button>
        </section>
      )}

      {canLoadMoreFiltered && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            className="app-btn-secondary w-full sm:w-auto"
            onClick={() => setVisibleCount((prev) => Math.min(prev + RESULTS_PAGE_SIZE, filteredResults.length))}
          >
            Load more restaurants
          </button>
        </div>
      )}
    </>
  );
}
