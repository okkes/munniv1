import { reportError } from '@/lib/report';
import { useEffect, useRef, useState } from 'react';
import { useLogto } from '@logto/react';
import { useLang } from '@/i18n';
import { config, logtoConfigured, publicOrigin } from '@/app/config';
import { getAccessToken as getBridgeToken } from '@/app/authToken';
import { isNativeApp } from '@/lib/platform';
import { useData } from '@/app/data';
import { apiFetch } from '@/lib/api';
import { Highlight } from '@/ui/Highlight';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';

interface Institution {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
}

/** #175: one configured bank-data provider, as the server reports it
 *  (server order — GoCardless first as the default) */
interface ProviderOption {
  id: string;
  /** masked IBAN tails known to work through Enable Banking */
  knownAccounts?: string[] | null;
}

/** brand names, not translations */
const PROVIDER_NAMES: Record<string, string> = { gocardless: 'GoCardless', enablebanking: 'Enable Banking' };
const PROVIDER_SUB_KEYS: Record<string, 'gc.providerGcSub' | 'gc.providerEbSub'> = {
  gocardless: 'gc.providerGcSub',
  enablebanking: 'gc.providerEbSub',
};

/**
 * Open-banking connect: with several providers configured the user picks
 * WHO connects first (#175: Enable Banking's restricted mode only serves
 * accounts linked upfront on its portal — GoCardless takes any bank),
 * then an institution, gets sent to the bank for read-only access and
 * returns via /gc-callback. Only offered for syncing (user) identities
 * when the server has a bank provider enabled.
 */
/** "title: detail" from an RFC7807 Problem body, else the bare status */
async function problemLine(res: Response): Promise<string> {
  const problem = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
  const line = [problem?.title, problem?.detail].filter(Boolean).join(': ');
  return line || String(res.status);
}

