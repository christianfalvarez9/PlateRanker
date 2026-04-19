'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { getToken, getUser, updateStoredUser } from '@/lib/auth';

type ReviewHistoryItem = {
  id: string;
  dishScore: number;
  tasteScore: number;
  portionSizeScore: number;
  valueScore: number;
  presentationScore: number;
  uniquenessScore: number;
  reviewText?: string | null;
  createdAt: string;
  mealReview?: {
    id: string;
    serviceScore: number;
    atmosphereScore: number;
    valueScore: number;
    reviewText?: string | null;
    createdAt: string;
  } | null;
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
  defaultSearchLocation?: string | null;
};

type SearchLocationPreferenceResponse = {
  defaultSearchLocation: string | null;
  updatedAt: string;
};

type SearchLocationPreferenceUpdateResponse = {
  id: string;
  name: string;
  email: string;
  defaultSearchLocation: string | null;
  recipeMatchEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function ProfilePage() {
  const viewer = getUser<Viewer>();
  const token = getToken();
  const viewerId = viewer?.id;
  const [reviews, setReviews] = useState<ReviewHistoryItem[]>([]);
  const [expandedReviewIds, setExpandedReviewIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultSearchLocationInput, setDefaultSearchLocationInput] = useState(viewer?.defaultSearchLocation ?? '');
  const [savedDefaultSearchLocation, setSavedDefaultSearchLocation] = useState(viewer?.defaultSearchLocation ?? '');
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

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

  useEffect(() => {
    const loadSearchLocation = async () => {
      if (!viewerId || !token) {
        setLocationLoading(false);
        return;
      }

      setLocationLoading(true);
      setLocationError(null);

      try {
        const result = await apiRequest<SearchLocationPreferenceResponse>('/users/me/preferences/search-location', {
          token,
        });
        const nextLocation = result.defaultSearchLocation ?? '';
        setSavedDefaultSearchLocation(nextLocation);
        setDefaultSearchLocationInput(nextLocation);
      } catch (err) {
        setLocationError(err instanceof Error ? err.message : 'Failed to load default search location');
      } finally {
        setLocationLoading(false);
      }
    };

    void loadSearchLocation();
  }, [token, viewerId]);

  const saveDefaultSearchLocation = async () => {
    if (!token) {
      setLocationError('Please login to update your default search location.');
      return;
    }

    const trimmedLocation = defaultSearchLocationInput.trim();
    if (trimmedLocation.length < 2) {
      setLocationError('Please enter at least 2 characters for your location.');
      return;
    }

    setLocationSaving(true);
    setLocationError(null);
    setLocationMessage(null);

    try {
      const result = await apiRequest<SearchLocationPreferenceUpdateResponse>('/users/me/preferences/search-location', {
        method: 'PATCH',
        token,
        body: {
          defaultSearchLocation: trimmedLocation,
        },
      });

      const nextLocation = result.defaultSearchLocation ?? '';
      setSavedDefaultSearchLocation(nextLocation);
      setDefaultSearchLocationInput(nextLocation);
      updateStoredUser({ defaultSearchLocation: nextLocation || null });
      setLocationMessage('Default search location saved.');
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Failed to save default search location');
    } finally {
      setLocationSaving(false);
    }
  };

  const removeDefaultSearchLocation = async () => {
    if (!token) {
      setLocationError('Please login to update your default search location.');
      return;
    }

    setLocationSaving(true);
    setLocationError(null);
    setLocationMessage(null);

    try {
      await apiRequest<SearchLocationPreferenceUpdateResponse>('/users/me/preferences/search-location', {
        method: 'DELETE',
        token,
      });

      setSavedDefaultSearchLocation('');
      setDefaultSearchLocationInput('');
      updateStoredUser({ defaultSearchLocation: null });
      setLocationMessage('Default search location removed.');
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Failed to remove default search location');
    } finally {
      setLocationSaving(false);
    }
  };

  const toggleReviewDetails = (reviewId: string) => {
    setExpandedReviewIds((previous) => ({
      ...previous,
      [reviewId]: !previous[reviewId],
    }));
  };

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
        <h2 className="app-section-title">Default search location</h2>
        <p className="app-muted mt-1 text-sm">
          This is used to auto-populate search and drive homepage discovery boxes.
        </p>

        {locationLoading ? (
          <p className="app-muted mt-3 text-sm">Loading your default location...</p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <input
                className="app-input"
                value={defaultSearchLocationInput}
                onChange={(event) => setDefaultSearchLocationInput(event.target.value)}
                placeholder="City, ZIP code, or full address"
                maxLength={120}
              />
              <button
                type="button"
                className="app-btn-primary w-full sm:w-auto"
                onClick={() => void saveDefaultSearchLocation()}
                disabled={locationSaving}
              >
                {locationSaving ? 'Saving...' : 'Save location'}
              </button>
              <button
                type="button"
                className="app-btn-secondary w-full sm:w-auto"
                onClick={() => void removeDefaultSearchLocation()}
                disabled={locationSaving || !savedDefaultSearchLocation}
              >
                Remove
              </button>
            </div>

            <p className="app-muted mt-2 text-xs">
              Current default: {savedDefaultSearchLocation || 'No default location saved'}
            </p>
            {locationMessage && <p className="app-muted mt-2 text-sm">{locationMessage}</p>}
            {locationError && <p className="app-error mt-2">{locationError}</p>}
          </>
        )}
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
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium break-words">
                        {review.dish.name} ({review.dish.category}) @{' '}
                        <Link
                          href={`/restaurants/${review.restaurant.id}`}
                          className="text-teal-300 underline hover:text-teal-200"
                        >
                          {review.restaurant.name}
                        </Link>
                      </p>
                      <p className="text-slate-300">Plate score: {review.dishScore.toFixed(2)}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/restaurants/${review.restaurant.id}`}
                        className="app-btn-secondary inline-flex items-center justify-center px-3 py-1.5 text-xs"
                      >
                        Go to restaurant
                      </Link>
                      <button
                        type="button"
                        className="app-btn-secondary px-3 py-1.5 text-xs"
                        onClick={() => toggleReviewDetails(review.id)}
                        aria-expanded={Boolean(expandedReviewIds[review.id])}
                        aria-controls={`review-details-${review.id}`}
                      >
                        {expandedReviewIds[review.id] ? 'Hide details' : 'Show details'}
                      </button>
                    </div>
                  </div>

                  {review.reviewText && <p className="app-muted mt-1 break-words">“{review.reviewText}”</p>}

                  {expandedReviewIds[review.id] && (
                    <div
                      id={`review-details-${review.id}`}
                      className="mt-3 rounded-xl border border-slate-700 bg-slate-900/50 p-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Detailed scoring</p>
                      <div className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
                        <p>Plate score: {review.dishScore.toFixed(2)}</p>
                        <p>Taste: {review.tasteScore}</p>
                        <p>Portion size: {review.portionSizeScore}</p>
                        <p>Value: {review.valueScore}</p>
                        <p>Presentation: {review.presentationScore}</p>
                        <p>Uniqueness: {review.uniquenessScore}</p>
                      </div>

                      {review.mealReview && (
                        <div className="mt-3 border-t border-slate-700 pt-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                            Meal experience scoring
                          </p>
                          <div className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                            <p>Service: {review.mealReview.serviceScore}</p>
                            <p>Atmosphere: {review.mealReview.atmosphereScore}</p>
                            <p>Cleanliness: {review.mealReview.valueScore}</p>
                          </div>
                          {review.mealReview.reviewText && (
                            <p className="app-muted mt-2 break-words text-xs">Meal note: “{review.mealReview.reviewText}”</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
