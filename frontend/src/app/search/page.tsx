'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { Restaurant } from '@/lib/types';
import { getToken } from '@/lib/auth';

type WantToVisitResponse = {
  id: string;
  createdAt: string;
  restaurant: {
    id: string;
    name: string;
  };
};

const RADIUS_OPTIONS = [5, 10, 20, 50] as const;
const RESULTS_PAGE_SIZE = 10;

type RadiusMiles = (typeof RADIUS_OPTIONS)[number];

type SearchContext = {
  query: string;
  location?: string;
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

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = getToken();

  const [results, setResults] = useState<Restaurant[]>([]);
  const [wantToVisitIds, setWantToVisitIds] = useState<Set<string>>(new Set());
  const [radiusMiles, setRadiusMiles] = useState<RadiusMiles>(5);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wantToVisitSyncWarning, setWantToVisitSyncWarning] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [saveLoadingByRestaurantId, setSaveLoadingByRestaurantId] = useState<Record<string, boolean>>({});
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
    const query = searchParams.get('query');
    const location = searchParams.get('location');
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const radius = searchParams.get('radiusMiles');

    if (radius) {
      const parsedRadius = Number(radius);
      if (RADIUS_OPTIONS.includes(parsedRadius as RadiusMiles)) {
        setRadiusMiles(parsedRadius as RadiusMiles);
      }
    }

    if (!query && !location && !lat && !lng) {
      return;
    }

    const context: SearchContext = {
      query: query || 'restaurants',
      mode: lat && lng ? 'location' : 'typed',
    };

    if (location) {
      context.location = location;
    }

    if (lat && lng) {
      context.lat = Number(lat);
      context.lng = Number(lng);
    }

    void runSearch(context);
  }, [searchParams]);

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

  const runSearch = async (context: SearchContext) => {
    const params = new URLSearchParams({
      query: context.query,
      radiusMiles: String(radiusMiles),
    });

    if (context.location?.trim()) {
      params.set('location', context.location.trim());
    }

    if (context.lat !== undefined && context.lng !== undefined) {
      params.set('lat', String(context.lat));
      params.set('lng', String(context.lng));
    }

    if (context.mode === 'location') {
      setLocationLoading(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const data = await apiRequest<Restaurant[]>(`/restaurants/search?${params.toString()}`);
      setResults(data);
      setVisibleCount(RESULTS_PAGE_SIZE);
      setFilters({
        cuisineFilters: [],
        dishTypeFilters: [],
      });
      lastSearchContextRef.current = context;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search restaurants');
    } finally {
      if (context.mode === 'location') {
        setLocationLoading(false);
      } else {
        setLoading(false);
      }
    }
  };

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

  const searchNearMe = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setLocationLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const query = searchParams.get('query') || 'nearby restaurants';
        router.push(
          `/search?query=${encodeURIComponent(query)}&lat=${position.coords.latitude}&lng=${position.coords.longitude}&radiusMiles=${radiusMiles}`,
        );
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

  const cuisineOrTypeLabelByRestaurantId = new Map(
    filteredResults.map((restaurant) => {
      const cuisines = restaurant.cuisines ?? [];
      const restaurantTypes = restaurant.restaurantTypes ?? [];

      if (cuisines.length) {
        return [restaurant.id, `Cuisine: ${cuisines.join(', ')}`] as const;
      }

      if (restaurantTypes.length) {
        return [restaurant.id, `Restaurant type: ${restaurantTypes.join(', ')}`] as const;
      }

      return [restaurant.id, 'Cuisine: Not available'] as const;
    }),
  );

  const showPlateTypesOnSearchCards = filteredResults.length < results.length;
  const filteredVisibleResults = filteredResults.slice(0, visibleCount);
  const canLoadMoreFiltered = visibleCount < filteredResults.length;

  return (
    <>
      <NavBar />

      <section className="app-card">
        <h1 className="app-title">Search Results</h1>
        
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <label htmlFor="radiusMiles" className="text-sm whitespace-nowrap text-slate-300">
              Search Radius
            </label>
            <select
              id="radiusMiles"
              className="app-select w-[110px]"
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
          </div>

          <button
            type="button"
            className="app-btn-secondary w-full sm:w-auto"
            onClick={searchNearMe}
            disabled={locationLoading}
          >
            {locationLoading ? 'Locating...' : 'Search Near Me'}
          </button>
        </div>

        {error && <p className="app-error mt-3">{error}</p>}
        {wantToVisitSyncWarning && <p className="app-error mt-3">{wantToVisitSyncWarning}</p>}
        
        {loading && <p className="app-muted mt-3">Searching...</p>}
      </section>

      {(allCuisineFilters.length > 0 || allDishTypeFilters.length > 0) && (
        <section className="app-card mt-6">
          <div className="flex flex-col gap-3">
            {allCuisineFilters.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Filter by cuisine (multi-select)</h3>
                <p className="mt-1 text-xs text-slate-400">Select one or more cuisines.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allCuisineFilters.map((cuisine) => {
                    const isActive = filters.cuisineFilters.includes(cuisine);
                    return (
                      <label
                        key={cuisine}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                          isActive
                            ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-100'
                            : 'border-slate-600 bg-slate-800 text-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-cyan-400"
                          checked={isActive}
                          onChange={() => {
                            setVisibleCount(RESULTS_PAGE_SIZE);
                            setFilters((prev) => ({
                              ...prev,
                              cuisineFilters: toggleValue(prev.cuisineFilters, cuisine),
                            }));
                          }}
                          aria-label={`Filter by cuisine ${cuisine}`}
                        />
                        <span>{cuisine}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {allDishTypeFilters.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Filter by plate type (multi-select)</h3>
                <p className="mt-1 text-xs text-slate-400">Select one or more plate types.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allDishTypeFilters.map((dishType) => {
                    const isActive = filters.dishTypeFilters.includes(dishType);
                    return (
                      <label
                        key={dishType}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                          isActive
                            ? 'border-indigo-300/60 bg-indigo-400/20 text-indigo-100'
                            : 'border-slate-600 bg-slate-800 text-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-indigo-400"
                          checked={isActive}
                          onChange={() => {
                            setVisibleCount(RESULTS_PAGE_SIZE);
                            setFilters((prev) => ({
                              ...prev,
                              dishTypeFilters: toggleValue(prev.dishTypeFilters, dishType),
                            }));
                          }}
                          aria-label={`Filter by plate type ${dishType}`}
                        />
                        <span>{dishType}</span>
                      </label>
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
              {cuisineOrTypeLabelByRestaurantId.get(restaurant.id) ?? 'Cuisine: Not available'}
            </p>
            {showPlateTypesOnSearchCards && (
              <p className="mt-1 text-xs text-slate-300">
                Plate types: {restaurant.dishTypes?.length ? restaurant.dishTypes.join(', ') : 'Not available'}
              </p>
            )}
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

      {results.length === 0 && !loading && !locationLoading && !error && (
        <section className="app-card mt-6">
          <p className="app-muted">No results found. Try a different search term or location.</p>
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
