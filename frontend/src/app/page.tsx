'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Restaurant[]>([]);
  const [wantToVisitIds, setWantToVisitIds] = useState<Set<string>>(new Set());
  const [radiusMiles, setRadiusMiles] = useState<RadiusMiles>(5);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wantToVisitSyncWarning, setWantToVisitSyncWarning] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [saveLoadingByRestaurantId, setSaveLoadingByRestaurantId] = useState<Record<string, boolean>>({});
  const [hasSearched, setHasSearched] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    cuisineFilters: [],
    dishTypeFilters: [],
  });
  const lastSearchContextRef = useRef<SearchContext | null>(null);

  const token = getToken();

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
    setLoading(true);
    setError(null);

    try {
      setFilters({
        cuisineFilters: [],
        dishTypeFilters: [],
      });
      await runSearch({
        query,
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
            query: query.trim() || 'nearby restaurants',
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

        <form className="mt-4 grid gap-3 sm:flex sm:items-center" onSubmit={onSearch}>
          <input
            className="app-input sm:flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try: Joe's Pizza, Italian, burgers, 10001, or New York"
            required
          />
          <div className="flex items-center gap-2">
            <label htmlFor="radiusMiles" className="text-sm whitespace-nowrap text-slate-300">
              Radius
            </label>
            <select
              id="radiusMiles"
              className="app-select w-full min-w-[100px] sm:w-auto"
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
          <button className="app-btn-primary w-full sm:w-auto" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button
            type="button"
            className="app-btn-secondary w-full sm:w-auto"
            onClick={searchNearMe}
            disabled={locationLoading}
          >
            {locationLoading ? 'Locating...' : 'Use my location'}
          </button>
        </form>

        {error && <p className="app-error mt-3">{error}</p>}
        {wantToVisitSyncWarning && <p className="app-error mt-3">{wantToVisitSyncWarning}</p>}
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
