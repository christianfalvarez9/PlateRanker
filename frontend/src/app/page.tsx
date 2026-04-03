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

  const visibleResults = results.slice(0, visibleCount);
  const canLoadMore = visibleCount < results.length;

  return (
    <>
      <NavBar />

      <section className="app-card">
        <h1 className="app-title">Find restaurants and rate dishes</h1>
        <p className="app-muted mt-2">
          Search by ZIP code, city, or address to discover restaurants and view weighted food ratings.
        </p>

        <form className="mt-4 grid gap-3 sm:flex sm:items-center" onSubmit={onSearch}>
          <input
            className="app-input sm:flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try: 10001, New York, or a neighborhood"
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

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {visibleResults.map((restaurant) => (
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

      {canLoadMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            className="app-btn-secondary w-full sm:w-auto"
            onClick={() => setVisibleCount((prev) => Math.min(prev + RESULTS_PAGE_SIZE, results.length))}
          >
            Load more restaurants
          </button>
        </div>
      )}
    </>
  );
}
