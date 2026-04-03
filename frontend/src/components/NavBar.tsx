'use client';

import Link from 'next/link';
import { clearAuth, getUser } from '@/lib/auth';
import { useEffect, useState } from 'react';

type Viewer = {
  id: string;
  name: string;
};

export function NavBar() {
  const [viewer, setViewer] = useState<Viewer | null>(null);

  useEffect(() => {
    setViewer(getUser<Viewer>());
  }, []);

  return (
    <header className="mb-8 rounded-2xl border border-slate-800/90 bg-slate-950/70 px-4 py-3 shadow-2xl shadow-black/20 backdrop-blur md:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/"
          className="self-start text-xl font-semibold tracking-tight text-teal-300 transition hover:text-teal-200"
        >
          PlateRank
        </Link>

        <nav className="grid w-full grid-cols-2 gap-2 text-sm sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
          <Link
            href="/"
            className="rounded-lg px-3 py-2 text-center text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
          >
            Search
          </Link>
          {viewer ? (
            <>
              <Link
                href={`/dashboard?userId=${viewer.id}`}
                className="rounded-lg px-3 py-2 text-center text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
              >
                Dashboard
              </Link>
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
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-2 text-center text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
              >
                Login
              </Link>
              <Link href="/register" className="app-btn-primary w-full px-3 py-2 text-center text-sm sm:w-auto sm:py-1.5">
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
