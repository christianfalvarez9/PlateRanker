'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { getUser } from '@/lib/auth';

type Viewer = {
  id: string;
  name: string;
};

export default function HomePage() {
  const router = useRouter();
  const viewer = getUser<Viewer>();

  useEffect(() => {
    if (viewer?.id) {
      router.push(`/dashboard?userId=${viewer.id}`);
    }
  }, [viewer, router]);

  // Show landing page for non-logged-in users
  if (!viewer) {
    return (
      <>
        <NavBar />

        <section className="app-card text-center">
          <h1 className="app-title">Welcome to PlateRank</h1>
          <p className="app-muted mt-4 text-lg">
            Because Not All Dishes Are Created Equal
          </p>
          
          <div className="mt-8 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            <div className="app-card-soft">
              <h3 className="text-lg font-semibold text-teal-300">Rate Individual Plates</h3>
              <p className="app-muted mt-2 text-sm">
                Go beyond restaurant ratings. Rate each plate you try with detailed scoring for taste, value, presentation, and more.
              </p>
            </div>
            
            <div className="app-card-soft">
              <h3 className="text-lg font-semibold text-teal-300">Discover Top Plates</h3>
              <p className="app-muted mt-2 text-sm">
                Find the highest-rated plates in your area. See what's trending and what the community loves.
              </p>
            </div>
            
            
            <div className="app-card-soft">
              <h3 className="text-lg font-semibold text-teal-300">Track Your Favorites</h3>
              <p className="app-muted mt-2 text-sm">
                Build your Want to Visit list and keep track of restaurants you want to try.
              </p>
            </div>
            
            <div className="app-card-soft">
              <h3 className="text-lg font-semibold text-teal-300">Detailed Analytics</h3>
              <p className="app-muted mt-2 text-sm">
                See your top-rated plates, favorite restaurants, and review history all in one dashboard.
              </p>
            </div>
            
            <div className="app-card-soft">
              <h3 className="text-lg font-semibold text-teal-300">Community Insights</h3>
              <p className="app-muted mt-2 text-sm">
                Read AI-generated summaries of community reviews to quickly understand what makes each plate special.
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/register" className="app-btn-primary px-8 py-3 text-center text-base">
              Get Started
            </Link>
            <Link href="/login" className="app-btn-secondary px-8 py-3 text-center text-base">
              Login
            </Link>
          </div>
          
          <p className="app-muted mt-6 text-sm">
            Use the search bar above to explore restaurants and plates
          </p>
        </section>
      </>
    );
  }

  // Logged-in users are redirected to dashboard
  return (
    <>
      <NavBar />
      <section className="app-card">
        <p className="app-muted">Redirecting to your dashboard...</p>
      </section>
    </>
  );
}
