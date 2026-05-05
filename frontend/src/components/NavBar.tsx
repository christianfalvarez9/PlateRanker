'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearAuth, getUser } from '@/lib/auth';
import { FormEvent, useEffect, useState } from 'react';

type Viewer = {
  id: string;
  name: string;
};

export function NavBar() {
  const router = useRouter();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLocation, setSearchLocation] = useState('');

  useEffect(() => {
    setViewer(getUser<Viewer>());
  }, []);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    
    const trimmedQuery = searchQuery.trim();
    const trimmedLocation = searchLocation.trim();
    
    if (!trimmedQuery && !trimmedLocation) {
      return;
    }

    const params = new URLSearchParams();
    
    if (trimmedQuery) {
      params.set('query', trimmedQuery);
    } else if (trimmedLocation) {
      params.set('query', 'restaurants');
    }
    
    if (trimmedLocation) {
      params.set('location', trimmedLocation);
    }

    router.push(`/search?${params.toString()}`);
    setSearchExpanded(false);
    setSearchQuery('');
    setSearchLocation('');
  };

  const homeLink = viewer ? `/dashboard?userId=${viewer.id}` : '/';

  return (
    <header className="sticky top-0 z-50 mb-8 rounded-2xl border border-slate-800/90 bg-slate-950/90 px-4 py-3 shadow-2xl shadow-black/20 backdrop-blur md:px-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            href={homeLink}
            className="text-xl font-semibold tracking-tight text-teal-300 transition hover:text-teal-200"
          >
            PlateRank
          </Link>

          <button
            type="button"
            className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-800 hover:text-slate-100 lg:hidden"
            onClick={() => setSearchExpanded(!searchExpanded)}
            aria-label="Toggle search"
            aria-expanded={searchExpanded}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-6 w-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
          </button>
        </div>

        {/* Desktop Search - Always Visible */}
        <form onSubmit={handleSearch} className="hidden lg:flex lg:items-center lg:gap-2">
          <input
            type="text"
            className="app-input min-w-[200px] flex-1 py-2 text-sm"
            placeholder="Search restaurants, cuisine, plates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <input
            type="text"
            className="app-input min-w-[180px] flex-1 py-2 text-sm"
            placeholder="Location (city, ZIP)"
            value={searchLocation}
            onChange={(e) => setSearchLocation(e.target.value)}
          />
          <button type="submit" className="app-btn-primary whitespace-nowrap px-4 py-2 text-sm">
            Search
          </button>
        </form>

        {/* Mobile Search - Collapsible */}
        {searchExpanded && (
          <form onSubmit={handleSearch} className="flex flex-col gap-2 lg:hidden">
            <input
              type="text"
              className="app-input py-2 text-sm"
              placeholder="Search restaurants, cuisine, plates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <input
              type="text"
              className="app-input py-2 text-sm"
              placeholder="Location (city, ZIP)"
              value={searchLocation}
              onChange={(e) => setSearchLocation(e.target.value)}
            />
            <button type="submit" className="app-btn-primary w-full py-2 text-sm">
              Search
            </button>
          </form>
        )}

        <nav className="grid w-full grid-cols-2 gap-2 text-sm sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
          {viewer && (
            <>
            <Link
              href="/profile"
              className="rounded-lg px-3 py-2 text-center text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
            >
              Profile
            </Link>
            <button
              className="app-btn-secondary w-full px-3 py-2 text-center sm:w-auto sm:px-3 sm:py-1.5"
              onClick={() => {
                clearAuth();
                window.location.href = '/';
              }}
            >
              Logout
            </button>
          </>
          )}
          {!viewer && (
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-center text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
            >
              Login
            </Link>
            <Link href="/register" className="app-btn-primary w-full px-3 py-2 text-center text-sm sm:w-auto sm:py-1.5">
              Register
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