export function BankConnectSheet({ open, onOpenChange }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { t } = useLang();
  const { spaceId } = useData();
  // #175: '' = no explicit pick (single provider / older server) — the
  // server's default provider (GoCardless when configured) serves
  const [providers, setProviders] = useState<ProviderOption[] | null>(null);
  const [chosenProvider, setChosenProvider] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<Institution[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // the server's Problem body names WHICH provider refused and why —
  // without it every failure read as the same dead end (user report)
  const [failDetail, setFailDetail] = useState<string | null>(null);

  const [rateLimited, setRateLimited] = useState(false);

  useEffect(() => {
    if (!open || providers) return;
    void (async () => {
      try {
        const res = await apiFetch('/gocardless/providers');
        if (!res.ok) throw new Error(String(res.status));
        const list = ((await res.json()) as { providers?: ProviderOption[] }).providers ?? [];
        setProviders(list);
        if (list.length <= 1) setChosenProvider(list[0]?.id ?? '');
      } catch {
        // an older server without the endpoint: the active provider serves
        setProviders([]);
        setChosenProvider('');
      }
    })();
  }, [open, providers]);

  useEffect(() => {
    if (!open || chosenProvider === null || institutions) return;
    void (async () => {
      try {
        const provider = chosenProvider ? `&provider=${encodeURIComponent(chosenProvider)}` : '';
        const res = await apiFetch(`/gocardless/institutions?country=nl${provider}`);
        if (res.status === 429 || res.status === 503) {
          // GoCardless quota spent — a distinct message beats a generic
          // failure ("try later" is genuinely the right advice here)
          setRateLimited(true);
          return;
        }
        if (!res.ok) throw new Error(await problemLine(res));
        setInstitutions((await res.json()) as Institution[]);
      } catch (err) {
        reportError('openbanking', err);
        setFailDetail(err instanceof Error && err.message ? err.message : null);
        setFailed(true);
      }
    })();
  }, [open, chosenProvider, institutions]);

  const connect = async (institutionId: string) => {
    setBusy(true);
    try {
      const res = await apiFetch('/gocardless/requisitions', {
        method: 'POST',
        body: JSON.stringify({
          spaceId,
          institutionId,
          // hosted origin, not window origin: inside the native shell the
          // window is localhost; the hosted page completes anonymously via
          // the reference capability token either way
          redirectUrl: publicOrigin() + '/gc-callback',
          // native journeys record their deep-link scheme SERVER-SIDE on
          // the requisition (a path marker broke the relative-base asset
          // urls; a query marker collides with the provider's ?ref=) —
          // the hosted page reads it from the complete response
          appScheme: isNativeApp() ? config.nativeScheme : null,
          // #175: the user's explicit provider pick rides along
          ...(chosenProvider ? { provider: chosenProvider } : {}),
        }),
      });
      if (!res.ok) throw new Error(await problemLine(res));
      const { reference, link } = (await res.json()) as { reference: string; link: string };
      sessionStorage.setItem('munni_gc_ref', reference);
      window.location.href = link; // off to the bank
    } catch (err) {
      reportError('openbanking', err);
      setFailDetail(err instanceof Error && err.message ? err.message : null);
      setFailed(true);
      setBusy(false);
    }
  };

  const filtered = (institutions ?? []).filter(
    (i) => !query || i.name.toLowerCase().includes(query.toLowerCase()) || i.bic?.toLowerCase().includes(query.toLowerCase()),
  );
  const needsChoice = (providers?.length ?? 0) > 1 && chosenProvider === null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('gc.connect')} size="tall">
      <p className="pb-2 text-[12px] text-ink-3">{t('gc.connectSub')}</p>
      {/* #175: WHO connects — only when there is a real choice */}
      {needsChoice && (
        <div className="flex flex-col gap-2" data-testid="gc-provider-choice">
          <div className="m-cap px-1">{t('gc.providerPick')}</div>
          {providers!.map((provider) => (
            <button
              key={provider.id}
              data-testid={`gc-provider-${provider.id}`}
              onClick={() => setChosenProvider(provider.id)}
              className="m-tap flex w-full items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
            >
              <Icon name={provider.id === 'enablebanking' ? 'bank-check' : 'bank-outline'} size={20} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">
                  {PROVIDER_NAMES[provider.id] ?? provider.id}
                </span>
                {PROVIDER_SUB_KEYS[provider.id] && (
                  <span className="block text-[12px] leading-snug text-ink-3">{t(PROVIDER_SUB_KEYS[provider.id])}</span>
                )}
                {provider.id === 'enablebanking' && !!provider.knownAccounts?.length && (
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="gc-provider-eb-known">
                    <span className="text-[11px] text-ink-4">{t('gc.providerEbKnown')}</span>
                    {provider.knownAccounts.map((tail) => (
                      <span key={tail} className="rounded bg-bg-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                        •••• {tail}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
            </button>
          ))}
        </div>
      )}
      {!needsChoice && (providers?.length ?? 0) > 1 && chosenProvider !== null && (
        <button
          data-testid="gc-provider-back"
          onClick={() => {
            setChosenProvider(null);
            setInstitutions(null);
            setQuery('');
          }}
          className="m-tap mb-2 flex items-center gap-1 border-none bg-transparent px-1 py-1 text-[12px] font-medium text-accent-deep"
        >
          <Icon name="chevron-left" size={14} />
          {PROVIDER_NAMES[chosenProvider] ?? chosenProvider}
        </button>
      )}
      {failed && (
        <div className="mb-2 rounded-card bg-negative-soft px-4 py-3 text-[13px] text-negative" data-testid="gc-error">
          <span className="flex items-center gap-2">
            <Icon name="alert-circle-outline" size={16} />
            {t('gc.failed')}
          </span>
          {failDetail && (
            <span className="mt-1 block font-mono text-[11px] text-negative/80" data-testid="gc-connect-error-detail">
              {failDetail}
            </span>
          )}
        </div>
      )}
      {rateLimited && (
        <div className="mb-2 flex items-center gap-2 rounded-card bg-warning-soft px-4 py-3 text-[13px] text-ink-2" data-testid="gc-rate-limited">
          <Icon name="clock-alert-outline" size={16} color="var(--m-warning)" />
          {t('gc.rateLimited')}
        </div>
      )}
      {!needsChoice && (
        <SearchField
          testId="gc-bank-search"
          value={query}
          onChange={setQuery}
          placeholder={t('acct.bankSearch')}
          className="mb-2"
        />
      )}
      {!needsChoice && !institutions && !failed && <div className="py-6 text-center text-sm text-ink-3">…</div>}
      {!needsChoice && filtered.map((institution) => (
        <button
          key={institution.id}
          data-testid={`gc-bank-${institution.id}`}
          disabled={busy}
          onClick={() => void connect(institution.id)}
          className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-1 py-2.5 text-left"
        >
          {institution.logo ? (
            <img
              // relative path = the server's vendored copy (no CDN hotlink)
              src={institution.logo.startsWith('http') ? institution.logo : config.apiUrl + institution.logo}
              alt=""
              className="h-8 w-8 rounded-lg object-contain"
              loading="lazy"
              // a blocked/expired CDN image must not leave an empty square
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <span className={institution.logo ? 'hidden' : ''}>
            <Icon name="bank-outline" size={22} color="var(--m-ink-3)" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">
              <Highlight text={institution.name} query={query} />
            </span>
            {institution.bic && (
              <span className="block font-mono text-[11px] text-ink-4">
                <Highlight text={institution.bic} query={query} />
              </span>
            )}
          </span>
          <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
        </button>
      ))}
    </Sheet>
  );
}

/**
 * rendered at /gc-callback (outside the hash router) after the bank
 * redirect. With Logto configured we must wait for the SDK to restore the
 * session before calling the API — firing immediately loses the race and
 * 401s.
 */
export function GcCallbackScreen() {
  return logtoConfigured ? <GcCallbackWithLogto /> : <GcCallbackInner bearer={null} />;
}

// symbol sentinel: 'pending' as a literal would widen into the string union
const PENDING = Symbol('pending');

function GcCallbackWithLogto() {
  const { isLoading, isAuthenticated } = useLogto();
  const [bearer, setBearer] = useState<string | null | typeof PENDING>(PENDING);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setBearer(null); // no session — inner screen will fail gracefully
      return;
    }
    // via the single-flight bridge: a parallel SDK call here could race the
    // sync engine's refresh and burn the rotated refresh token
    void getBridgeToken().then((token) => setBearer(token ?? null));
  }, [isLoading, isAuthenticated]);

  if (bearer === PENDING) return <GcCallbackShell state="working" />;
  return <GcCallbackInner bearer={bearer} />;
}

function GcCallbackInner({ bearer }: Readonly<{ bearer: string | null }>) {
  const [state, setState] = useState<'working' | 'done' | 'failed' | 'cancelled'>('working');
  const [detail, setDetail] = useState<string | null>(null);
  const [appScheme, setAppScheme] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-mount guard
    started.current = true;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('done') === '1') {
        // the hosted page already completed the requisition — this is
        // the deep-linked return into the shell
        sessionStorage.removeItem('munni_gc_ref');
        setState('done');
        return;
      }
      // Enable Banking puts the reference in `state` and adds a `code`;
      // GoCardless echoes `ref` and needs no code
      // the BANK said no — the user cancelled or the consent was refused
      // upstream (GlitchTip 81: completing anyway 404'd and captured a
      // non-error). No completion call, no capture, a calm way back.
      if (params.get('error')) {
        sessionStorage.removeItem('munni_gc_ref');
        setState('cancelled');
        return;
      }
      const reference = params.get('ref') ?? params.get('state') ?? sessionStorage.getItem('munni_gc_ref');
      const code = params.get('code');
      if (!reference) {
        setState('failed');
        return;
      }
      try {
        const headers: Record<string, string> = {};
        if (bearer) headers.Authorization = `Bearer ${bearer}`;
        const query = code ? `?code=${encodeURIComponent(code)}` : '';
        const res = await apiFetch(`/gocardless/requisitions/${reference}/complete${query}`, { method: 'POST', headers });
        if (!res.ok) throw new Error(await problemLine(res));
        const payload = (await res.json().catch(() => null)) as { appScheme?: string | null } | null;
        if (payload?.appScheme) setAppScheme(payload.appScheme);
        sessionStorage.removeItem('munni_gc_ref');
        setState('done');
      } catch (err) {
        reportError('openbanking', err);
        // the server names WHICH provider refused and why (self-diagnosing)
        setDetail(err instanceof Error && err.message ? err.message : null);
        setState('failed');
      }
    })();
  }, [bearer]);

  return <GcCallbackShell state={state} appScheme={appScheme} detail={detail} />;
}

