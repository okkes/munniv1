/**
 * #180: the home FAB's "new category" door — read-once, same shape as
 * accounts/openHandoff. Arriving on the manage screen with the intent
 * set opens the create-main sheet immediately.
 */
let pending = false;

export const setCategoriesCreateIntent = (): void => {
  pending = true;
};

export const takeCategoriesCreateIntent = (): boolean => {
  const take = pending;
  pending = false;
  return take;
};
