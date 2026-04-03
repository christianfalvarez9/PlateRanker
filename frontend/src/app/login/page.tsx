'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { apiRequest } from '@/lib/api';
import { setAuth } from '@/lib/auth';
import { AuthResponse } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setAuth(result.token, result.user);
      router.push(`/dashboard?userId=${result.user.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <NavBar />
      <div className="app-card mx-auto max-w-md">
        <h1 className="app-title">Login</h1>
        <p className="app-muted mt-1 text-sm">Welcome back. Sign in to continue rating and reviewing meals.</p>
        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <input
            className="app-input"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="app-input"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="app-btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          {error && <p className="app-error">{error}</p>}
        </form>
      </div>
    </>
  );
}
