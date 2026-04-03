'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

type Dish = {
  id: string;
  name: string;
  category: 'APPETIZER' | 'ENTREE' | 'SIDE' | 'DESSERT';
  status: 'ACTIVE' | 'SEASONAL' | 'HISTORICAL';
  unavailableFlagCount: number;
  avgDishScore?: number | null;
  reviewCount?: number;
};

type DishCategory = Dish['category'];
type DishStatus = Dish['status'];

type DishReviewDraft = {
  taste: number;
  portion: number;
  cost: number;
  presentation: number;
  reviewText: string;
};

const DISH_COURSES: DishCategory[] = ['APPETIZER', 'ENTREE', 'SIDE', 'DESSERT'];

const DISH_COURSE_LABEL: Record<DishCategory, string> = {
  APPETIZER: 'Appetizer',
  ENTREE: 'Entree',
  SIDE: 'Side',
  DESSERT: 'Dessert',
};

type RecipeMatch = {
  title: string;
  image: string;
  link: string;
};

const createDefaultDishDraft = (): DishReviewDraft => ({
  taste: 8,
  portion: 8,
  cost: 8,
  presentation: 8,
  reviewText: '',
});

type RestaurantProfileResponse = {
  restaurant: {
    id: string;
    name: string;
    address: string;
    phone?: string | null;
    website?: string | null;
    reservationUrl?: string | null;
    overallRating?: number | null;
    foodRating?: number | null;
    serviceRating?: number | null;
    atmosphereRating?: number | null;
    valueRating?: number | null;
    highRepeatCustomersBadge: boolean;
  };
  topDishes: Array<{ dishId: string; name: string; avgScore: number; reviewCount: number }>;
  bottomDishes: Array<{ dishId: string; name: string; avgScore: number; reviewCount: number }>;
  menu: {
    activeAndSeasonal: Dish[];
    historical: Dish[];
  };
};

