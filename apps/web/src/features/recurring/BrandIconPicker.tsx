import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '@/i18n';
import { readSessionIdentity } from '@/app/session';
import { apiFetch, getApiCapabilities } from '@/lib/api';
import { downscaleImage } from '@/lib/image';
import { Highlight } from '@/ui/Highlight';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

/**
 * Brand logo picker for recurring costs, accounts, … Two labelled
 * segments: the vendored simpleicons set leads (public/brands —
 * precached, instant, works fully offline and for demo/offline
 * identities) and, when the server has logo.dev configured and the
 * identity may use the network, an online section follows with far
 * wider coverage. Local hits never disappear when the online answer
 * lands (user bug: they used to be deduped away).
 */

interface BrandEntry {
  slug: string;
  title: string;
}

interface RemoteLogo {
  name: string;
  domain: string;
  logoUrl: string;
}

export interface PickedLogo {
  /** '/brands/{slug}.svg' or a logo.dev image URL; null = default icon */
  logo: string | null;
}

let brandIndexCache: BrandEntry[] | null = null;
async function loadBrandIndex(): Promise<BrandEntry[]> {
  if (brandIndexCache) return brandIndexCache;
  try {
    const res = await fetch('brands/index.json');
    brandIndexCache = res.ok ? ((await res.json()) as BrandEntry[]) : [];
  } catch {
    brandIndexCache = [];
  }
  return brandIndexCache;
}

/** logo.dev search via the API proxy; null when unavailable (offline/unconfigured) */
async function searchRemoteLogos(q: string): Promise<RemoteLogo[] | null> {
  if (!(await getApiCapabilities()).logos) return null;
  const res = await apiFetch(`/logos/search?q=${encodeURIComponent(q)}`).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as RemoteLogo[];
}

interface BrandIconPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (picked: PickedLogo) => void;
  /** prefill (e.g. the cost's name); the first tap on the field clears it */
  initialQuery?: string;
}

