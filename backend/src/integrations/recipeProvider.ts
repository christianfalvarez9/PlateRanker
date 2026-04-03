import axios from 'axios';
import { env } from '../config/env';

export type RecipeMatch = {
  title: string;
  image: string;
  link: string;
};

export async function findRecipeMatch(query: string): Promise<RecipeMatch | null> {
  if (!env.recipeApiKey) {
    return {
      title: `${query} (Sample Recipe)`,
      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
      link: 'https://www.allrecipes.com/',
    };
  }

  // Example using Spoonacular-like search pattern.
  const url = `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(query)}&number=1&apiKey=${env.recipeApiKey}`;
  const response = await axios.get(url);
  const first = response.data?.results?.[0];

  if (!first) {
    return null;
  }

  return {
    title: first.title,
    image: first.image,
    link: `https://spoonacular.com/recipes/${first.title}-${first.id}`,
  };
}
