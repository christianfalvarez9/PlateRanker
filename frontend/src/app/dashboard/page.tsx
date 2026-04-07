'use client';

import Link from 'next/link';
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
  savedRecipes: Array<{
    id: string;
    title: string;
    link: string;
    createdAt: string;
    dish: {
      id: string;
      name: string;
    };
    restaurant: {
      id: string;
      name: string;
    };
  }>;
};

type UserResponse = {
  id: string;
  name: string;
  email: string;
  recipeMatchEnabled: boolean;
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
  const [recipeEnabled, setRecipeEnabled] = useState<boolean>(viewer?.recipeMatchEnabled ?? true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
          <span className="app-muted text-sm">Recipe Match</span>
          <button className="app-btn-secondary w-full px-3 py-1.5 sm:w-auto" onClick={toggleRecipePreference} disabled={saving}>
            {recipeEnabled ? 'On' : 'Off'}
          </button>
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
            <h2 className="app-section-title">Saved Recipe Links</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {data.savedRecipes.length ? (
                data.savedRecipes.map((recipe) => (
                  <li key={recipe.id} className="app-list-item text-slate-300">
                    <p className="font-medium text-slate-100 break-words">{recipe.title}</p>
                    <p className="app-muted text-xs break-words">
                      From {recipe.dish.name} @ {recipe.restaurant.name}
                    </p>
                    <a
                      href={recipe.link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block break-all text-teal-300 underline hover:text-teal-200"
                    >
                      Open recipe link
                    </a>
                  </li>
                ))
              ) : (
                <li className="app-muted">No saved recipe links yet. Submit a high-rated plate review to get matches.</li>
              )}
            </ul>
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