const SHELL_ICONS = { working: 'bank-outline', done: 'check-circle-outline', failed: 'alert-circle-outline', cancelled: 'close-circle-outline' } as const;
const SHELL_TEXT_KEYS = { working: 'gc.completing', done: 'gc.done', failed: 'gc.failed', cancelled: 'gc.cancelled' } as const;

function GcCallbackShell({
  state,
  appScheme,
  detail,
}: Readonly<{ state: 'working' | 'done' | 'failed' | 'cancelled'; appScheme?: string | null; detail?: string | null }>) {
  const { t } = useLang();

  // consent started in the native app: the moment the hosted page is
  // done, hand the user straight back (user report: they were stranded
  // in the browser). The button below stays as the manual fallback.
  useEffect(() => {
    if (state !== 'done' || !appScheme) return;
    const timer = setTimeout(() => {
      window.location.href = appScheme + '://gc-callback?done=1';
    }, 800);
    return () => clearTimeout(timer);
  }, [state, appScheme]);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center" data-testid="screen-gc-callback">
      <Icon
        name={SHELL_ICONS[state]}
        size={44}
        color={state === 'failed' ? 'var(--m-negative)' : 'var(--m-accent)'}
      />
      <div className="m-h3 text-ink">{t(SHELL_TEXT_KEYS[state])}</div>
      {state === 'failed' && detail && (
        <p className="max-w-[300px] font-mono text-[11px] text-ink-4" data-testid="gc-complete-error-detail">
          {detail}
        </p>
      )}
      {state === 'done' && (
        // #319 (user): ONE next-step line — the headline already says it
        // connected, and "transactions arrive by themselves" covers the
        // old close-this-tab paragraph; the #204 r2 fact stays: nothing
        // attached itself, the accounts screen is where that happens
        <p className="max-w-[280px] text-[13px] leading-relaxed text-ink-3" data-testid="gc-unattached-note">
          {t('gc.doneNext')}
        </p>
      )}
      {state !== 'working' && (
        <a
          href={appScheme ? appScheme + '://gc-callback?done=1' : `${window.location.origin}/#/accounts`}
          className="m-tap rounded-btn bg-brand px-5 py-3 text-[14px] font-semibold text-on-brand no-underline"
        >
          {t('gc.backToApp')}
        </a>
      )}
    </div>
  );
}
