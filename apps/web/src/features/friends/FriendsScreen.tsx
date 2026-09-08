import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/app/session';
import { useData } from '@/app/data';
import { useLang } from '@/i18n';
import { stampJoinedSharedSpace } from '@/application/spaces';
import { apiFetch } from '@/lib/api';
import { postFriendRequest } from './sendFriendRequest';
import { useServerRefresh } from '@/lib/serverEvents';
import { Avatar } from '@/features/profile/ProfileScreen';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { FriendProfileSheet } from './FriendProfileSheet';
import { takeFriendsAddIntent } from './friendsHandoff';

interface FriendDto {
  userId: string;
  displayName: string | null;
  picture?: string | null;
}
interface RequestDto {
  id: string;
  fromUserId: string;
  fromName: string | null;
  toUserId: string;
  toName: string | null;
  /** #169: set when accepting also joins the sender's space */
  spaceName?: string | null;
}
interface FriendsResponse {
  friends: FriendDto[];
  sentPending: RequestDto[];
  receivedPending: RequestDto[];
}

const short = (id: string) => `${id.slice(0, 8)}…`;

function PersonRow({
  name,
  sub,
  note,
  picture,
  onClick,
  testId,
  children,
}: {
  name: string;
  sub?: string;
  /** extra accent line (e.g. "accepting also joins {space}") */
  note?: string;
  picture?: string | null;
  onClick?: () => void;
  testId?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      {picture ? (
        <Avatar picture={picture} size={36} />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-deep">
          <Icon name="account-outline" size={19} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{name}</span>
        {sub && <span className="block truncate font-mono text-[11px] text-ink-4">{sub}</span>}
        {note && <span className="block truncate text-[11px] text-accent-deep">{note}</span>}
      </span>
      {children}
    </>
  );
  const rowCls = 'flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0';
  // rows with row-level controls (accept/decline) stay divs — nested
  // buttons are invalid; tappable rows carry no inner buttons
  if (onClick) {
    // no border-none here: the divider IS a border (preflight keeps the
    // button's own border at zero width anyway)
    return (
      <button data-testid={testId} onClick={onClick} className={`m-tap w-full bg-transparent text-left ${rowCls}`}>
        {body}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={rowCls}>
      {body}
    </div>
  );
}

/** Friends management (user identities only): the gateway to shared spaces. */
export function FriendsScreen() {
  const { t } = useLang();
  // friends are server-mediated: demo/offline identities must stay fully
  // local, so the screen shows a sign-in note and makes zero network calls
  const isUser = useSession((s) => s.identity?.kind === 'user');
  const { store, repo, engine } = useData();
  const [me, setMe] = useState<{ userId: string } | null>(null);
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [addId, setAddId] = useState('');
  const [copied, setCopied] = useState(false);
  // #195: Add stays enabled — an empty click says why instead
  const [attempted, setAttempted] = useState(false);
  // #291: the id pointed at nobody — a field-level error, not a log line
  const [notFound, setNotFound] = useState(false);
  // #165: tapping a friend opens their profile sheet
  const [profile, setProfile] = useState<FriendDto | null>(null);
  // removing a friend is destructive enough for a second look
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  // #180: arriving with an "add a friend" intent focuses the id input
  const addRef = useRef<HTMLInputElement>(null);
  const [focusAdd] = useState(() => takeFriendsAddIntent());
  useEffect(() => {
    if (focusAdd) addRef.current?.focus();
  }, [focusAdd]);

  const reload = useCallback(async () => {
    const res = await apiFetch('/friends');
    if (res.ok) setData((await res.json()) as FriendsResponse);
  }, []);

  useEffect(() => {
    if (!isUser) return;
    void apiFetch('/me').then(async (res) => res.ok && setMe(await res.json()));
    void reload();
  }, [reload, isUser]);
  // a request/accept push while the screen is open refreshes the lists
  // (identity-gated: local-only sessions must stay at zero network)
  const refresh = useCallback(() => {
    if (isUser) void reload();
  }, [isUser, reload]);
  useServerRefresh(refresh);

  const sendRequest = async () => {
    const id = addId.trim();
    if (!id) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    // #291: 404 = "no such user" — the field says so and keeps the typed
    // id for fixing; the input only clears when the request really went
    const outcome = await postFriendRequest({ toUserId: id });
    setNotFound(outcome === 'notFound');
    if (outcome === 'sent') setAddId('');
    await reload();
  };
  const accept = async (id: string) => {
    // #169: a space-carrying request makes us a MEMBER on accept — pull
    // the new space right away instead of waiting for the next cycle
    const request = data?.receivedPending.find((r) => r.id === id);
    // #277 r2: the accept answer names no space id — snapshot what we
    // already know, so whatever the sync delivers NEW gets stamped shared
    // (the sender owns the space, so their name backfills the creator line)
    const known = request?.spaceName ? new Set((await store.allRows('space')).map((s) => s.id)) : null;
    await apiFetch(`/friends/requests/${id}/accept`, { method: 'POST' });
    await reload();
    if (known && request?.spaceName) {
      await stampJoinedSharedSpace(
        store,
        repo,
        async () => {
          await engine?.syncAll().catch(() => undefined);
        },
        { except: known, name: request.spaceName },
        request.fromName ?? null,
      );
    }
  };
  const removeFriend = async (userId: string) => {
    await apiFetch(`/friends/${userId}`, { method: 'DELETE' });
    await reload();
  };

  const copyMyId = () => {
    if (!me) return;
    void navigator.clipboard?.writeText(me.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-friends">
      <AppBar
        title={t('settings.friends')}
        leading={
          <IconButton label={t('action.back')} testId="friends-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      {!isUser && (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-[14px] text-ink-3" data-testid="friends-requires-account">
          {t('friends.requiresAccount')}
        </div>
      )}
      {isUser && (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* my id */}
        <div className="mt-2 rounded-card border border-line bg-surface px-4 py-3">
          <div className="m-cap">{t('friends.myId')}</div>
          <button data-testid="friends-copy-id" onClick={copyMyId} className="m-tap mt-1 flex w-full items-center gap-2 border-none bg-transparent p-0 text-left">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2 select-text">{me?.userId ?? '…'}</span>
            <Icon name={copied ? 'check' : 'content-copy'} size={16} color={copied ? 'var(--m-accent)' : 'var(--m-ink-4)'} />
          </button>
        </div>

        {/* add by id */}
        <div className="m-cap mt-5 mb-1 px-1">{t('friends.addById')}</div>
        <FormBlockerNote show={attempted && !addId.trim()} text={t('form.needId')} testId="friends-add-blocker" className="mb-1 px-1" />
        {/* #291: the 404 answer lands AT the field, #195 style */}
        <FormBlockerNote show={notFound} text={t('friends.userNotFound')} testId="friends-add-notfound" className="mb-1 px-1" />
        <div className="flex gap-2">
          <input
            ref={addRef}
            data-testid="friends-add-input"
            value={addId}
            onChange={(e) => {
              setAddId(e.target.value);
              setNotFound(false);
            }}
            placeholder={t('friends.idPlaceholder')}
            aria-invalid={(attempted && !addId.trim()) || notFound}
            className={`h-11 min-w-0 flex-1 rounded-input border border-line bg-surface px-4 font-mono text-[13px] text-ink outline-none placeholder:text-ink-4${blockerRing((attempted && !addId.trim()) || notFound)}`}
          />
          <Button size="sm" className="h-11" data-testid="friends-add-send" onClick={() => void sendRequest()}>
            {t('action.add')}
          </Button>
        </div>

        {/* received */}
        {(data?.receivedPending.length ?? 0) > 0 && (
          <>
            <div className="m-cap mt-5 mb-1 px-1">{t('friends.pendingReceived')}</div>
            <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="friends-received">
              {data!.receivedPending.map((r) => (
                <PersonRow
                  key={r.id}
                  name={r.fromName ?? short(r.fromUserId)}
                  sub={short(r.fromUserId)}
                  // #169: the request rode in from a space — say what accepting means
                  note={r.spaceName ? t('invite.viaSpace', { space: r.spaceName }) : undefined}
                >
                  <Button size="sm" data-testid={`friends-accept-${r.id}`} onClick={() => void accept(r.id)}>
                    {t('friends.accept')}
                  </Button>
                  <button aria-label={t('friends.decline')} onClick={() => void removeFriend(r.fromUserId)} className="m-tap border-none bg-transparent text-ink-4">
                    <Icon name="close" size={18} />
                  </button>
                </PersonRow>
              ))}
            </div>
          </>
        )}

        {/* sent */}
        {(data?.sentPending.length ?? 0) > 0 && (
          <>
            <div className="m-cap mt-5 mb-1 px-1">{t('friends.pendingSent')}</div>
            <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="friends-sent">
              {data!.sentPending.map((r) => (
                <PersonRow key={r.id} name={r.toName ?? short(r.toUserId)} sub={short(r.toUserId)}>
                  <Icon name="clock-outline" size={16} color="var(--m-ink-4)" />
                </PersonRow>
              ))}
            </div>
          </>
        )}

        {/* friends — the row opens the profile sheet (#165); removal
            lives there now, not on the list */}
        <div className="m-cap mt-5 mb-1 px-1">{t('settings.friends')}</div>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="friends-list">
          {(data?.friends ?? []).map((f) => (
            <PersonRow
              key={f.userId}
              testId={`friends-row-${f.userId}`}
              name={f.displayName ?? short(f.userId)}
              sub={short(f.userId)}
              picture={f.picture}
              onClick={() => setProfile(f)}
            >
              <Icon name="chevron-right" size={17} color="var(--m-ink-4)" />
            </PersonRow>
          ))}
          {data?.friends.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-ink-3">{t('friends.empty')}</div>
          )}
        </div>
      </div>
      )}

      {/* #165: the tapped friend, up close — remove routes to the same
          confirm the list's trash button used to open */}
      <FriendProfileSheet
        friend={profile}
        onOpenChange={(open) => !open && setProfile(null)}
        onRemove={(f) => setConfirmRemove({ userId: f.userId, name: f.displayName ?? short(f.userId) })}
      />

      {/* deleting a friend needs a second, explicit yes */}
      <Sheet
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
        title={t('friends.removeTitle')}
        size="compact"
      >
        <p className="pt-1 pb-4 text-[14px] leading-relaxed text-ink-2" data-testid="friends-remove-text">
          {t('friends.removeText', { name: confirmRemove?.name ?? '' })}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" data-testid="friends-remove-cancel" onClick={() => setConfirmRemove(null)}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            data-testid="friends-remove-confirm"
            onClick={() => {
              if (confirmRemove) void removeFriend(confirmRemove.userId);
              setConfirmRemove(null);
              setProfile(null); // the removed friend's profile closes too
            }}
          >
            {t('action.delete')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
