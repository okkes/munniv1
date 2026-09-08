/**
 * #275 (user): creating a category mid-review detours to /categories and
 * back — the deck must return to the SAME card with the category editor
 * reopened, not restart from the top. Read-once module state, stashed
 * only by the create-category door (the old per-visit reset ruling
 * stands for every other way of leaving review).
 */
export interface ReviewReturnState {
  skippedIds: readonly string[];
  txId: string;
  reopenCats: boolean;
}

let pending: ReviewReturnState | null = null;

export const setReviewReturn = (state: ReviewReturnState): void => {
  pending = state;
};

export const takeReviewReturn = (): ReviewReturnState | null => {
  const take = pending;
  pending = null;
  return take;
};
