export type AuthResponse = {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    recipeMatchEnabled: boolean;
  };
};

export type Restaurant = {
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

export type Dish = {
  id: string;
  restaurantId: string;
  name: string;
  category: 'APPETIZER' | 'ENTREE' | 'SIDE' | 'DESSERT';
  status: 'ACTIVE' | 'SEASONAL' | 'HISTORICAL';
  unavailableFlagCount: number;
  isActive: boolean;
};
