import type { YMDString, WeekendRollPolicy } from '../types';

/**
 * Pad a number with a leading zero when needed.
 */
const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Convert a Date instance into a YYYY-MM-DD string.
 */
export const toYMD = (date: Date): YMDString =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Convert a YYYY-MM-DD string into a Date instance.
 */
export const fromYMD = (value: string): Date => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

/**
 * Compare two YYYY-MM-DD strings lexicographically.
 * @returns Negative if a < b, positive if a > b, otherwise 0.
 */
export const compareYMD = (a: string, b: string): number =>
  String(a || "").localeCompare(String(b || ""));

/**
 * Add days to a YYYY-MM-DD string.
 */
export const addDays = (ymd: YMDString, days: number = 0): YMDString => {
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
 */
export const subtractDays = (ymd: YMDString, days: number = 0): YMDString =>
  addDays(ymd, -(Number(days || 0)));

/**
 * Determine if a date string falls on a weekend.
 */
export const isWeekend = (ymd: YMDString): boolean => {
  if (!ymd || typeof ymd !== "string") return false;
  const date = fromYMD(ymd);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
};

/**
 * Move the supplied date away from weekends according to a policy.
 */
export const rollWeekend = (ymd: YMDString, policy: WeekendRollPolicy = "forward"): YMDString => {
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
 */
export const nextBusinessDay = (ymd: YMDString, direction: "forward" | "back" = "forward"): YMDString => {
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
 * @returns A YYYY-MM-DD string or null when parsing fails.
 */
export const parseExcelOrISODate = (value: string | number | Date | null | undefined): YMDString | null => {
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
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(datePart)) {
    const parts = datePart.split(/[/-]/).map((seg) => seg.trim());
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
 * @returns Non-negative number of months separating the inputs.
 */
export const monthsBetween = (start: Date, end: Date): number => {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  const diff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(0, diff);
};

/**
 * Resolve today's date in YYYY-MM-DD format.
 */
export const todayYMD = (() => {
  const now = new Date();
  return toYMD(now);
})();
