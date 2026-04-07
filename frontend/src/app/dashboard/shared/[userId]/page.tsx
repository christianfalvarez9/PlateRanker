'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';

type PublicDashboardResponse = {
  user: {
    id: string;
    name: string;
  };
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
};

export default function SharedDashboardPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  const [data, setData] = useState<PublicDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!userId) {
        setError('Missing user id.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await apiRequest<PublicDashboardResponse>(`/users/${userId}/dashboard/public`);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load shared dashboard');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [userId]);

  return (
    <>
      <NavBar />
      <section className="app-card">
        <h1 className="app-title">
          {data ? `${data.user.name}'s shared dashboard` : 'Shared dashboard'}
        </h1>
        <p className="app-muted mt-2 text-sm">
          View of top plates, top restaurants, and recent reviews.
        </p>
      </section>

      {loading && <p className="app-muted mt-4">Loading shared dashboard...</p>}
      {error && <p className="app-error mt-4">{error}</p>}

      {data && (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <section className="app-card-soft md:col-span-1">
            <h2 className="app-section-title">Top plates</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {data.highestRatedDishes.length ? (
                data.highestRatedDishes.map((item) => (
                  <li key={item.reviewId} className="text-slate-300">
                    <span className="break-words">
                      {item.dishName} ({item.restaurantName}) · {item.dishScore.toFixed(2)}
                    </span>
                  </li>
                ))
              ) : (
                <li className="app-muted">No plate reviews yet.</li>
              )}
            </ul>
          </section>

          <section className="app-card-soft md:col-span-1">
            <h2 className="app-section-title">Top restaurants</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {data.highestRatedRestaurants.length ? (
                data.highestRatedRestaurants.map((item) => (
                  <li key={item.restaurantId} className="text-slate-300">
                    <span className="break-words">
                      {item.restaurantName} · {item.averageScore.toFixed(2)} ({item.reviewCount} reviews)
                    </span>
                  </li>
                ))
              ) : (
                <li className="app-muted">No restaurant ratings yet.</li>
              )}
            </ul>
          </section>

          <section className="app-card-soft md:col-span-1">
            <h2 className="app-section-title">Recent reviews</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {data.recentReviews.length ? (
                data.recentReviews.map((review) => (
                  <li key={review.id} className="text-slate-300">
                    <span className="break-words">
                      {review.dish.name} @ {review.restaurant.name} · {review.dishScore.toFixed(2)}
                    </span>
                  </li>
                ))
              ) : (
                <li className="app-muted">No recent reviews yet.</li>
              )}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
