/** Lets the ledger layer tell the sync runtime "something changed locally"
 *  without importing it (the runtime imports the ledger layer — this keeps
 *  the dependency one-way). */
export const syncHooks: { onLocalChange: () => void } = { onLocalChange: () => {} };