type RestaurantReviewsResponse = {
  items: Array<{
    id: string;
    dishScore: number;
    reviewText?: string | null;
    createdAt: string;
    mealReview?: {
      id: string;
      serviceScore: number;
      atmosphereScore: number;
      valueScore: number;
      reviewText?: string | null;
      imageUrl?: string | null;
      createdAt: string;
    } | null;
    user: { id: string; name: string };
    dish: { id: string; name: string };
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type MealReviewResult = {
  mealReview: {
    id: string;
    dishReviews: Array<{
      id: string;
      dishScore: number;
      dish: {
        id: string;
        name: string;
      };
    }>;
  };
  recipeMatches: RecipeMatch[];
};

type DishDetailsResponse = {
  dish: {
    id: string;
    name: string;
    category: DishCategory;
    status: DishStatus;
  };
  aggregates: {
    reviewCount: number;
    avgDishScore: number | null;
    avgTaste: number | null;
    avgPortion: number | null;
    avgCost: number | null;
    avgPresentation: number | null;
  };
  summary: string;
  photos: string[];
  recentReviews: Array<{
    id: string;
    dishScore: number;
    tasteScore: number;
    portionScore: number;
    costScore: number;
    presentationScore: number;
    reviewText?: string | null;
    imageUrl?: string | null;
    createdAt: string;
    user: {
      id: string;
      name: string;
    };
  }>;
};

type EmptyResponse = Record<string, never>;

type ActiveTab = 'overview' | 'menu' | 'reviews' | 'historical';

type MenuSyncResponse = {
  reason: 'FETCHED' | 'CACHE_FRESH' | 'COOLDOWN';
  provider: string;
  createdCount: number;
  skippedCount: number;
  cachedUntil?: string;
  nextAllowedAt?: string;
};

export default function RestaurantProfilePage() {
  const params = useParams<{ id: string }>();
  const restaurantId = params.id;
  const [tab, setTab] = useState<ActiveTab>('overview');
  const [data, setData] = useState<RestaurantProfileResponse | null>(null);
  const [reviews, setReviews] = useState<RestaurantReviewsResponse['items']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [recipeMatches, setRecipeMatches] = useState<RecipeMatch[]>([]);

  const [serviceScore, setServiceScore] = useState(8);
  const [atmosphereScore, setAtmosphereScore] = useState(8);
  const [valueScore, setValueScore] = useState(8);
  const [mealReviewText, setMealReviewText] = useState('');
  const [selectedDishIds, setSelectedDishIds] = useState<string[]>([]);
  const [dishDrafts, setDishDrafts] = useState<Record<string, DishReviewDraft>>({});
  const [selectedCourse, setSelectedCourse] = useState<DishCategory>('ENTREE');
  const [selectedDishToAdd, setSelectedDishToAdd] = useState('');

  const [newDishName, setNewDishName] = useState('');
  const [newDishCategory, setNewDishCategory] = useState<DishCategory>('ENTREE');
  const [newDishStatus, setNewDishStatus] = useState<DishStatus>('ACTIVE');
  const [menuActionLoading, setMenuActionLoading] = useState(false);
  const [menuSyncLoading, setMenuSyncLoading] = useState(false);
  const [selectedDishDetails, setSelectedDishDetails] = useState<DishDetailsResponse | null>(null);
  const [dishDetailsLoading, setDishDetailsLoading] = useState(false);
  const [dishImageUrls, setDishImageUrls] = useState<Record<string, string>>({});
  const menuSyncInFlight = useRef(false);
  const reviewsEmptySyncAttemptedRef = useRef(false);

  const viewer = getUser<{ id: string; name: string }>();
  const token = getToken();

  const menuItems = useMemo(() => data?.menu.activeAndSeasonal ?? [], [data]);
  const selectedDishes = useMemo(
    () => menuItems.filter((dish) => selectedDishIds.includes(dish.id)),
    [menuItems, selectedDishIds],
  );
  const availableDishesForSelectedCourse = useMemo(
    () =>
      menuItems.filter(
        (dish) => dish.category === selectedCourse && !selectedDishIds.includes(dish.id),
      ),
    [menuItems, selectedCourse, selectedDishIds],
  );

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [profile, reviewsResponse] = await Promise.all([
        apiRequest<RestaurantProfileResponse>(`/restaurants/${restaurantId}`),
        apiRequest<RestaurantReviewsResponse>(`/restaurants/${restaurantId}/reviews?limit=10`),
      ]);
      setData(profile);
      setReviews(reviewsResponse.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load restaurant');
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    reviewsEmptySyncAttemptedRef.current = false;
  }, [restaurantId]);

  const syncMenuIfNeeded = useCallback(
    async (origin: 'menu-tab' | 'reviews-tab-empty') => {
      if (menuSyncInFlight.current) {
        return;
      }

      menuSyncInFlight.current = true;
      setMenuSyncLoading(true);

      try {
        const sync = await apiRequest<MenuSyncResponse>(`/restaurants/${restaurantId}/menu/sync`, {
          method: 'POST',
        });

        if (sync.reason === 'FETCHED') {
          if (sync.createdCount > 0) {
            setMessage(
              `${sync.createdCount} menu item${sync.createdCount === 1 ? '' : 's'} added automatically from ${sync.provider}.`,
            );
          } else if (origin === 'reviews-tab-empty') {
            setMessage('Menu was checked automatically. Add a dish from the Menu tab if needed.');
          }
        }

        if (sync.reason === 'COOLDOWN' && origin === 'reviews-tab-empty') {
          setMessage('Menu sync is temporarily cooling down. Please try again shortly.');
        }

        await fetchProfile();
      } catch (err) {
        if (origin === 'reviews-tab-empty') {
          setMessage(err instanceof Error ? err.message : 'Unable to auto-sync menu right now');
        }
      } finally {
        setMenuSyncLoading(false);
        menuSyncInFlight.current = false;
      }
    },
    [fetchProfile, restaurantId],
  );

  useEffect(() => {
    if (tab === 'menu') {
      void syncMenuIfNeeded('menu-tab');
    }
  }, [tab, syncMenuIfNeeded]);

  useEffect(() => {
    if (tab === 'reviews' && !menuItems.length && !loading && !reviewsEmptySyncAttemptedRef.current) {
      reviewsEmptySyncAttemptedRef.current = true;
      void syncMenuIfNeeded('reviews-tab-empty');
    }
  }, [tab, menuItems.length, loading, syncMenuIfNeeded]);

  useEffect(() => {
    if (!menuItems.length) {
      setSelectedDishIds([]);
      setDishDrafts({});
      setSelectedDishToAdd('');
      return;
    }

    const availableIds = new Set(menuItems.map((dish) => dish.id));

    setSelectedDishIds((previous) => {
      return previous.filter((dishId) => availableIds.has(dishId));
    });

    setDishDrafts((previous) => {
      const next: Record<string, DishReviewDraft> = {};

      for (const [dishId, draft] of Object.entries(previous)) {
        if (availableIds.has(dishId)) {
          next[dishId] = draft;
        }
      }

      return next;
    });
  }, [menuItems]);

  useEffect(() => {
    if (!menuItems.length) {
      return;
    }

    const hasDishesInSelectedCourse = menuItems.some((dish) => dish.category === selectedCourse);
    if (hasDishesInSelectedCourse) {
      return;
    }

    const fallbackCourse = DISH_COURSES.find((course) => menuItems.some((dish) => dish.category === course));
    if (fallbackCourse) {
      setSelectedCourse(fallbackCourse);
    }
  }, [menuItems, selectedCourse]);

  useEffect(() => {
    if (!availableDishesForSelectedCourse.length) {
      setSelectedDishToAdd('');
      return;
    }

    setSelectedDishToAdd((current) => {
      if (current && availableDishesForSelectedCourse.some((dish) => dish.id === current)) {
        return current;
      }

      return availableDishesForSelectedCourse[0].id;
    });
  }, [availableDishesForSelectedCourse]);

  const updateDishDraft = <K extends keyof DishReviewDraft,>(
    dishId: string,
    key: K,
    value: DishReviewDraft[K],
  ) => {
    setDishDrafts((previous) => ({
      ...previous,
      [dishId]: {
        ...(previous[dishId] ?? createDefaultDishDraft()),
        [key]: value,
      },
    }));
  };

  const openDishDetails = async (dishId: string) => {
    setDishDetailsLoading(true);
    setSelectedDishDetails(null);

    try {
      const details = await apiRequest<DishDetailsResponse>(`/restaurants/${restaurantId}/menu/${dishId}`);
      setSelectedDishDetails(details);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load dish details');
    } finally {
      setDishDetailsLoading(false);
    }
  };

  const addDishToMeal = () => {
    if (!selectedDishToAdd) {
      return;
    }

    setSelectedDishIds((previous) => {
      if (previous.includes(selectedDishToAdd)) {
        return previous;
      }

      return [...previous, selectedDishToAdd];
    });

    setDishDrafts((previous) => {
      if (previous[selectedDishToAdd]) {
        return previous;
      }

      return {
        ...previous,
        [selectedDishToAdd]: createDefaultDishDraft(),
      };
    });
  };

  const removeDishFromMeal = (dishId: string) => {
    setSelectedDishIds((previous) => previous.filter((id) => id !== dishId));
  };

  const submitMealReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !viewer) {
      setMessage('Please login first to submit a review.');
      return;
    }

    if (!selectedDishIds.length) {
      setMessage('Select at least one dish for this meal review.');
      return;
    }

    setReviewLoading(true);
    setMessage(null);
    setRecipeMatches([]);

    try {
      const result = await apiRequest<MealReviewResult>('/meal-reviews', {
        method: 'POST',
        token,
        body: {
          restaurantId,
          serviceScore,
          atmosphereScore,
          valueScore,
          reviewText: mealReviewText || undefined,
          dishes: selectedDishIds.map((dishId) => {
            const draft = dishDrafts[dishId] ?? createDefaultDishDraft();

            return {
              dishId,
              tasteScore: draft.taste,
              portionScore: draft.portion,
              costScore: draft.cost,
              presentationScore: draft.presentation,
              reviewText: draft.reviewText || undefined,
              imageUrl: dishImageUrls[dishId] || undefined,
            };
          }),
        },
      });

      setMessage(`Meal review submitted! ${result.mealReview.dishReviews.length} dish reviews saved.`);
      setRecipeMatches(result.recipeMatches);
      setMealReviewText('');
      setDishDrafts((previous) => {
        const next = { ...previous };
        selectedDishIds.forEach((dishId) => {
          const current = next[dishId] ?? createDefaultDishDraft();
          next[dishId] = {
            ...current,
            reviewText: '',
          };
        });
        return next;
      });
      setDishImageUrls((prev) => {
        const next = { ...prev };
        selectedDishIds.forEach((dishId) => {
          delete next[dishId];
        });
        return next;
      });
      await fetchProfile();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to submit meal review');
    } finally {
      setReviewLoading(false);
    }
  };

  const addMenuItem = async (event: FormEvent) => {
    event.preventDefault();

    if (!token) {
      setMessage('Please login first.');
      return;
    }

    setMenuActionLoading(true);
    try {
      await apiRequest<Dish>('/dishes', {
        method: 'POST',
        token,
        body: {
          restaurantId,
          name: newDishName,
          category: newDishCategory,
          status: newDishStatus,
          source: 'USER',
        },
      });
      setNewDishName('');
      setMessage('Dish added.');
      await fetchProfile();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to add dish');
    } finally {
      setMenuActionLoading(false);
    }
  };

  const flagUnavailable = async (id: string) => {
    if (!token) {
      setMessage('Please login first.');
      return;
    }

    try {
      await apiRequest<EmptyResponse>(`/dishes/${id}/flag-unavailable`, {
        method: 'PATCH',
        token,
      });
      await fetchProfile();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to flag item');
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <p className="app-muted">Loading...</p>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <NavBar />
        <p className="app-error">{error ?? 'Restaurant not found'}</p>
      </>
    );
  }

  const { restaurant } = data;

  return (
    <>
      <NavBar />

      <section className="app-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="app-title break-words">{restaurant.name}</h1>
            <p className="app-muted break-words">{restaurant.address}</p>
            <p className="app-muted break-all text-sm">
              {restaurant.phone ?? 'No phone'} · {restaurant.website ?? 'No website'}
            </p>
          </div>

          <div className="app-card-soft w-full text-sm text-slate-300 sm:w-auto sm:min-w-56">
            <p>Overall: {restaurant.overallRating ?? 'No ratings yet'}</p>
            <p>Food: {restaurant.foodRating ?? 'No ratings yet'}</p>
            <p>Service: {restaurant.serviceRating ?? 'No ratings yet'}</p>
            <p>Atmosphere: {restaurant.atmosphereRating ?? 'No ratings yet'}</p>
            <p>Value: {restaurant.valueRating ?? 'No ratings yet'}</p>
            {restaurant.highRepeatCustomersBadge && (
              <p className="mt-2 inline-flex rounded-full border border-amber-300/30 bg-amber-300/15 px-2 py-1 text-xs text-amber-100">
                High Repeat Customers
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {(['overview', 'menu', 'reviews', 'historical'] as const).map((item) => (
            <button
              key={item}
              className={`app-tab ${tab === item ? 'app-tab-active' : ''}`}
              onClick={() => setTab(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        {message && <p className="app-muted mt-4 text-sm">{message}</p>}
      </section>

      {tab === 'overview' && (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="app-card-soft">
            <h2 className="app-section-title">Top 3 Rated Dishes</h2>
            <ul className="mt-2 space-y-2 text-sm text-slate-300">
              {data.topDishes.length ? (
                data.topDishes.map((dish) => (
                  <li key={dish.dishId} className="break-words">
                    {dish.name} · {dish.avgScore.toFixed(2)} ({dish.reviewCount} reviews)
                  </li>
                ))
              ) : (
                <li className="app-muted">No dish ratings yet.</li>
              )}
            </ul>
          </div>

          <div className="app-card-soft">
            <h2 className="app-section-title">Bottom 3 Rated Dishes</h2>
            <ul className="mt-2 space-y-2 text-sm text-slate-300">
              {data.bottomDishes.length ? (
                data.bottomDishes.map((dish) => (
                  <li key={dish.dishId} className="break-words">
                    {dish.name} · {dish.avgScore.toFixed(2)} ({dish.reviewCount} reviews)
                  </li>
                ))
              ) : (
                <li className="app-muted">No dish ratings yet.</li>
              )}
            </ul>
          </div>
        </section>
      )}

      {tab === 'menu' && (
        <section className="app-card mt-6">
          <h2 className="app-section-title">Menu (Active + Seasonal)</h2>

          {menuSyncLoading && <p className="app-muted mt-3 text-sm">Syncing menu automatically…</p>}

          <form className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={addMenuItem}>
            <input
              className="app-input sm:col-span-2 lg:col-span-2"
              placeholder="Add seasonal/limited item"
              value={newDishName}
              onChange={(e) => setNewDishName(e.target.value)}
              required
            />
            <select
              className="app-select"
              value={newDishCategory}
              onChange={(e) => setNewDishCategory(e.target.value as DishCategory)}
            >
              <option value="APPETIZER">Appetizer</option>
              <option value="ENTREE">Entree</option>
              <option value="SIDE">Side</option>
              <option value="DESSERT">Dessert</option>
            </select>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <select
                className="app-select"
                value={newDishStatus}
                onChange={(e) => setNewDishStatus(e.target.value as DishStatus)}
              >
                <option value="ACTIVE">Active</option>
                <option value="SEASONAL">Seasonal/Limited</option>
              </select>
              <button className="app-btn-primary w-full whitespace-nowrap sm:w-auto" disabled={menuActionLoading || menuSyncLoading}>
                Add
              </button>
            </div>
          </form>

          <ul className="mt-3 space-y-2 text-sm">
            {data.menu.activeAndSeasonal.length ? (
              data.menu.activeAndSeasonal.map((dish) => (
                <li key={dish.id} className="app-list-item flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    className="text-left break-words text-slate-300 hover:text-teal-200"
                    onClick={() => void openDishDetails(dish.id)}
                  >
                    {dish.name} · {dish.category} · {dish.status}
                    <span className="ml-2 text-xs text-slate-400">
                      Rating: {dish.avgDishScore ? dish.avgDishScore.toFixed(2) : 'N/A'}
                      {' '}({dish.reviewCount ?? 0})
                    </span>
                  </button>
                  <span className="sr-only">
                    Open details for {dish.name}
                  </span>
                  <button className="app-btn-secondary w-full px-3 py-1.5 sm:w-auto" onClick={() => flagUnavailable(dish.id)}>
                    Flag unavailable ({dish.unavailableFlagCount})
                  </button>
                </li>
              ))
            ) : (
              <li className="app-muted">
                {menuSyncLoading ? 'Loading menu items…' : 'No active dishes yet. Add one from the form above.'}
              </li>
            )}
          </ul>
        </section>
      )}

      {tab === 'historical' && (
        <section className="app-card mt-6">
          <h2 className="app-section-title">Historical Menu</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {data.menu.historical.length ? (
              data.menu.historical.map((dish) => (
                <li key={dish.id} className="app-list-item text-slate-300">
                  {dish.name} · {dish.category} · flags: {dish.unavailableFlagCount}
                </li>
              ))
            ) : (
              <li className="app-muted">No historical dishes yet.</li>
            )}
          </ul>
        </section>
      )}

      {tab === 'reviews' && (
        <section className="app-card mt-6">
          <h2 className="app-section-title">Submit one meal review (restaurant + each dish)</h2>

          <form className="mt-3 space-y-4" onSubmit={submitMealReview}>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm text-slate-300">
                Service (1-10)
                <input
                  className="app-input mt-1"
                  type="number"
                  min={1}
                  max={10}
                  value={serviceScore}
                  onChange={(e) => setServiceScore(Number(e.target.value))}
                />
              </label>
              <label className="text-sm text-slate-300">
                Atmosphere (1-10)
                <input
                  className="app-input mt-1"
                  type="number"
                  min={1}
                  max={10}
                  value={atmosphereScore}
                  onChange={(e) => setAtmosphereScore(Number(e.target.value))}
                />
              </label>
              <label className="text-sm text-slate-300">
                Value (1-10)
                <input
                  className="app-input mt-1"
                  type="number"
                  min={1}
                  max={10}
                  value={valueScore}
                  onChange={(e) => setValueScore(Number(e.target.value))}
                />
              </label>
            </div>

            <textarea
              className="app-textarea"
              rows={3}
              placeholder="Optional overall meal note"
              value={mealReviewText}
              onChange={(e) => setMealReviewText(e.target.value)}
            />

            <div>
              <p className="text-sm font-medium text-slate-200">Select dishes you ate in this meal</p>
              <div className="mt-2 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <label className="text-sm text-slate-300">
                    Course
                    <select
                      className="app-select mt-1"
                      value={selectedCourse}
                      onChange={(e) => setSelectedCourse(e.target.value as DishCategory)}
                    >
                      {DISH_COURSES.map((course) => (
                        <option key={course} value={course}>
                          {DISH_COURSE_LABEL[course]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm text-slate-300">
                    Dish
                    <select
                      className="app-select mt-1"
                      value={selectedDishToAdd}
                      onChange={(e) => setSelectedDishToAdd(e.target.value)}
                      disabled={!availableDishesForSelectedCourse.length}
                    >
                      {availableDishesForSelectedCourse.length ? (
                        availableDishesForSelectedCourse.map((dish) => (
                          <option key={dish.id} value={dish.id}>
                            {dish.name}
                          </option>
                        ))
                      ) : (
                        <option value="">No available dishes for this course</option>
                      )}
                    </select>
                  </label>

                  <button
                    type="button"
                    className="app-btn-primary w-full md:h-[42px] md:w-auto"
                    onClick={addDishToMeal}
                    disabled={!selectedDishToAdd}
                  >
                    Add dish
                  </button>
                </div>

                <p className="app-muted mt-2 text-xs">
                  Change course, add a dish, then switch course again until all items you ate are selected.
                </p>

                {selectedDishes.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                    {selectedDishes.map((dish) => (
                      <li key={dish.id} className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 break-words">
                        {dish.name} ({DISH_COURSE_LABEL[dish.category]})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {selectedDishes.length > 0 && (
              <div className="space-y-3">
                {selectedDishes.map((dish) => {
                  const draft = dishDrafts[dish.id] ?? createDefaultDishDraft();

                  return (
                    <div key={dish.id} className="app-list-item">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <p className="font-medium text-slate-100 break-words">
                          {dish.name}{' '}
                          <span className="text-sm text-slate-400">({DISH_COURSE_LABEL[dish.category]})</span>
                        </p>
                        <button
                          type="button"
                          className="app-btn-danger w-full px-2 py-1 text-xs sm:w-auto"
                          onClick={() => removeDishFromMeal(dish.id)}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <label className="text-sm text-slate-300">
                          Taste (1-10)
                          <input
                            className="app-input mt-1"
                            type="number"
                            min={1}
                            max={10}
                            value={draft.taste}
                            onChange={(e) => updateDishDraft(dish.id, 'taste', Number(e.target.value))}
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Portion (1-10)
                          <input
                            className="app-input mt-1"
                            type="number"
                            min={1}
                            max={10}
                            value={draft.portion}
                            onChange={(e) => updateDishDraft(dish.id, 'portion', Number(e.target.value))}
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Cost (1-10)
                          <input
                            className="app-input mt-1"
                            type="number"
                            min={1}
                            max={10}
                            value={draft.cost}
                            onChange={(e) => updateDishDraft(dish.id, 'cost', Number(e.target.value))}
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Presentation (1-10)
                          <input
                            className="app-input mt-1"
                            type="number"
                            min={1}
                            max={10}
                            value={draft.presentation}
                            onChange={(e) => updateDishDraft(dish.id, 'presentation', Number(e.target.value))}
                          />
                        </label>
                      </div>

                      <textarea
                        className="app-textarea mt-2 text-sm"
                        rows={2}
                        placeholder="Optional note for this dish"
                        value={draft.reviewText}
                        onChange={(e) => updateDishDraft(dish.id, 'reviewText', e.target.value)}
                      />

                      <input
                        className="app-input mt-2"
                        type="url"
                        placeholder="Optional dish photo URL"
                        value={dishImageUrls[dish.id] ?? ''}
                        onChange={(e) =>
                          setDishImageUrls((prev) => ({
                            ...prev,
                            [dish.id]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <button className="app-btn-primary w-full sm:w-auto" disabled={reviewLoading}>
              {reviewLoading ? 'Submitting...' : 'Submit meal review'}
            </button>
          </form>

          {recipeMatches.length > 0 && (
            <div className="app-card-soft mt-4">
              <p className="font-medium text-slate-100">Recipe matches</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-300">
                {recipeMatches.map((match, index) => (
                  <li key={`${match.link}-${index}`} className="break-words">
                    {match.title}{' '}
                    <a className="inline-block break-all text-teal-300 underline hover:text-teal-200" href={match.link} target="_blank" rel="noreferrer">
                      View recipe
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 border-t border-slate-800 pt-4">
            <h3 className="app-section-title">Recent reviews</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {reviews.length ? (
                reviews.map((review) => (
                  <li key={review.id} className="app-list-item">
                    <p className="font-medium text-slate-100 break-words">
                      {review.dish.name} · {review.dishScore.toFixed(2)} by {review.user.name}
                    </p>
                    {review.mealReview && (
                      <p className="app-muted break-words text-xs">
                        Service {review.mealReview.serviceScore} · Atmosphere {review.mealReview.atmosphereScore} ·
                        {' '}Value {review.mealReview.valueScore}
                      </p>
                    )}
                    {review.reviewText && <p className="app-muted break-words">“{review.reviewText}”</p>}
                    {review.mealReview?.reviewText && (
                      <p className="break-words text-xs text-slate-500">Meal note: “{review.mealReview.reviewText}”</p>
                    )}
                  </li>
                ))
              ) : (
                <li className="app-muted">No reviews yet.</li>
              )}
            </ul>
          </div>
        </section>
      )}

      {(dishDetailsLoading || selectedDishDetails) && (
        <section className="app-card mt-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="app-section-title">Dish Details</h2>
            {selectedDishDetails && (
              <button
                type="button"
                className="app-btn-secondary px-3 py-1.5"
                onClick={() => setSelectedDishDetails(null)}
              >
                Close
              </button>
            )}
          </div>

          {dishDetailsLoading && <p className="app-muted mt-2">Loading dish details...</p>}

          {selectedDishDetails && (
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              <p className="text-slate-100 font-medium">{selectedDishDetails.dish.name}</p>
              <p>
                Overall: {selectedDishDetails.aggregates.avgDishScore?.toFixed(2) ?? 'N/A'} · Reviews:{' '}
                {selectedDishDetails.aggregates.reviewCount}
              </p>
              <p>
                Taste: {selectedDishDetails.aggregates.avgTaste?.toFixed(2) ?? 'N/A'} · Portion:{' '}
                {selectedDishDetails.aggregates.avgPortion?.toFixed(2) ?? 'N/A'} · Cost:{' '}
                {selectedDishDetails.aggregates.avgCost?.toFixed(2) ?? 'N/A'} · Presentation:{' '}
                {selectedDishDetails.aggregates.avgPresentation?.toFixed(2) ?? 'N/A'}
              </p>
              <p className="app-muted">{selectedDishDetails.summary}</p>

              {selectedDishDetails.photos.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedDishDetails.photos.map((photoUrl) => (
                    <a
                      key={photoUrl}
                      href={photoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="app-list-item break-all text-xs text-teal-200 hover:text-teal-100"
                    >
                      {photoUrl}
                    </a>
                  ))}
                </div>
              )}

              <ul className="space-y-2">
                {selectedDishDetails.recentReviews.map((review) => (
                  <li key={review.id} className="app-list-item">
                    <p className="font-medium text-slate-100">
                      {review.user.name} · {review.dishScore.toFixed(2)}
                    </p>
                    <p className="app-muted text-xs">
                      Taste {review.tasteScore} · Portion {review.portionScore} · Cost {review.costScore} ·
                      {' '}Presentation {review.presentationScore}
                    </p>
                    {review.reviewText && <p className="mt-1">“{review.reviewText}”</p>}
                    {review.imageUrl && (
                      <a
                        href={review.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-teal-200 underline"
                      >
                        View dish photo
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
