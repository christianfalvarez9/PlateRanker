'use client';

import { FormEvent, useEffect, useState } from 'react';
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

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Restaurant[]>([]);
  const [wantToVisitIds, setWantToVisitIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [saveLoadingByRestaurantId, setSaveLoadingByRestaurantId] = useState<Record<string, boolean>>({});

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
      } catch {
        // non-blocking for search page
      }
    };

    void loadWantToVisit();
  }, [token]);

  const runSearch = async (searchQuery: string, lat?: number, lng?: number) => {
    const params = new URLSearchParams({ query: searchQuery });
    if (lat !== undefined && lng !== undefined) {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
    }

    const data = await apiRequest<Restaurant[]>(`/restaurants/search?${params.toString()}`);
    setResults(data);
  };

  const toggleWantToVisit = async (restaurantId: string) => {
    if (!token) {
      setError('Please login to save restaurants to your Want to Visit list.');
      return;
    }

    const isSaved = wantToVisitIds.has(restaurantId);

    setSaveLoadingByRestaurantId((prev) => ({ ...prev, [restaurantId]: true }));
    setError(null);

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
      await runSearch(query);
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
          await runSearch(query || 'nearby restaurants', position.coords.latitude, position.coords.longitude);
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
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {results.map((restaurant) => (
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
              <button
                className="app-btn-primary w-full sm:w-auto"
                onClick={() => void toggleWantToVisit(restaurant.id)}
                disabled={Boolean(saveLoadingByRestaurantId[restaurant.id])}
              >
                {saveLoadingByRestaurantId[restaurant.id]
                  ? 'Saving...'
                  : wantToVisitIds.has(restaurant.id)
                    ? 'Saved to Want to Visit'
                    : 'Want to Visit'}
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