export function BrandIconPicker({ open, onOpenChange, onPick, initialQuery = '' }: Readonly<BrandIconPickerProps>) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const prefilled = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  // search starts from the name the user already typed — usually exactly
  // the brand they want; one tap on the field starts a fresh query
  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery.trim());
    prefilled.current = initialQuery.trim().length > 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSearchFocus = () => {
    if (!prefilled.current) return;
    prefilled.current = false;
    setQuery('');
  };
  const [index, setIndex] = useState<BrandEntry[]>([]);
  const [remote, setRemote] = useState<RemoteLogo[]>([]);
  // 'unavailable' = offline or server not configured — say so instead of
  // silently showing only the vendored set (looked like a broken search)
  const [remoteState, setRemoteState] = useState<'idle' | 'searching' | 'ok' | 'unavailable'>('idle');
  const searchSeq = useRef(0);

  useEffect(() => {
    if (open) void loadBrandIndex().then(setIndex);
  }, [open]);

  // live logo.dev search, debounced — the primary source when it answers.
  // Local-only identities skip it entirely (their choice, not an outage,
  // so no 'unavailable' note either).
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2 || readSessionIdentity()?.kind !== 'user') {
      setRemote([]);
      setRemoteState('idle');
      return;
    }
    const seq = ++searchSeq.current;
    setRemoteState('searching');
    const timer = setTimeout(() => {
      void searchRemoteLogos(q).then((results) => {
        if (seq !== searchSeq.current) return;
        setRemote(results ?? []);
        setRemoteState(results === null ? 'unavailable' : 'ok');
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [open, query]);

  const remoteShown = remote.slice(0, 12);

  const localShown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? index.filter((b) => b.title.toLowerCase().includes(q) || b.slug.includes(q)) : index;
    return hits.slice(0, 24);
  }, [index, query]);

  const pick = (logo: string | null) => {
    onPick({ logo });
    setQuery('');
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('recurring.iconTitle')} size="tall" dragHandle>
      <div className="flex flex-col gap-3 pt-1">
        {/* the field arrives prefilled with the cost's name — the search
            glyph and the ✕ make it read as an editable search box */}
        <div className="relative">
          <span className="pointer-events-none absolute top-0 left-3 flex h-11 items-center">
            <Icon name="magnify" size={17} color="var(--m-ink-4)" />
          </span>
          <input
            data-testid="brandpicker-search"
            value={query}
            onFocus={onSearchFocus}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('recurring.iconSearch')}
            className="h-11 w-full rounded-input border border-line bg-surface pr-10 pl-10 text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          {query.length > 0 && (
            <button
              aria-label={t('action.dismiss')}
              data-testid="brandpicker-clear"
              onClick={() => {
                prefilled.current = false;
                setQuery('');
              }}
              className="m-tap absolute top-0 right-1 flex h-11 w-9 items-center justify-center border-none bg-transparent"
            >
              <Icon name="close-circle" size={16} color="var(--m-ink-4)" />
            </button>
          )}
        </div>
        <button
          data-testid="brandpicker-none"
          onClick={() => pick(null)}
          className="m-tap flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-2.5 text-left text-[13px] text-ink-2"
        >
          <Icon name="autorenew" size={18} color="var(--m-ink-3)" />
          {t('recurring.iconNone')}
        </button>
        {/* own image (user request 2026-08-01): third source beside the
            vendored set and logo.dev — downscaled like event pictures so
            it syncs as a field */}
        <button
          data-testid="brandpicker-upload"
          onClick={() => uploadRef.current?.click()}
          className="m-tap flex items-center gap-3 rounded-card border border-dashed border-line bg-surface px-4 py-2.5 text-left text-[13px] text-ink-2"
        >
          <Icon name="image-plus-outline" size={18} color="var(--m-accent)" />
          {t('recurring.iconUpload')}
        </button>
        <input
          ref={uploadRef}
          data-testid="brandpicker-upload-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            // undecodable files (HEIC on desktop…) reject — swallow like
            // the sibling upload sites; the picker simply stays open
            void downscaleImage(file, 256, 0.85)
              .then((dataUrl) => pick(dataUrl))
              .catch(() => undefined);
          }}
        />

        {remoteState === 'unavailable' && (
          <p className="px-1 text-[12px] text-ink-3" data-testid="brandpicker-offline-note">
            {t('recurring.iconOfflineNote')}
          </p>
        )}

        {/* the vendored set leads and never disappears; captions only when
            both segments are on screen, so the plain browse view stays calm */}
        {remoteShown.length > 0 && localShown.length > 0 && (
          <div className="m-cap px-1">{t('recurring.iconBuiltin')}</div>
        )}
        <div className="grid grid-cols-4 gap-2" data-testid="brandpicker-local">
          {localShown.map((brand) => (
            <button
              key={brand.slug}
              data-testid={`brandpicker-${brand.slug}`}
              title={brand.title}
              onClick={() => pick(`brands/${brand.slug}.svg`)}
              className="m-tap flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface px-1 py-2.5"
            >
              <img src={`brands/${brand.slug}.svg`} alt="" className="h-7 w-7 object-contain" loading="lazy" />
              <span className="w-full truncate text-center text-[10px] text-ink-3">
                <Highlight text={brand.title} query={query} />
              </span>
            </button>
          ))}
        </div>

        {remoteShown.length > 0 && (
          <>
            <div className="m-cap px-1">{t('recurring.iconOnline')}</div>
            <div className="grid grid-cols-4 gap-2" data-testid="brandpicker-remote">
              {remoteShown.map((r) => (
                <button
                  key={r.domain}
                  data-testid={`brandpicker-remote-${r.domain}`}
                  title={r.name}
                  onClick={() => pick(r.logoUrl)}
                  className="m-tap flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface px-1 py-2.5"
                >
                  <img src={r.logoUrl} alt="" className="h-7 w-7 rounded object-contain" loading="lazy" />
                  <span className="w-full truncate text-center text-[10px] text-ink-3">
                    <Highlight text={r.name} query={query} />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
