/** Thrown by validators; the error handler in index.js turns it into JSON. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => { throw new HttpError(400, msg); };
export const notFound = (msg = 'Not found') => { throw new HttpError(404, msg); };

/** Wraps an async handler so rejections reach Express's error handler. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function str(value, field, { max = 500, required = true, trim = true } = {}) {
  let v = value == null ? '' : String(value);
  if (trim) v = v.trim();
  if (required && !v) bad(`${field} is required`);
  if (v.length > max) bad(`${field} must be ${max} characters or fewer`);
  return v;
}

/** Accepts an ISO-8601 timestamp (offset preserved) and rejects anything else. */
export function isoTimestamp(value, field, { required = true } = {}) {
  if (value == null || value === '') {
    if (required) bad(`${field} is required`);
    return null;
  }
  const s = String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) bad(`${field} is not a valid timestamp`);
  return s;
}

export function isoDate(value, field) {
  const s = str(value, field, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad(`${field} must be YYYY-MM-DD`);
  return s;
}

export function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}
