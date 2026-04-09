'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { findSimilarDishName } from '@/lib/dishNameSimilarity';

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
  portionSize: number;
  value: number;
  presentation: number;
  uniqueness: number;
  reviewText: string;
};

type DishPhotoUploadState = {
  uploading: boolean;
  error: string | null;
  fileName: string | null;
};

const DISH_COURSES: DishCategory[] = ['APPETIZER', 'ENTREE', 'SIDE', 'DESSERT'];

const DISH_COURSE_LABEL: Record<DishCategory, string> = {
  APPETIZER: 'Appetizer',
  ENTREE: 'Entree',
  SIDE: 'Side',
  DESSERT: 'Dessert',
};

const ADD_NEW_DISH_OPTION_VALUE = '__add_new_dish__';

type RecipeMatch = {
  title: string;
  link: string;
};

const createDefaultDishDraft = (): DishReviewDraft => ({
  taste: 8,
  portionSize: 8,
  value: 8,
  presentation: 8,
  uniqueness: 8,
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
    avgPortionSize: number | null;
    avgValue: number | null;
    avgPresentation: number | null;
    avgUniqueness: number | null;
  };
  summary: string;
  photos: string[];
  recentReviews: Array<{
    id: string;
    dishScore: number;
    tasteScore: number;
    portionSizeScore: number;
    valueScore: number;
    presentationScore: number;
    uniquenessScore: number;
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

type UploadDishPhotoResponse = {
  imageUrl: string;
  objectPath: string;
};

function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizePhoneForTel(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    return '';
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

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
  const [menuCourseFilter, setMenuCourseFilter] = useState<DishCategory>('ENTREE');

  const [newDishName, setNewDishName] = useState('');
  const [newDishCategory, setNewDishCategory] = useState<DishCategory>('ENTREE');
  const [newDishIsLimitedTime, setNewDishIsLimitedTime] = useState(false);
  const [reviewNewDishName, setReviewNewDishName] = useState('');
  const [reviewNewDishCategory, setReviewNewDishCategory] = useState<DishCategory>('ENTREE');
  const [reviewNewDishIsLimitedTime, setReviewNewDishIsLimitedTime] = useState(false);
  const [menuActionLoading, setMenuActionLoading] = useState(false);
  const [expandedDishId, setExpandedDishId] = useState<string | null>(null);
  const [dishDetailsById, setDishDetailsById] = useState<Record<string, DishDetailsResponse>>({});
  const [dishDetailsLoadingById, setDishDetailsLoadingById] = useState<Record<string, boolean>>({});
  const [dishDetailsErrorById, setDishDetailsErrorById] = useState<Record<string, string | null>>({});
  const [dishImageUrls, setDishImageUrls] = useState<Record<string, string>>({});
  const [dishPhotoUploadStates, setDishPhotoUploadStates] = useState<Record<string, DishPhotoUploadState>>({});
  const [showDishPhotosById, setShowDishPhotosById] = useState<Record<string, boolean>>({});

  const viewer = getUser<{ id: string; name: string }>();
  const token = getToken();

  const menuItems = useMemo(() => data?.menu.activeAndSeasonal ?? [], [data]);
  const allKnownMenuItems = useMemo(
    () => [...(data?.menu.activeAndSeasonal ?? []), ...(data?.menu.historical ?? [])],
    [data],
  );
  const allKnownMenuItemNames = useMemo(() => allKnownMenuItems.map((dish) => dish.name), [allKnownMenuItems]);
  const menuItemsForSelectedCourse = useMemo(
    () => menuItems.filter((dish) => dish.category === menuCourseFilter),
    [menuItems, menuCourseFilter],
  );
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
    if (!menuItems.length) {
      return;
    }

    const hasDishesInSelectedCourse = menuItems.some((dish) => dish.category === menuCourseFilter);
    if (hasDishesInSelectedCourse) {
      return;
    }

    const fallbackCourse = DISH_COURSES.find((course) => menuItems.some((dish) => dish.category === course));
    if (fallbackCourse) {
      setMenuCourseFilter(fallbackCourse);
    }
  }, [menuItems, menuCourseFilter]);

  useEffect(() => {
    if (!availableDishesForSelectedCourse.length) {
      setSelectedDishToAdd(ADD_NEW_DISH_OPTION_VALUE);
      return;
    }

    setSelectedDishToAdd((current) => {
      if (current === ADD_NEW_DISH_OPTION_VALUE) {
        return current;
      }

      if (current && availableDishesForSelectedCourse.some((dish) => dish.id === current)) {
        return current;
      }

      return availableDishesForSelectedCourse[0].id;
    });
  }, [availableDishesForSelectedCourse]);

  useEffect(() => {
    if (!expandedDishId) {
      return;
    }

    const stillExists = menuItems.some((dish) => dish.id === expandedDishId);
    if (!stillExists) {
      setExpandedDishId(null);
    }
  }, [expandedDishId, menuItems]);

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

  const toggleDishDetails = async (dishId: string) => {
    setDishDetailsErrorById((previous) => ({
      ...previous,
      [dishId]: null,
    }));

    if (expandedDishId === dishId) {
      setExpandedDishId(null);
      return;
    }

    setExpandedDishId(dishId);

    if (dishDetailsById[dishId] || dishDetailsLoadingById[dishId]) {
      return;
    }

    setDishDetailsLoadingById((previous) => ({
      ...previous,
      [dishId]: true,
    }));

    try {
      const details = await apiRequest<DishDetailsResponse>(`/restaurants/${restaurantId}/menu/${dishId}`);
      setDishDetailsById((previous) => ({
        ...previous,
        [dishId]: details,
      }));
    } catch (err) {
      setDishDetailsErrorById((previous) => ({
        ...previous,
        [dishId]: err instanceof Error ? err.message : 'Failed to load plate details',
      }));
    } finally {
      setDishDetailsLoadingById((previous) => ({
        ...previous,
        [dishId]: false,
      }));
    }
  };

  const addDishToMeal = () => {
    if (!selectedDishToAdd || selectedDishToAdd === ADD_NEW_DISH_OPTION_VALUE) {
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

  const setDishUploadState = (dishId: string, updates: Partial<DishPhotoUploadState>) => {
    setDishPhotoUploadStates((previous) => ({
      ...previous,
      [dishId]: {
        uploading: previous[dishId]?.uploading ?? false,
        error: previous[dishId]?.error ?? null,
        fileName: previous[dishId]?.fileName ?? null,
        ...updates,
      },
    }));
  };

  const uploadDishPhotoFile = async (dishId: string, file: File) => {
    if (!token) {
      setMessage('Please login first to upload plate photos.');
      return;
    }

    setDishUploadState(dishId, {
      uploading: true,
      error: null,
      fileName: file.name,
    });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploaded = await apiRequest<UploadDishPhotoResponse>('/uploads/dish-photo', {
        method: 'POST',
        token,
        body: formData,
      });

      setDishImageUrls((previous) => ({
        ...previous,
        [dishId]: uploaded.imageUrl,
      }));

      setDishUploadState(dishId, {
        uploading: false,
        error: null,
      });
    } catch (err) {
      setDishUploadState(dishId, {
        uploading: false,
        error: err instanceof Error ? err.message : 'Failed to upload image',
      });
    }
  };

  const submitMealReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !viewer) {
      setMessage('Please login first to submit a review.');
      return;
    }

    if (!selectedDishIds.length) {
      setMessage('Select at least one plate for this meal review.');
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
              portionSizeScore: draft.portionSize,
              valueScore: draft.value,
              presentationScore: draft.presentation,
              uniquenessScore: draft.uniqueness,
              reviewText: draft.reviewText || undefined,
              imageUrl: dishImageUrls[dishId] || undefined,
            };
          }),
        },
      });

      setMessage(`Meal review submitted! ${result.mealReview.dishReviews.length} plate reviews saved.`);
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
      setDishPhotoUploadStates((prev) => {
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

  const addPlateToRestaurantMenu = async (input: {
    name: string;
    category: DishCategory;
    isLimitedTime: boolean;
  }): Promise<Dish | null> => {
    if (!token) {
      setMessage('Please login first.');
      return null;
    }

    setMenuActionLoading(true);
    try {
      const createdDish = await apiRequest<Dish>('/dishes', {
        method: 'POST',
        token,
        body: {
          restaurantId,
          name: input.name,
          category: input.category,
          status: input.isLimitedTime ? 'SEASONAL' : 'ACTIVE',
          source: 'USER',
        },
      });
      await fetchProfile();
      return createdDish;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to add plate');
      return null;
    } finally {
      setMenuActionLoading(false);
    }
  };

  const addMenuItem = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedDishName = newDishName.trim();
    if (!trimmedDishName) {
      setMessage('Enter a plate name to add.');
      return;
    }

    const duplicate = findSimilarDishName(trimmedDishName, allKnownMenuItemNames);
    if (duplicate) {
      setMessage(`A similar plate already exists on this menu: ${duplicate.existingName}`);
      return;
    }

    const createdDish = await addPlateToRestaurantMenu({
      name: trimmedDishName,
      category: newDishCategory,
      isLimitedTime: newDishIsLimitedTime,
    });

    if (!createdDish) {
      return;
    }

    setNewDishName('');
    setNewDishIsLimitedTime(false);
    setMessage('Plate added.');
  };

  const addDishFromReview = async () => {
    const trimmedDishName = reviewNewDishName.trim();
    if (!trimmedDishName) {
      setMessage('Enter a plate name to add.');
      return;
    }

    const duplicate = findSimilarDishName(trimmedDishName, allKnownMenuItemNames);
    if (duplicate) {
      setMessage(`A similar plate already exists on this menu: ${duplicate.existingName}`);
      return;
    }

    const createdDish = await addPlateToRestaurantMenu({
      name: trimmedDishName,
      category: reviewNewDishCategory,
      isLimitedTime: reviewNewDishIsLimitedTime,
    });

    if (!createdDish) {
      return;
    }

    setReviewNewDishName('');
    setReviewNewDishIsLimitedTime(false);
    setSelectedCourse(createdDish.category);
    setSelectedDishToAdd(createdDish.id);
    setMessage('Plate added. Select it and click "Add plate" to include it in this review.');
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
  const websiteHref = restaurant.website ? normalizeWebsiteUrl(restaurant.website) : '';
  const phoneHref = restaurant.phone ? normalizePhoneForTel(restaurant.phone) : '';

  return (
    <>
      <NavBar />

      <section className="app-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="app-title break-words">{restaurant.name}</h1>
            <p className="app-muted break-words">{restaurant.address}</p>
            <p className="app-muted break-all text-sm">
              {restaurant.phone && phoneHref ? (
                <a
                  href={`tel:${phoneHref}`}
                  className="text-teal-300 underline hover:text-teal-200"
                >
                  {restaurant.phone}
                </a>
              ) : (
                'No phone'
              )}{' '}
              ·{' '}
              {restaurant.website && websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-teal-300 underline hover:text-teal-200"
                >
                  {restaurant.website}
                </a>
              ) : (
                'No website'
              )}
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
        <section className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="app-card-soft">
              <h2 className="app-section-title">Top 3 Rated Plates</h2>
              <ul className="mt-2 space-y-2 text-sm text-slate-300">
                {data.topDishes.length ? (
                  data.topDishes.map((dish) => (
                    <li key={dish.dishId} className="break-words">
                      {dish.name} · {dish.avgScore.toFixed(2)} ({dish.reviewCount} reviews)
                    </li>
                  ))
                ) : (
                  <li className="app-muted">No plate ratings yet.</li>
                )}
              </ul>
            </div>

            <div className="app-card-soft">
              <h2 className="app-section-title">Bottom 3 Rated Plates</h2>
              <ul className="mt-2 space-y-2 text-sm text-slate-300">
                {data.bottomDishes.length ? (
                  data.bottomDishes.map((dish) => (
                    <li key={dish.dishId} className="break-words">
                      {dish.name} · {dish.avgScore.toFixed(2)} ({dish.reviewCount} reviews)
                    </li>
                  ))
                ) : (
                  <li className="app-muted">No plate ratings yet.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="app-card-soft">
            <h2 className="app-section-title">Recent reviews</h2>
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

      {tab === 'menu' && (
        <section className="app-card mt-6">
          <h2 className="app-section-title">Menu (Active + Seasonal)</h2>

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
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-400"
                  checked={newDishIsLimitedTime}
                  onChange={(e) => setNewDishIsLimitedTime(e.target.checked)}
                />
                Limited time item
              </label>
              <button className="app-btn-primary w-full whitespace-nowrap sm:w-auto" disabled={menuActionLoading}>
                Add
              </button>
            </div>
          </form>

          <div className="mt-4 max-w-xs">
            <label className="text-sm text-slate-300">
              Course
              <select
                className="app-select mt-1"
                value={menuCourseFilter}
                onChange={(e) => setMenuCourseFilter(e.target.value as DishCategory)}
              >
                {DISH_COURSES.map((course) => (
                  <option key={course} value={course}>
                    {DISH_COURSE_LABEL[course]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="mt-3 space-y-2 text-sm">
            {menuItemsForSelectedCourse.length ? (
              menuItemsForSelectedCourse.map((dish) => {
                const isExpanded = expandedDishId === dish.id;
                const dishDetails = dishDetailsById[dish.id];
                const dishDetailsLoading = Boolean(dishDetailsLoadingById[dish.id]);
                const dishDetailsError = dishDetailsErrorById[dish.id];
                const showDishPhotos = Boolean(showDishPhotosById[dish.id]);

                return (
                  <li key={dish.id} className="app-list-item">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="text-left break-words text-slate-300 hover:text-teal-200"
                        onClick={() => void toggleDishDetails(dish.id)}
                        aria-expanded={isExpanded}
                        aria-controls={`dish-details-${dish.id}`}
                      >
                        <span className="font-medium text-slate-100">{dish.name}</span>
                        <span className="ml-2 text-xs text-slate-400">
                          Rating: {dish.avgDishScore ? dish.avgDishScore.toFixed(2) : 'N/A'} ({dish.reviewCount ?? 0})
                        </span>
                        <span className="ml-2 text-xs text-teal-300">{isExpanded ? 'Hide details' : 'View details'}</span>
                      </button>
                    </div>

                    {isExpanded && (
                      <div
                        id={`dish-details-${dish.id}`}
                        className="mt-3 space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300"
                      >
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="app-btn-secondary px-3 py-1.5"
                            onClick={() => flagUnavailable(dish.id)}
                          >
                            Flag unavailable ({dish.unavailableFlagCount})
                          </button>
                        </div>

                        {dishDetailsLoading && <p className="app-muted">Loading plate details...</p>}
                        {dishDetailsError && !dishDetailsLoading && <p className="app-error">{dishDetailsError}</p>}

                        {dishDetails && !dishDetailsLoading && (
                          <>
                            <p className="text-slate-100 font-medium">{dishDetails.dish.name}</p>
                            <p>
                              Overall: {dishDetails.aggregates.avgDishScore?.toFixed(2) ?? 'N/A'} · Reviews:{' '}
                              {dishDetails.aggregates.reviewCount}
                            </p>
                            <p>
                              Taste: {dishDetails.aggregates.avgTaste?.toFixed(2) ?? 'N/A'} · Portion Size:{' '}
                              {dishDetails.aggregates.avgPortionSize?.toFixed(2) ?? 'N/A'} · Value:{' '}
                              {dishDetails.aggregates.avgValue?.toFixed(2) ?? 'N/A'} · Presentation:{' '}
                              {dishDetails.aggregates.avgPresentation?.toFixed(2) ?? 'N/A'} · Uniqueness:{' '}
                              {dishDetails.aggregates.avgUniqueness?.toFixed(2) ?? 'N/A'}
                            </p>

                            <div className="rounded-xl border border-teal-400/30 bg-teal-400/10 p-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-teal-200">Community summary</p>
                              <p className="mt-1 text-sm text-slate-100">{dishDetails.summary}</p>
                              <p className="mt-2 text-xs text-slate-400">
                                Auto-generated from all submitted plate reviews and kept up to date as new reviews come in.
                              </p>
                            </div>

                            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Plate photos</p>
                                <button
                                  type="button"
                                  className="app-btn-secondary px-3 py-1 text-xs"
                                  onClick={() =>
                                    setShowDishPhotosById((previous) => ({
                                      ...previous,
                                      [dish.id]: !previous[dish.id],
                                    }))
                                  }
                                >
                                  {showDishPhotos
                                    ? 'Hide photos'
                                    : `Show photos (${dishDetails.photos.length})`}
                                </button>
                              </div>

                              {showDishPhotos && (
                                <div className="mt-3">
                                  {dishDetails.photos.length ? (
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                      {dishDetails.photos.map((photoUrl) => (
                                        <a
                                          key={photoUrl}
                                          href={photoUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="app-list-item overflow-hidden"
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={photoUrl}
                                            alt={`Plate photo for ${dishDetails.dish.name}`}
                                            className="h-36 w-full rounded-lg object-cover"
                                          />
                                          <p className="mt-2 break-all text-xs text-teal-200">Open full image</p>
                                        </a>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="app-muted text-xs">No plate photos have been uploaded yet.</p>
                                  )}
                                </div>
                              )}
                            </div>

                            <ul className="space-y-2">
                              {dishDetails.recentReviews.length ? (
                                dishDetails.recentReviews.map((review) => (
                                  <li key={review.id} className="app-list-item">
                                    <p className="font-medium text-slate-100">
                                      {review.user.name} · {review.dishScore.toFixed(2)}
                                    </p>
                                    <p className="app-muted text-xs">
                                      Taste {review.tasteScore} · Portion Size {review.portionSizeScore} · Value{' '}
                                      {review.valueScore} · Presentation {review.presentationScore} · Uniqueness{' '}
                                      {review.uniquenessScore}
                                    </p>
                                    {review.reviewText && <p className="mt-1">“{review.reviewText}”</p>}
                                    {review.imageUrl && (
                                      <a
                                        href={review.imageUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 inline-block text-xs text-teal-200 underline"
                                      >
                                        View plate photo
                                      </a>
                                    )}
                                  </li>
                                ))
                              ) : (
                                <li className="app-muted text-xs">No recent plate reviews yet.</li>
                              )}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })
            ) : (
              <li className="app-muted">No {DISH_COURSE_LABEL[menuCourseFilter].toLowerCase()} plates available.</li>
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
              <li className="app-muted">No historical plates yet.</li>
            )}
          </ul>
        </section>
      )}

      {tab === 'reviews' && (
        <section className="app-card mt-6">
          <h2 className="app-section-title">Submit your PlateRank</h2>

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
              <p className="text-sm font-medium text-slate-200">Select plates you ate in this meal</p>
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
                    Plate
                    <select
                      className="app-select mt-1"
                      value={selectedDishToAdd}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setSelectedDishToAdd(nextValue);
                        if (nextValue === ADD_NEW_DISH_OPTION_VALUE) {
                          setReviewNewDishCategory(selectedCourse);
                        }
                      }}
                    >
                      {availableDishesForSelectedCourse.map((dish) => (
                        <option key={dish.id} value={dish.id}>
                          {dish.name}
                        </option>
                      ))}
                      <option value={ADD_NEW_DISH_OPTION_VALUE}>+ Add a new plate...</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className="app-btn-primary w-full md:h-[42px] md:w-auto"
                    onClick={addDishToMeal}
                    disabled={!selectedDishToAdd || selectedDishToAdd === ADD_NEW_DISH_OPTION_VALUE}
                  >
                    Add plate
                  </button>
                </div>

                <p className="app-muted mt-2 text-xs">
                  Change course, add a plate, then switch course again until all items you ate are selected.
                </p>

                {selectedDishToAdd === ADD_NEW_DISH_OPTION_VALUE && (
                  <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
                    <p className="text-sm font-medium text-slate-200">Add a new plate to the menu</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <input
                        className="app-input sm:col-span-2 lg:col-span-2"
                        placeholder="Plate name"
                        value={reviewNewDishName}
                        onChange={(event) => setReviewNewDishName(event.target.value)}
                      />
                      <select
                        className="app-select"
                        value={reviewNewDishCategory}
                        onChange={(event) => setReviewNewDishCategory(event.target.value as DishCategory)}
                      >
                        {DISH_COURSES.map((course) => (
                          <option key={course} value={course}>
                            {DISH_COURSE_LABEL[course]}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-indigo-400"
                          checked={reviewNewDishIsLimitedTime}
                          onChange={(event) => setReviewNewDishIsLimitedTime(event.target.checked)}
                        />
                        Limited time item
                      </label>
                    </div>
                    <button
                      type="button"
                      className="app-btn-secondary mt-3 w-full sm:w-auto"
                      onClick={() => {
                        void addDishFromReview();
                      }}
                      disabled={menuActionLoading}
                    >
                      {menuActionLoading ? 'Adding...' : 'Add plate to menu'}
                    </button>
                  </div>
                )}

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
                  const uploadState = dishPhotoUploadStates[dish.id];

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
                          Portion Size (1-10)
                          <input
                            className="app-input mt-1"
                            type="number"
                            min={1}
                            max={10}
                            value={draft.portionSize}
                            onChange={(e) => updateDishDraft(dish.id, 'portionSize', Number(e.target.value))}
                          />
                        </label>
                        <label className="text-sm text-slate-300">
                          Value (1-10)
                          <input
                            className="app-input mt-1"
                            type="number"
                            min={1}
                            max={10}
                            value={draft.value}
                            onChange={(e) => updateDishDraft(dish.id, 'value', Number(e.target.value))}
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
                        <label className="text-sm text-slate-300">
                          Uniqueness (1-10)
                          <input
                            className="app-input mt-1"
                            type="number"
                            min={1}
                            max={10}
                            value={draft.uniqueness}
                            onChange={(e) => updateDishDraft(dish.id, 'uniqueness', Number(e.target.value))}
                          />
                        </label>
                      </div>

                      <label className="mt-2 block text-sm text-slate-300">
                        Optional plate review
                        <textarea
                          className="app-textarea mt-1 text-sm"
                          rows={2}
                          placeholder="Optional: share what stood out about this plate"
                          value={draft.reviewText}
                          onChange={(e) => updateDishDraft(dish.id, 'reviewText', e.target.value)}
                        />
                      </label>

                      <label className="mt-2 block text-sm text-slate-300">
                        Optional plate photo (camera or camera roll)
                        <input
                          className="app-input mt-1"
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) {
                              return;
                            }

                            void uploadDishPhotoFile(dish.id, file);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>

                      <div className="mt-1 text-xs">
                        {uploadState?.uploading && <p className="text-slate-400">Uploading photo...</p>}
                        {!uploadState?.uploading && dishImageUrls[dish.id] && (
                          <p className="text-emerald-300 break-all">
                            Photo attached{uploadState?.fileName ? `: ${uploadState.fileName}` : ''}
                          </p>
                        )}
                        {uploadState?.error && <p className="text-rose-300">{uploadState.error}</p>}
                      </div>

                      {dishImageUrls[dish.id] && (
                        <a
                          href={dishImageUrls[dish.id]}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-teal-200 underline break-all"
                        >
                          Preview attached photo
                        </a>
                      )}
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
        </section>
      )}

    </>
  );
}
