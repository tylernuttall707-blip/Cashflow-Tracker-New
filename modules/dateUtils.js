"use strict";

/**
 * Pad a number with a leading zero when needed.
 * @param {number} value - The numeric value to pad.
 * @returns {string} The padded string representation of the number.
 */
const pad = (value) => String(value).padStart(2, "0");

/**
 * Convert a {@link Date} instance into a YYYY-MM-DD string.
 * @param {Date} date - The date to convert.
 * @returns {string} The formatted date string.
 */
export const toYMD = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Convert a YYYY-MM-DD string into a {@link Date} instance.
 * @param {string} value - The date string to parse.
 * @returns {Date} The corresponding date object.
 */
export const fromYMD = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

/**
 * Compare two YYYY-MM-DD strings lexicographically.
 * @param {string} a - The first date string.
 * @param {string} b - The second date string.
 * @returns {number} Negative if a < b, positive if a > b, otherwise 0.
 */
export const compareYMD = (a, b) => String(a || "").localeCompare(String(b || ""));

/**
 * Add days to a YYYY-MM-DD string.
 * @param {string} ymd - The base date string.
 * @param {number} [days=0] - Number of days to add (can be negative).
 * @returns {string} The resulting date string.
 */
export const addDays = (ymd, days = 0) => {
  if (!ymd || typeof ymd !== "string") return ymd;
  const delta = Number(days || 0);
  if (!Number.isFinite(delta)) return ymd;
  const date = fromYMD(ymd);
  if (Number.isNaN(date.getTime())) return ymd;
  date.setDate(date.getDate() + delta);
  return toYMD(date);
};

/**
 * Subtract days from a YYYY-MM-DD string.
 * @param {string} ymd - The base date string.
 * @param {number} [days=0] - Number of days to subtract.
 * @returns {string} The resulting date string.
 */
export const subtractDays = (ymd, days = 0) => addDays(ymd, -(Number(days || 0)));

/**
 * Determine if a date string falls on a weekend.
 * @param {string} ymd - The date string to inspect.
 * @returns {boolean} True if the date is Saturday or Sunday, otherwise false.
 */
export const isWeekend = (ymd) => {
  if (!ymd || typeof ymd !== "string") return false;
  const date = fromYMD(ymd);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
};

/**
 * Move the supplied date away from weekends according to a policy.
 * @param {string} ymd - The starting date string.
 * @param {"forward"|"back"|"none"} [policy="forward"] - Weekend rolling policy.
 * @returns {string} The adjusted date string.
 */
export const rollWeekend = (ymd, policy = "forward") => {
  if (!ymd || typeof ymd !== "string") return ymd;
  const date = fromYMD(ymd);
  if (Number.isNaN(date.getTime())) return ymd;

  const moveForward = () => {
    do {
      date.setDate(date.getDate() + 1);
    } while (date.getDay() === 0 || date.getDay() === 6);
  };

  const moveBack = () => {
    do {
      date.setDate(date.getDate() - 1);
    } while (date.getDay() === 0 || date.getDay() === 6);
  };

  if (date.getDay() === 0 || date.getDay() === 6) {
    if (policy === "back") moveBack();
    else if (policy === "forward") moveForward();
  }

  return toYMD(date);
};

/**
 * Compute the next business day relative to a date string.
 * @param {string} ymd - The base date string.
 * @param {"forward"|"back"} [direction="forward"] - Direction to search.
 * @returns {string} The resulting business day, or the original string on error.
 */
export const nextBusinessDay = (ymd, direction = "forward") => {
  if (!ymd || typeof ymd !== "string") return ymd;
  const step = direction === "back" ? -1 : 1;
  let candidate = addDays(ymd, step);
  for (let i = 0; i < 14; i += 1) {
    if (!isWeekend(candidate)) return candidate;
    candidate = addDays(candidate, step);
  }
  return candidate;
};

/**
 * Parse a value that may contain an Excel serial or ISO-like date.
 * @param {string|number|Date} value - The value to parse.
 * @returns {string|null} A YYYY-MM-DD string or null when parsing fails.
 */
export const parseExcelOrISODate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toYMD(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const serial = Number(value);
    const whole = Math.floor(serial);
    const frac = serial - whole;
    let days = whole;
    if (days > 59) days -= 1; // Excel leap year bug
    const epoch = Date.UTC(1899, 11, 31);
    const ms = epoch + days * 86400000 + Math.round(frac * 86400000);
    const dt = new Date(ms);
    if (Number.isNaN(dt.getTime())) return null;
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) return null;
    return toYMD(dt);
  }
  const [datePart] = str.split(/\s+/);
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(datePart)) {
    const parts = datePart.split(/[\/\-]/).map((seg) => seg.trim());
    if (parts.length === 3) {
      const [m, d, yRaw] = parts;
      let year = Number(yRaw);
      const month = Number(m);
      const day = Number(d);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      const dt = new Date(year, month - 1, day);
      if (Number.isNaN(dt.getTime())) return null;
      return toYMD(dt);
    }
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return toYMD(parsed);
};

/**
 * Calculate the whole number of months between two dates.
 * @param {Date} start - The earlier date.
 * @param {Date} end - The later date.
 * @returns {number} Non-negative number of months separating the inputs.
 */
export const monthsBetween = (start, end) => {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  const diff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(0, diff);
};

/**
 * Resolve today's date in YYYY-MM-DD format.
 * @returns {string} The formatted representation of the current date.
 */
export const todayYMD = (() => {
  const now = new Date();
  return toYMD(now);
})();
