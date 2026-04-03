'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { getToken, getUser, updateStoredUser } from '@/lib/auth';
import { WantToVisitEntry } from '@/lib/types';

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
  recipeMatchEnabled: boolean;
};

function DashboardPageContent() {
  const params = useSearchParams();
  const viewer = getUser<UserResponse>();
  const userId = params.get('userId') ?? viewer?.id;
  const token = getToken();

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [recipeEnabled, setRecipeEnabled] = useState<boolean>(viewer?.recipeMatchEnabled ?? true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const toggleRecipePreference = async () => {
    if (!token || !userId) {
      return;
    }

    setSaving(true);
    try {
      const updated = await apiRequest<UserResponse>(`/users/${userId}/preferences/recipe-match`, {
        method: 'PATCH',
        token,
        body: {
          recipeMatchEnabled: !recipeEnabled,
        },
      });
      setRecipeEnabled(updated.recipeMatchEnabled);
      updateStoredUser({ recipeMatchEnabled: updated.recipeMatchEnabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update preference');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <NavBar />
      <section className="app-card">
        <h1 className="app-title">Your dashboard</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="app-muted text-sm">Recipe Match</span>
          <button className="app-btn-secondary w-full px-3 py-1.5 sm:w-auto" onClick={toggleRecipePreference} disabled={saving}>
            {recipeEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      {loading && <p className="app-muted mt-4">Loading dashboard...</p>}
      {error && <p className="app-error mt-4">{error}</p>}

      {data && (
        <>
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
              <h2 className="app-section-title">Top dishes</h2>
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
