import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  AccountLinkRow,
  AccountRow,
  AllocationRow,
  BudgetRow,
  CategoryRow,
  DebtRow,
  EntityName,
  EventRow,
  HoldingRow,
  InsightDismissRow,
  TopicRow,
  ActivityRow,
  LotRow,
  QuoteCacheRow,
  ReceiptLinkRow,
  ReceiptRow,
  StoreConnectionRow,
  StoreConnLinkRow,
  StoreConnRow,
  StoreMarkerRow,
  GoalContributionRow,
  GoalRow,
  MetaRow,
  OutboxRow,
  RecurringDismissRow,
  RecurringRow,
  SpaceRow,
  TransactionRow,
  TxMetaRow,
} from './types';

/**
 * One Dexie database per identity (demo / offline profile / logged-in user),
 * so demo resets and logouts are a whole-database delete, and identities can
 * never bleed into each other.
 */
export class MunniDB extends Dexie {
  spaces!: Table<SpaceRow, string>;
  accounts!: Table<AccountRow, string>;
  categories!: Table<CategoryRow, string>;
  transactions!: Table<TransactionRow, string>;
  txMeta!: Table<TxMetaRow, string>;
  accountLinks!: Table<AccountLinkRow, string>;
  recurrings!: Table<RecurringRow, string>;
  recurringDismissals!: Table<RecurringDismissRow, string>;
  budgets!: Table<BudgetRow, string>;
  events!: Table<EventRow, string>;
  goals!: Table<GoalRow, string>;
  goalContributions!: Table<GoalContributionRow, string>;
  debts!: Table<DebtRow, string>;
  allocations!: Table<AllocationRow, string>;
  receipts!: Table<ReceiptRow, string>;
  receiptLinks!: Table<ReceiptLinkRow, string>;
  /** device-only — store tokens never sync in plaintext (privacy law).
   *  v3: keyed by instance id (the old per-store table is retired) */
  storeInstances!: Table<StoreConnectionRow, string>;
  storeMarkers!: Table<StoreMarkerRow, string>;
  storeConns!: Table<StoreConnRow, string>;
  storeConnLinks!: Table<StoreConnLinkRow, string>;
  holdings!: Table<HoldingRow, string>;
  lots!: Table<LotRow, string>;
  insightDismissals!: Table<InsightDismissRow, string>;
  topics!: Table<TopicRow, string>;
  activities!: Table<ActivityRow, string>;
  /** device-only — delayed quotes are a cache, not data */
  quoteCache!: Table<QuoteCacheRow, string>;
  outbox!: Table<OutboxRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      spaces: 'id',
      accounts: 'id, spaceId',
      categories: 'id, spaceId, parentId',
      transactions: 'id, spaceId, accountId, catId, [spaceId+date]',
      outbox: 'opId, spaceId, hlc',
      meta: 'key',
    });
    // feature B: per-space transformation overlay + account attachments
    this.version(2).stores({
      txMeta: 'id, spaceId, txId, [spaceId+txId]',
      accountLinks: 'id, spaceId, feedSpaceId, accountId',
    });
    // recurring costs + dismissed suggestions
    this.version(3).stores({
      recurrings: 'id, spaceId',
      recurringDismissals: 'id, spaceId',
    });
    // budgets
    this.version(4).stores({
      budgets: 'id, spaceId',
    });
    // events, goals, debts
    this.version(5).stores({
      events: 'id, spaceId',
      goals: 'id, spaceId',
      goalContributions: 'id, spaceId, goalId',
      debts: 'id, spaceId',
    });
    // allocation (zero-based budgeting)
    this.version(6).stores({
      allocations: 'id, spaceId, [spaceId+periodStart]',
    });
    // receipts (synced) + device-only store connections
    this.version(7).stores({
      receipts: 'id, spaceId, txId',
      storeConnections: 'store',
    });
    // secret-free synced store markers (reconnect notices)
    this.version(8).stores({
      storeMarkers: 'id, spaceId',
    });
    // portfolio (investments design) + device-only quote cache
    this.version(9).stores({
      holdings: 'id, spaceId',
      lots: 'id, spaceId, holdingId',
      quoteCache: 'key',
    });
    // insights: synced per-space dismissals
    this.version(10).stores({
      insightDismissals: 'id, spaceId',
    });
    // allocation topics: custom category groupings
    this.version(11).stores({
      topics: 'id, spaceId',
    });
    // receipts v3: instance-keyed device connections (Dexie cannot rekey
    // a primary key — new table, rows copied with id = store name so the
    // E2EE cipher ids stay stable across devices), synced instance
    // metadata + per-space inclusion links + snapshot receipt links
    this.version(12)
      .stores({
        storeInstances: 'id, store',
        storeConns: 'id, spaceId',
        storeConnLinks: 'id, spaceId, instanceId',
        receiptLinks: 'id, spaceId, txId, receiptId',
      })
      .upgrade(async (tx) => {
        const legacy = await tx.table('storeConnections').toArray();
        for (const row of legacy) {
          await tx.table('storeInstances').put({ ...row, id: row.store });
        }
      });
    // the retired per-store table goes in its own version (Dexie rule:
    // deletion and the upgrade that reads it must not share a version)
    this.version(13).stores({ storeConnections: null });
    // activity history: who did what, newest 200 per space
    this.version(14).stores({
      activities: 'id, spaceId',
    });
  }

  tableFor<E extends EntityName>(entity: E) {
    switch (entity) {
      case 'space':
        return this.spaces;
      case 'account':
        return this.accounts;
      case 'category':
        return this.categories;
      case 'transaction':
        return this.transactions;
      case 'txMeta':
        return this.txMeta;
      case 'accountLink':
        return this.accountLinks;
      case 'recurring':
        return this.recurrings;
      case 'recurringDismiss':
        return this.recurringDismissals;
      case 'budget':
        return this.budgets;
      case 'event':
        return this.events;
      case 'goal':
        return this.goals;
      case 'goalContribution':
        return this.goalContributions;
      case 'debt':
        return this.debts;
      case 'allocation':
        return this.allocations;
      case 'receipt':
        return this.receipts;
      case 'receiptLink':
        return this.receiptLinks;
      case 'storeMarker':
        return this.storeMarkers;
      case 'storeConn':
        return this.storeConns;
      case 'storeConnLink':
        return this.storeConnLinks;
      case 'holding':
        return this.holdings;
      case 'lot':
        return this.lots;
      case 'insightDismiss':
        return this.insightDismissals;
      case 'topic':
        return this.topics;
      case 'activity':
        return this.activities;
      default:
        throw new Error(`unknown entity: ${entity}`);
    }
  }
}

export const identityDbName = (identity: string) => `munni_${identity}`;
