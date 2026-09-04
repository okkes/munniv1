import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useLang } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { useData } from '@/app/data';
import { adoptUserCategoriesOnShare } from '@/features/categories/categoryOps';
import { logActivity } from '@/application/activity';
import { apiFetch } from '@/lib/api';
import { useServerRefresh } from '@/lib/serverEvents';
import { Avatar } from '@/features/profile/ProfileScreen';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

export type SpaceRole = 'owner' | 'contributor' | 'reader';

interface InviteDto {
  id: string;
  spaceId: string;
  spaceName: string | null;
  fromUserId: string;
  fromName: string | null;
  role: string;
}
interface MemberDto {
  userId: string;
  displayName: string | null;
  role: SpaceRole;
  picture?: string | null;
}
interface FriendDto {
  userId: string;
  displayName: string | null;
  picture?: string | null;
}
interface OutgoingInviteDto {
  id: string;
  toUserId: string;
  toName: string | null;
  role: string;
}

const short = (id: string) => `${id.slice(0, 8)}…`;
const ROLES: SpaceRole[] = ['owner', 'contributor', 'reader'];
const roleKey = (role: string): TranslationKey => `space.role.${role}` as TranslationKey;

/**
 * The signed-in user's role in a space. Non-synced identities (demo,
 * offline) own everything they see; while the members call is in
 * flight — or offline — we optimistically assume owner, matching the
 * server's enforcement as the real gate.
 */
export function useMyRole(spaceId: string | undefined, syncing: boolean): SpaceRole {
  const [role, setRole] = useState<SpaceRole>('owner');
  useEffect(() => {
    setRole('owner');
    if (!syncing || !spaceId) return;
    void (async () => {
      const [membersRes, meRes] = await Promise.all([
        apiFetch(`/spaces/${spaceId}/members`).catch(() => null),
        apiFetch('/me').catch(() => null),
      ]);
      if (!membersRes?.ok || !meRes?.ok) return;
      const members = (await membersRes.json()) as MemberDto[];
      const me = ((await meRes.json()) as { userId: string }).userId;
      const mine = members.find((m) => m.userId === me)?.role;
      if (mine) setRole(mine);
    })();
  }, [spaceId, syncing]);
  return role;
}

/**
 * Self-removal from a shared space: the server drops the membership
 * FIRST (that instantly revokes read access to every financial account
 * attached through the space — feed access derives from membership),
 * then the local copy is purged and the active space moves on.
 */
export async function leaveSpace(
  ctx: {
    store: { allRows: (entity: 'space') => Promise<{ deleted: number; id: string }[]> };
    engine: { purgeSpace: (spaceId: string) => Promise<void> } | null;
    setActiveSpace: (spaceId: string) => Promise<void> | void;
    activeSpaceId: string;
  },
  spaceId: string,
): Promise<boolean> {
  const meRes = await apiFetch('/me').catch(() => null);
  if (!meRes?.ok) return false;
  const me = ((await meRes.json()) as { userId: string }).userId;
  const res = await apiFetch(`/spaces/${spaceId}/members/${me}`, { method: 'DELETE' }).catch(() => null);
  if (!res?.ok) return false;
  await ctx.engine?.purgeSpace(spaceId);
  if (ctx.activeSpaceId === spaceId) {
    const remaining = (await ctx.store.allRows('space')).find((s) => s.deleted === 0 && s.id !== spaceId);
    if (remaining) await ctx.setActiveSpace(remaining.id);
  }
  return true;
}

