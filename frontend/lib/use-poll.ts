'use client';

import { useEffect, useState } from 'react';
import { api } from './veil-client';

/**
 * Poll a fetch-able JSON endpoint while the component is mounted. Used by every
 * page so dashboards stay live as the demo runtime updates state.
 */
export function usePoll<T>(path: string, fallback: T, intervalMs = 2500): { data: T; error: string | null } {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const next = await api<T>(path);
        if (alive) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, intervalMs]);

  return { data, error };
}