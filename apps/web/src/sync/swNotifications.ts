/**
 * Push-notification decisions for the service worker, extracted so the
 * logic is unit-testable (sw.ts itself only runs in a real worker). The
 * app language is mirrored into a tiny IDB store because push workers
 * boot cold — module state would be lost.
 */

export interface PushPayload {
  type?: string;
  spaceId?: string;
  count?: number;
  fromName?: string;
  spaceName?: string;
  role?: string;
}

interface PushTexts {
  title: string;
  one: string;
  many: string;
  friendRequest: string;
  friendAccept: string;
  spaceInvite: string;
  spaceJoin: string;
  memberRemoved: string;
  memberRole: string;
  roles: Record<string, string>;
  someone: string;
  aSpace: string;
}

const TEXTS: Record<string, PushTexts> = {
  en: {
    title: 'munni',
    one: '1 new transaction arrived',
    many: '{n} new transactions arrived',
    friendRequest: '{name} sent you a friend request',
    friendAccept: '{name} accepted your friend request',
    spaceInvite: '{name} invited you to "{space}"',
    spaceJoin: '{name} joined "{space}"',
    memberRemoved: 'You were removed from "{space}" by {name}',
    memberRole: 'Your role in "{space}" is now {role}',
    roles: { owner: 'owner', contributor: 'contributor', reader: 'reader' },
    someone: 'Someone',
    aSpace: 'a space',
  },
  nl: {
    title: 'munni',
    one: '1 nieuwe transactie ontvangen',
    many: '{n} nieuwe transacties ontvangen',
    friendRequest: '{name} heeft je een vriendschapsverzoek gestuurd',
    friendAccept: '{name} heeft je vriendschapsverzoek geaccepteerd',
    spaceInvite: '{name} heeft je uitgenodigd voor "{space}"',
    spaceJoin: '{name} doet nu mee in "{space}"',
    memberRemoved: '{name} heeft je verwijderd uit "{space}"',
    memberRole: 'Je rol in "{space}" is nu {role}',
    roles: { owner: 'eigenaar', contributor: 'bijdrager', reader: 'lezer' },
    someone: 'Iemand',
    aSpace: 'een ruimte',
  },
  tr: {
    title: 'munni',
    one: '1 yeni işlem geldi',
    many: '{n} yeni işlem geldi',
    friendRequest: '{name} sana arkadaşlık isteği gönderdi',
    friendAccept: '{name} arkadaşlık isteğini kabul etti',
    spaceInvite: '{name} seni "{space}" alanına davet etti',
    spaceJoin: '{name} "{space}" alanına katıldı',
    memberRemoved: '{name} seni "{space}" alanından çıkardı',
    memberRole: '"{space}" alanındaki rolün artık {role}',
    roles: { owner: 'sahip', contributor: 'katkıda bulunan', reader: 'okuyucu' },
    someone: 'Birisi',
    aSpace: 'bir alan',
  },
};

export interface WorkerNotification {
  title: string;
  body: string;
  /** coalescing tag */
  tag: string;
  /** click-through target (hash route) */
  url: string;
  /** new-transactions pushes also pre-sync the announced space */
  pullSpaceId?: string;
  pull: boolean;
}

function socialBody(payload: PushPayload, texts: PushTexts): { body: string; url: string; tag: string } | null {
  const name = payload.fromName ?? texts.someone;
  const space = payload.spaceName ?? texts.aSpace;
  switch (payload.type) {
    case 'friend-request':
      return { body: texts.friendRequest.replace('{name}', name), url: './#/friends', tag: 'friend-request' };
    case 'friend-accept':
      return { body: texts.friendAccept.replace('{name}', name), url: './#/friends', tag: 'friend-accept' };
    case 'space-invite':
      return { body: texts.spaceInvite.replace('{name}', name).replace('{space}', space), url: './#/spaces', tag: 'space-invite' };
    case 'space-join':
      return { body: texts.spaceJoin.replace('{name}', name).replace('{space}', space), url: './#/spaces', tag: 'space-join' };
    // #172/#173: membership changes reach the AFFECTED member's devices
    case 'member-removed':
      return { body: texts.memberRemoved.replace('{name}', name).replace('{space}', space), url: './#/spaces', tag: 'member-removed' };
    case 'member-role': {
      const role = texts.roles[payload.role ?? ''] ?? payload.role ?? '';
      return { body: texts.memberRole.replace('{space}', space).replace('{role}', role), url: './#/spaces', tag: 'member-role' };
    }
    default:
      return null;
  }
}

/** what (if anything) to show for a push payload, localized */
export function buildNotification(payload: PushPayload, lang: string): WorkerNotification | null {
  const texts = TEXTS[lang] ?? TEXTS.en;
  if (payload.type === 'new-transactions') {
    const count = payload.count ?? 1;
    return {
      title: texts.title,
      body: count === 1 ? texts.one : texts.many.replace('{n}', String(count)),
      tag: `new-tx-${payload.spaceId ?? 'all'}`, // coalesce per space
      // #132 (user request): the tap lands IN the announced space's
      // review — the space rides the hash query for cold starts
      url: payload.spaceId ? `./#/review?space=${payload.spaceId}` : './#/review',
      pullSpaceId: payload.spaceId,
      pull: true,
    };
  }
  const social = socialBody(payload, texts);
  return social ? { title: texts.title, ...social, pull: false } : null;
}

/** the app language mirrored into the worker's kv store ('en' fallback) */
export function readWorkerLang(): Promise<string> {
  return new Promise((resolve) => {
    const open = indexedDB.open('munni_sw', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => resolve('en');
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('kv', 'readonly').objectStore('kv').get('lang');
        get.onsuccess = () => resolve(typeof get.result === 'string' ? get.result : 'en');
        get.onerror = () => resolve('en');
      } catch {
        resolve('en');
      }
    };
  });
}
