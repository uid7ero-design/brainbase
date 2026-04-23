'use client';
import { useState, useEffect, useCallback } from 'react';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export function useNews() {
  const [articles,   setArticles]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [fetchedAt,  setFetchedAt]  = useState(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/news');
      const data = await res.json();
      setArticles(data.articles ?? []);
      setFetchedAt(data.fetchedAt ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetch_]);

  return { articles, loading, error, fetchedAt, refresh: fetch_ };
}
