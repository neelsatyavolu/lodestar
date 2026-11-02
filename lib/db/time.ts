/** Epoch milliseconds to a timestamptz parameter. */
export const toTs = (ms: number): string => new Date(ms).toISOString();
