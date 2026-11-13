import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Champion, Me, Meta } from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me"), staleTime: 60_000 });

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta"), staleTime: Infinity });

export function useChampions() {
  const q = useQuery({
    queryKey: ["champions"],
    queryFn: () => api.get<{ version: string | null; champions: Champion[] }>("/api/meta/champions"),
    staleTime: Infinity,
  });
  const byKey = useMemo(() => new Map((q.data?.champions ?? []).map((c) => [c.key, c])), [q.data]);
  return { champions: q.data?.champions ?? [], version: q.data?.version ?? null, byKey, isLoading: q.isLoading };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · EloHeaven` : "EloHeaven";
  }, [title]);
}
