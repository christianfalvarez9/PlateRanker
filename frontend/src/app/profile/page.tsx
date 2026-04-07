'use client';

import { useEffect, useState } from 'react';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

type ReviewHistoryItem = {
  id: string;
  dishScore: number;
  reviewText?: string | null;
  createdAt: string;
  dish: {
    id: string;
    name: string;
    category: string;
  };
  restaurant: {
    id: string;
    name: string;
  };
};

type Viewer = {
  id: string;
  name: string;
  email: string;
};

export default function ProfilePage() {
  const viewer = getUser<Viewer>();
  const token = getToken();
  const viewerId = viewer?.id;
  const [reviews, setReviews] = useState<ReviewHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!viewerId || !token) {
        setError('Please login to view your profile.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await apiRequest<ReviewHistoryItem[]>(`/users/${viewerId}/reviews`, { token });
        setReviews(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load review history');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [token, viewerId]);

  return (
    <>
      <NavBar />
      <section className="app-card">
        <h1 className="app-title">Profile</h1>
        <p className="app-muted mt-1 text-sm">
          {viewer?.name ?? 'Guest'}{viewer?.email ? ` · ${viewer.email}` : ''}
        </p>
      </section>

      <section className="app-card mt-6">
        <h2 className="app-section-title">Review history</h2>
        {loading && <p className="app-muted mt-2 text-sm">Loading...</p>}
        {error && <p className="app-error mt-2">{error}</p>}

        {!loading && !error && (
          <ul className="mt-3 space-y-2 text-sm">
            {reviews.length ? (
              reviews.map((review) => (
                <li key={review.id} className="app-list-item">
                  <p className="font-medium">
                    {review.dish.name} ({review.dish.category}) @ {review.restaurant.name}
                  </p>
                  <p className="text-slate-300">Plate score: {review.dishScore}</p>
                  {review.reviewText && <p className="app-muted">“{review.reviewText}”</p>}
                </li>
              ))
            ) : (
              <li className="app-muted">No reviews yet.</li>
            )}
          </ul>
        )}
      </section>
    </>
  );
}
