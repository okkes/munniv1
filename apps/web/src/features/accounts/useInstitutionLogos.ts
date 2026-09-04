import { useEffect, useState } from 'react';
import { readSessionIdentity } from '@/app/session';
import { apiFetch, getApiCapabilities } from '@/lib/api';

/**
 * institutionId → logo URL, for showing the real bank mark on account
 * rows. One fetch per page load (module cache); local-only identities
 * and offline sessions simply keep the generic icon.
 */
let cache: Map<string, string> | null = null;
let pending: Promise<Map<string, string>> | null = null;

async function load(): Promise<Map<string, string>> {
  if (cache) return cache;
  pending ??= (async () => {
    const map = new Map<string, string>();
    try {
      if (readSessionIdentity()?.kind !== 'user' || !(await getApiCapabilities()).gocardless) return map;
      const res = await apiFetch('/gocardless/institutions?country=nl');
      if (!res.ok) return map;
      const list = (await res.json()) as { id: string; logo?: string }[];
      for (const inst of list) if (inst.logo) map.set(inst.id, inst.logo);
      cache = map;
    } catch {
      // offline / rate-limited — the generic icon is the fallback anyway
    }
    return map;
  })();
  return pending;
}

/** test seam */
export function resetInstitutionLogoCache(): void {
  cache = null;
  pending = null;
}

export function useInstitutionLogos(): Map<string, string> {
  const [logos, setLogos] = useState<Map<string, string>>(() => cache ?? new Map());
  useEffect(() => {
    let alive = true;
    void load().then((map) => alive && setLogos(map));
    return () => {
      alive = false;
    };
  }, []);
  return logos;
}
