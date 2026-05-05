'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { getToken, getUser, updateStoredUser } from '@/lib/auth';
import { WantToVisitEntry } from '@/lib/types';

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

type SearchLocationPreferenceResponse = {
  defaultSearchLocation: string | null;
  updatedAt: string;
};

type DashboardResponse = {
  highestRatedDishes: Array<{
    reviewId: string;
    dishName: string;
    restaurantName: string;
    dishScore: number;
    reviewedAt: string;
  }>;
  highestRatedRestaurants: Array<{
    restaurantId: string;
    restaurantName: string;
    averageScore: number;
    reviewCount: number;
  }>;
  recentReviews: Array<{
    id: string;
    dishScore: number;
    dish: { name: string };
    restaurant: { name: string };
    createdAt: string;
  }>;
  wantToVisit: WantToVisitEntry[];
};

type UserResponse = {
  id: string;
  name: string;
  email: string;
  defaultSearchLocation?: string | null;
};

function resolvePublicDashboardUrl(userId: string): string {
  const path = `/dashboard/shared/${userId}`;

  if (typeof window === 'undefined') {
    return path;
  }

  return `${window.location.origin}${path}`;
}

function DashboardPageContent() {
  const params = useSearchParams();
  const viewer = getUser<UserResponse>();
  const userId = params.get('userId') ?? viewer?.id;
  const token = getToken();

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [savedDefaultLocation, setSavedDefaultLocation] = useState(viewer?.defaultSearchLocation ?? '');
  const [loading, setLoading] = useState(true);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!userId || !token) {
        setError('Please login to view dashboard.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await apiRequest<DashboardResponse>(`/users/${userId}/dashboard`, { token });
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [token, userId]);

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
          radiusMiles: '10',
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
  }, [savedDefaultLocation]);

  const shareDashboard = async () => {
    if (!userId) {
      return;
    }

    const shareUrl = resolvePublicDashboardUrl(userId);

    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: `${viewer?.name ?? 'PlateRank'} dashboard`,
          text: 'Check out this PlateRank dashboard',
          url: shareUrl,
        });
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareMessage('Share link copied to clipboard.');
        return;
      }

      setShareMessage(`Share this link: ${shareUrl}`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      setShareMessage(err instanceof Error ? err.message : 'Unable to share dashboard right now.');
    }
  };

  const publicDashboardPath = userId ? `/dashboard/shared/${userId}` : '';

  return (
    <>
      <NavBar />
      <section className="app-card">
        <h1 className="app-title">Your dashboard</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="app-btn-secondary w-full px-3 py-1.5 sm:w-auto"
            onClick={shareDashboard}
            disabled={!userId}
          >
            Share dashboard
          </button>
          {publicDashboardPath && (
            <Link href={publicDashboardPath} className="text-sm text-teal-300 underline hover:text-teal-200">
              Open public view
            </Link>
          )}
        </div>
        {shareMessage && <p className="app-muted mt-2 text-xs">{shareMessage}</p>}
      </section>

      {loading && <p className="app-muted mt-4">Loading dashboard...</p>}
      {error && <p className="app-error mt-4">{error}</p>}

      {data && (
        <>
          <section className="app-card mt-6">
            <h2 className="app-section-title">Discovery</h2>
            {!savedDefaultLocation && (
              <div className="mt-2 text-sm">
                <p className="app-muted">No default location saved yet.</p>
                <Link href="/profile" className="mt-2 inline-block text-teal-300 underline hover:text-teal-200">
                  Add a default location in Profile
                </Link>
              </div>
            )}

            {savedDefaultLocation && (
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

          <section className="app-card mt-6">
            <h2 className="app-section-title">Want to Visit</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {data.wantToVisit.length ? (
                data.wantToVisit.map((entry) => (
                  <li key={entry.id} className="app-list-item text-slate-300">
                    <p className="font-medium text-slate-100">{entry.restaurant.name}</p>
                    <p className="app-muted">{entry.restaurant.address}</p>
                    <p>
                      Overall: {entry.restaurant.overallRating ?? 'No ratings yet'} · Food:{' '}
                      {entry.restaurant.foodRating ?? 'No ratings yet'}
                    </p>
                  </li>
                ))
              ) : (
                <li className="app-muted">No saved restaurants yet.</li>
              )}
            </ul>
          </section>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <section className="app-card-soft md:col-span-1">
              <h2 className="app-section-title">Top plates</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {data.highestRatedDishes.map((item) => (
                  <li key={item.reviewId} className="text-slate-300">
                    <span className="break-words">{item.dishName} ({item.restaurantName}) · {item.dishScore}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="app-card-soft md:col-span-1">
              <h2 className="app-section-title">Top restaurants</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {data.highestRatedRestaurants.map((item) => (
                  <li key={item.restaurantId} className="text-slate-300">
                    <span className="break-words">{item.restaurantName} · {item.averageScore.toFixed(2)} ({item.reviewCount} reviews)</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="app-card-soft md:col-span-1">
              <h2 className="app-section-title">Recent reviews</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {data.recentReviews.map((review) => (
                  <li key={review.id} className="text-slate-300">
                    <span className="break-words">{review.dish.name} @ {review.restaurant.name} · {review.dishScore}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function DashboardLoadingFallback() {
  return (
    <>
      <NavBar />
      <section className="app-card">
        <h1 className="app-title">Your dashboard</h1>
        <p className="app-muted mt-3">Loading dashboard...</p>
      </section>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoadingFallback />}>
      <DashboardPageContent />
    </Suspense>
  );
}