/** Pending space invites, shown at the top of the Spaces tab. */
export function SpaceInvitesBanner() {
  const { t } = useLang();
  const { engine } = useData();
  const [invites, setInvites] = useState<InviteDto[]>([]);

  const reload = useCallback(async () => {
    const res = await apiFetch('/me/invites').catch(() => null);
    if (res?.ok) setInvites((await res.json()) as InviteDto[]);
  }, []);
  useEffect(() => void reload(), [reload]);
  useServerRefresh(reload);

  const respond = async (invite: InviteDto, action: 'accept' | 'decline') => {
    await apiFetch(`/spaces/invites/${invite.id}/${action}`, { method: 'POST' });
    await reload();
    if (action === 'accept') await engine?.syncAll(); // pull the new space now
  };

  if (invites.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-2" data-testid="space-invites">
      {invites.map((invite) => (
        <div key={invite.id} className="flex items-center gap-3 rounded-card border border-accent bg-accent-soft px-4 py-3">
          <Icon name="email-outline" size={20} color="var(--m-accent-deep)" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-accent-deep">
              {invite.spaceName ?? invite.spaceId.slice(0, 12)}
            </span>
            <span className="block truncate text-[12px] text-ink-3">
              {t('space.invitedYou', { name: invite.fromName ?? short(invite.fromUserId) })} · {t(roleKey(invite.role))}
            </span>
          </span>
          <Button size="sm" data-testid={`space-invite-accept-${invite.id}`} onClick={() => void respond(invite, 'accept')}>
            {t('friends.accept')}
          </Button>
          <button
            aria-label={t('friends.decline')}
            onClick={() => void respond(invite, 'decline')}
            className="m-tap border-none bg-transparent text-ink-4"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

interface SpaceMembersSectionProps {
  spaceId: string;
  spaceName: string;
  /** reports the current user's role once members are loaded */
  onMyRole?: (role: SpaceRole) => void;
  /** called after this user left the space (sheet should close) */
  onLeft?: () => void;
}

/** Members, roles + invite-a-friend for the space settings sheet (user identities). */
export function SpaceMembersSection({ spaceId, spaceName, onMyRole, onLeft }: SpaceMembersSectionProps) {
  const { t } = useLang();
  const { store, repo, engine, setActiveSpace, spaceId: activeSpaceId } = useData();
  // the private lock (arc 4): a locked space renders the invite tools as
  // an explainer — unlocking is an explicit owner act in space settings
  const spaceRow = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const locked = spaceRow?.inviteLock === 1;
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingInviteDto[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [friendId, setFriendId] = useState('');
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
  // removing someone is disruptive (they lose the shared accounts too) —
  // the X only opens a confirm sheet, the sheet does the removal
  const [kickTarget, setKickTarget] = useState<MemberDto | null>(null);

  const reload = useCallback(async () => {
    const [membersRes, friendsRes, meRes, outgoingRes] = await Promise.all([
      apiFetch(`/spaces/${spaceId}/members`).catch(() => null),
      apiFetch('/friends').catch(() => null),
      apiFetch('/me').catch(() => null),
      apiFetch(`/spaces/${spaceId}/invites`).catch(() => null), // owner-only: 403 for others
    ]);
    if (membersRes?.ok) setMembers((await membersRes.json()) as MemberDto[]);
    if (friendsRes?.ok) setFriends(((await friendsRes.json()) as { friends: FriendDto[] }).friends);
    if (meRes?.ok) setMe(((await meRes.json()) as { userId: string }).userId);
    if (outgoingRes?.ok) setOutgoing((await outgoingRes.json()) as OutgoingInviteDto[]);
  }, [spaceId]);
  useEffect(() => void reload(), [reload]);
  // an accepted invite shows up while you're looking at the member list
  useServerRefresh(reload);

  const myRole = members?.find((m) => m.userId === me)?.role;
  useEffect(() => {
    if (myRole) onMyRole?.(myRole);
  }, [myRole, onMyRole]);

  if (members === null) return null; // not a member / offline — hide section
  const isOwner = myRole === 'owner';
  const memberIds = new Set(members.map((m) => m.userId));
  const pendingIds = new Set(outgoing.map((i) => i.toUserId));
  const invitable = friends.filter((f) => !memberIds.has(f.userId) && !pendingIds.has(f.userId));

  const invite = async (friend: FriendDto) => {
    const res = await apiFetch(`/spaces/${spaceId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ toUserId: friend.userId, role: 'contributor', spaceName }),
    }).catch(() => null);
    if (res?.ok) {
      setInviteSentTo(friend.displayName ?? short(friend.userId));
      void logActivity(store, repo, spaceId, 'memberInvite', friend.displayName ?? short(friend.userId));
    }
    // inviting someone makes this a shared space: its categories become
    // space-scoped and user-scoped categories stop leaking into it — so
    // the user-scoped ones its transactions already use are adopted
    // (copied in + references rewritten) BEFORE the flip
    const space = await store.get('space', spaceId);
    if (space && space.kind !== 'shared') {
      await adoptUserCategoriesOnShare(store, repo, spaceId);
      await repo.upsert('space', spaceId, spaceId, { kind: 'shared' });
      void logActivity(store, repo, spaceId, 'spaceShare', spaceName);
    }
    await reload();
  };
  const revokeInvite = async (inviteId: string) => {
    await apiFetch(`/spaces/invites/${inviteId}`, { method: 'DELETE' }).catch(() => null);
    setInviteSentTo(null);
    await reload();
  };
  const addFriend = async () => {
    const toUserId = friendId.trim();
    if (!toUserId) return;
    await apiFetch('/friends/requests', { method: 'POST', body: JSON.stringify({ toUserId }) }).catch(() => null);
    setFriendId('');
    setFriendRequestSent(true);
    // if they had already requested me, the server auto-accepts and the
    // reload makes them immediately invitable
    await reload();
  };
  const kick = async (userId: string) => {
    const name = members.find((m) => m.userId === userId)?.displayName ?? short(userId);
    await apiFetch(`/spaces/${spaceId}/members/${userId}`, { method: 'DELETE' });
    void logActivity(store, repo, spaceId, 'memberRemove', name);
    setKickTarget(null);
    await reload();
  };
  const changeRole = async (userId: string, role: SpaceRole) => {
    await apiFetch(`/spaces/${spaceId}/members/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
    void logActivity(store, repo, spaceId, 'memberRole', members.find((m) => m.userId === userId)?.displayName ?? short(userId));
    await reload();
  };
  const leave = async () => {
    if (await leaveSpace({ store, engine, setActiveSpace, activeSpaceId }, spaceId)) onLeft?.();
  };

  return (
    <div className="mt-2" data-testid="space-members">
      <div className="m-cap mb-1 px-1">{t('space.members')}</div>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
            <Avatar picture={m.picture} size={24} />
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
              {m.displayName ?? short(m.userId)}
            </span>
            {isOwner && m.userId !== me ? (
              // owners assign roles; picking "owner" transfers ownership
              <select
                data-testid={`space-role-${m.userId}`}
                value={m.role}
                onChange={(e) => void changeRole(m.userId, e.target.value as SpaceRole)}
                className="rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] text-ink-2"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(roleKey(role))}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] text-ink-4" data-testid={`space-rolelabel-${m.userId}`}>
                {t(roleKey(m.role))}
              </span>
            )}
            {isOwner && m.userId !== me && (
              <button
                aria-label={t('action.delete')}
                data-testid={`space-kick-${m.userId}`}
                onClick={() => setKickTarget(m)}
                className="m-tap border-none bg-transparent text-ink-4"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      {isOwner && outgoing.length > 0 && (
        <>
          <div className="m-cap mt-3 mb-1 px-1">{t('space.invitePendingTitle')}</div>
          <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="space-outgoing-invites">
            {outgoing.map((invitation) => (
              <div key={invitation.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
                <Icon name="clock-outline" size={18} color="var(--m-ink-4)" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">
                    {invitation.toName ?? short(invitation.toUserId)}
                  </span>
                  <span className="block truncate text-[12px] text-ink-4">{t('space.invitePending')}</span>
                </span>
                <button
                  aria-label={t('action.delete')}
                  data-testid={`space-invite-revoke-${invitation.id}`}
                  onClick={() => void revokeInvite(invitation.id)}
                  className="m-tap border-none bg-transparent text-ink-4"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {isOwner && locked && (
        <div className="mt-3 flex items-start gap-3 rounded-card border border-line bg-bg-2 px-4 py-3" data-testid="space-invite-locked">
          <Icon name="lock-outline" size={18} color="var(--m-ink-3)" />
          <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-3">
            {t('space.inviteLockedBody')}
          </span>
        </div>
      )}
      {isOwner && !locked && (
        <>
          <div className="m-cap mt-3 mb-1 px-1">{t('space.addMember')}</div>
          {inviteSentTo && (
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] text-accent-deep" data-testid="space-invite-sent">
              <Icon name="check-circle-outline" size={14} />
              {t('space.spaceInviteSent', { name: inviteSentTo })}
            </p>
          )}
          {invitable.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {invitable.map((f) => (
                <button
                  key={f.userId}
                  data-testid={`space-invite-${f.userId}`}
                  onClick={() => void invite(f)}
                  className="m-tap rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2"
                >
                  + {f.displayName ?? short(f.userId)}
                </button>
              ))}
            </div>
          )}
          {/* global friends stay the invite guard — but adding a new friend
              must not require leaving the invite flow (user decision) */}
          <div className="flex gap-2">
            <input
              data-testid="space-addfriend-input"
              value={friendId}
              onChange={(e) => setFriendId(e.target.value)}
              placeholder={t('friends.idPlaceholder')}
              className="h-10 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 font-mono text-[12px] text-ink outline-none placeholder:text-ink-4"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-10"
              data-testid="space-addfriend-send"
              onClick={() => void addFriend()}
              disabled={!friendId.trim()}
            >
              {t('friends.sendRequest')}
            </Button>
          </div>
          {friendRequestSent && (
            <p className="mt-1.5 px-1 text-[12px] text-ink-3" data-testid="space-addfriend-sent">
              {t('space.friendRequestSent')}
            </p>
          )}
        </>
      )}
      {members.length > 1 && (
        <div className="mt-4">
          {confirmLeave && <p className="mb-2 text-[13px] text-ink-3">{t('space.leaveConfirm')}</p>}
          <Button
            variant="outline"
            className="w-full"
            data-testid="space-leave"
            onClick={() => (confirmLeave ? void leave() : setConfirmLeave(true))}
          >
            {confirmLeave ? t('action.confirm') : t('space.leave')}
          </Button>
        </div>
      )}
      {/* removal double-check (user request): the X never removes directly */}
      <Sheet open={kickTarget !== null} onOpenChange={(next) => !next && setKickTarget(null)} title={t('space.kickTitle')} size="compact">
        <div className="flex flex-col gap-4 pt-1">
          <p className="text-[14px] text-ink-2" data-testid="space-kick-body">
            {t('space.kickBody', { name: kickTarget?.displayName ?? short(kickTarget?.userId ?? '') })}
          </p>
          <Button
            variant="danger"
            data-testid="space-kick-confirm"
            onClick={() => kickTarget && void kick(kickTarget.userId)}
          >
            {t('action.confirm')}
          </Button>
          <Button variant="outline" data-testid="space-kick-cancel" onClick={() => setKickTarget(null)}>
            {t('action.cancel')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
