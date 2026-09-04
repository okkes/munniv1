import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { downscaleImage } from '@/lib/image';
import { logActivity } from './activity';
import type { ReceiptRow } from '@/db/types';
import type { SpaceTx } from '@/db/joined';

/** the receipt attached to one transaction (photo or store) */
export function useTxReceipt(txId: string | undefined): ReceiptRow | null | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      if (!txId) return null;
      const row = (await store.bySpace('receipt', spaceId)).find((r) => r.deleted === 0 && r.txId === txId);
      return row ?? null;
    },
    [spaceId, txId],
  );
}

export interface ReceiptOps {
  /** photo path: downscale on-device, attach to the transaction */
  attachPhoto: (tx: Pick<SpaceTx, 'id' | 'date' | 'merchant' | 'amountCents'>, file: Blob) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** OCR result: line items extracted from the photo (S2) */
  setItems: (id: string, items: ReceiptRow['items']) => Promise<void>;
}

export function useReceiptOps(): ReceiptOps {
  const { store, repo, spaceId } = useData();
  return {
    attachPhoto: async (tx, file) => {
      // receipts want more pixels than avatars — text must stay readable
      const image = await downscaleImage(file, 1280, 0.7);
      await repo.upsert('receipt', spaceId, repo.newId(), {
        txId: tx.id,
        source: 'photo',
        date: tx.date,
        totalCents: Math.abs(tx.amountCents),
        merchant: tx.merchant,
        image,
      });
      void logActivity(store, repo, spaceId, 'receiptAdd', tx.merchant);
    },
    remove: async (id) => {
      const row = await store.get('receipt', id);
      await repo.remove('receipt', spaceId, id);
      void logActivity(store, repo, spaceId, 'receiptRemove', row?.merchant);
    },
    setItems: async (id, items) => {
      await repo.upsert('receipt', spaceId, id, { items });
    },
  };
}
