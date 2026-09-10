/** Amounts cross the wire in cents; only formatting deals in decimals. */
export const fmtMoney = (cents: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents ?? 0) / 100);

export const centsToInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '');

export const fmtRate = (cents: number | null | undefined, currency = 'USD') =>
  cents == null ? '—' : `${fmtMoney(cents, currency)}/hr`;
