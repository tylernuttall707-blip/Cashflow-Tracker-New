"use strict";

import { compareYMD, fromYMD, monthsBetween, toYMD } from "./dateUtils.js";
import {
  clamp,
  sanitizeOneOff,
  sanitizeStream,
  sanitizeSteps,
  isValidYMDString,
} from "./validation.js";

/**
 * Normalize arbitrary weekday input into a sorted array of unique indices.
 * @param {unknown} value - Raw weekday selection value(s).
 * @returns {number[]} Sorted array of weekday indices (0 = Sunday).
 */
export const toWeekdayArray = (value) => {
  if (value === undefined || value === null) return [];

  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value.includes(",")
    ? value.split(/[\s,]+/)
    : [value];

  const seen = new Set();
  const days = [];
  for (const item of raw) {
    if (item === undefined || item === null) continue;
    const str = String(item).trim();
    if (!str) continue;
    const num = Number(str);
    if (!Number.isFinite(num)) continue;
    const normalized = clamp(Math.trunc(num), 0, 6);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      days.push(normalized);
    }
  }

  return days.sort((a, b) => a - b);
};

/**
 * Normalize the Nth qualifier for monthly weekday recurrences.
 * @param {unknown} value - Raw nth value (number or string).
 * @returns {"1"|"2"|"3"|"4"|"5"|"last"} Normalized ordinal indicator.
 */
export const normalizeNth = (value) => {
  if (value === null || value === undefined) return "1";
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "last") return "last";
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 5) return String(parsed);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const int = Math.trunc(value);
    if (int >= 1 && int <= 5) return String(int);
  }
  return "1";
};

/**
 * Resolve the first weekday to use when selecting from an arbitrary input.
 * @param {unknown} value - Raw weekday value.
 * @param {number} [fallback=0] - Fallback weekday index.
 * @returns {number} Normalized weekday index (0 = Sunday).
 */
export const firstWeekday = (value, fallback = 0) => {
  const days = toWeekdayArray(value);
  if (days.length) return days[0];
  const num = Number(value);
  if (Number.isFinite(num)) return clamp(Math.trunc(num), 0, 6);
  return clamp(Number(fallback) || 0, 0, 6);
};

/**
 * Determine whether the supplied date falls within an inclusive range.
 * @param {Date} date - Date to evaluate.
 * @param {Date} start - Range start.
 * @param {Date} end - Range end.
 * @returns {boolean} True when the date is inside the range.
 */
const isBetween = (date, start, end) => date >= start && date <= end;

/**
 * Determine whether a monthly recurrence matches a specific date.
 * @param {Date} date - Date to evaluate.
 * @param {number} dayOfMonth - Target day of month (1-31).
 * @returns {boolean} True when the recurrence fires on the date.
 */
export const matchesMonthlyByDay = (date, dayOfMonth) => {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const target = clamp(dayOfMonth, 1, lastDay);
  return date.getDate() === target;
};

/**
 * Determine whether a date falls on the nth weekday of the month.
 * @param {Date} date - Date to evaluate.
 * @param {unknown} nth - Raw nth descriptor (1-5 or "last").
 * @param {unknown} weekday - Raw weekday descriptor.
 * @returns {boolean} True when the recurrence fires on the date.
 */
export const matchesMonthlyByNthWeekday = (date, nth, weekday) => {
  const nthValue = normalizeNth(nth);
  const targetDow = firstWeekday(weekday, 0);
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstDow = firstOfMonth.getDay();
  const firstOccurrenceDay = 1 + ((targetDow - firstDow + 7) % 7);

  const occurrences = [];
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  for (let i = 0; i < 6; i += 1) {
    const day = firstOccurrenceDay + i * 7;
    if (day > lastDay) break;
    occurrences.push(day);
  }
  if (!occurrences.length) return false;

  if (nthValue === "last") {
    return date.getDate() === occurrences[occurrences.length - 1];
  }
  const idx = Number(nthValue) - 1;
  if (!Number.isFinite(idx) || idx < 0) return false;
  if (idx >= occurrences.length) return false;
  return date.getDate() === occurrences[idx];
};

/**
 * Determine if a weekly recurrence matches the provided date.
 * @param {Date} date - Date to evaluate.
 * @param {unknown} weekdays - Raw weekday selection.
 * @returns {boolean} True when the recurrence matches.
 */
export const matchesWeekly = (date, weekdays) => {
  const days = toWeekdayArray(weekdays);
  if (!days.length) return false;
  return days.includes(date.getDay());
};

/**
 * Determine if a biweekly recurrence matches the provided date.
 * @param {Date} date - Date to evaluate.
 * @param {unknown} weekdays - Raw weekday selection.
 * @param {Date} anchor - Recurrence anchor date.
 * @returns {boolean} True when the recurrence matches.
 */
export const matchesBiweekly = (date, weekdays, anchor) => {
  const days = toWeekdayArray(weekdays);
  if (!days.length) return false;
  return days.some((dow) => {
    if (date.getDay() !== dow) return false;
    const start = new Date(anchor.getTime());
    const deltaToDow = (dow - start.getDay() + 7) % 7;
    start.setDate(start.getDate() + deltaToDow);
    if (date < start) return false;
    const diffDays = Math.floor((date - start) / (1000 * 60 * 60 * 24));
    return diffDays % 14 === 0;
  });
};

/**
 * Determine if a recurring stream should fire on the supplied date.
 * @param {Date} date - Date to evaluate.
 * @param {object} stream - Normalized stream configuration.
 * @returns {boolean} True when the stream should run on the date.
 */
export const shouldApplyStreamOn = (date, stream) => {
  if (!stream || typeof stream !== "object") return false;
  const start = fromYMD(stream.startDate);
  const end = fromYMD(stream.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  if (!isBetween(date, start, end)) return false;

  switch (stream.frequency) {
    case "once":
      return Boolean(stream.onDate && toYMD(date) === stream.onDate);
    case "daily":
      if (stream.skipWeekends && (date.getDay() === 0 || date.getDay() === 6)) return false;
      return true;
    case "weekly":
      return matchesWeekly(date, stream.dayOfWeek);
    case "biweekly":
      return matchesBiweekly(date, stream.dayOfWeek, start);
    case "monthly":
      if (stream.monthlyMode === "nth") {
        return matchesMonthlyByNthWeekday(date, stream.nthWeek, stream.nthWeekday);
      }
      return matchesMonthlyByDay(date, Number(stream.dayOfMonth || 1));
    default:
      return false;
  }
};

/**
 * Determine if a transaction (one-off or recurring) should apply on a date.
 * @param {Date} date - Date to evaluate.
 * @param {object} transaction - Transaction definition.
 * @returns {boolean} True when the transaction applies on the date.
 */
export const shouldApplyTransactionOn = (date, transaction) => {
  if (!transaction || typeof transaction !== "object") return false;
  if (!transaction.repeats && !transaction.recurring && !transaction.frequency) {
    return typeof transaction.date === "string" && toYMD(date) === transaction.date;
  }

  if (!transaction.frequency || !transaction.startDate || !transaction.endDate) return false;

  const shim = {
    frequency: transaction.frequency,
    startDate: transaction.startDate,
    endDate: transaction.endDate,
    onDate: transaction.onDate || null,
    skipWeekends: Boolean(transaction.skipWeekends),
    dayOfWeek: toWeekdayArray(transaction.dayOfWeek),
    dayOfMonth: Number(transaction.dayOfMonth ?? 1),
    monthlyMode: transaction.monthlyMode === "nth" ? "nth" : "day",
    nthWeek: normalizeNth(transaction.nthWeek),
    nthWeekday: firstWeekday(transaction.nthWeekday ?? transaction.dayOfWeek ?? 0, 0),
  };

  return shouldApplyStreamOn(date, shim);
};

/**
 * Calculate the base amount for a recurring entry on a given date.
 * @param {object} entry - Recurring entry with optional step adjustments.
 * @param {Date} date - Date of occurrence.
 * @returns {number} Base amount before escalators.
 */
export const getBaseAmountForDate = (entry, date) => {
  const base = Number(entry?.amount || 0);
  if (!Array.isArray(entry?.steps) || entry.steps.length === 0) {
    return Math.abs(base) || 0;
  }
  const target = toYMD(date);
  let current = Math.abs(base) || 0;
  for (const step of entry.steps) {
    const effectiveFrom = typeof step?.effectiveFrom === "string" ? step.effectiveFrom : null;
    if (!effectiveFrom || compareYMD(effectiveFrom, target) > 0) break;
    const nextAmount = Number(step.amount || 0);
    if (!Number.isFinite(nextAmount)) continue;
    current = Math.abs(nextAmount);
  }
  return current;
};

/**
 * Resolve the amount for a recurring entry considering escalators.
 * @param {object} entry - Recurring entry configuration.
 * @param {Date} date - Current occurrence date.
 * @param {Date|null} prevDate - Previous occurrence date.
 * @returns {number} Amount to apply for the occurrence.
 */
export const resolveRecurringAmount = (entry, date, prevDate) => {
  const baseAmount = Math.abs(Number(getBaseAmountForDate(entry, date) || 0));
  if (!baseAmount) return 0;
  const escalatorPct = Number(entry?.escalatorPct || 0);
  if (!prevDate || !Number.isFinite(escalatorPct) || escalatorPct === 0) {
    return baseAmount;
  }
  const steps = monthsBetween(prevDate, date);
  if (!steps) return baseAmount;
  const factor = Math.pow(1 + escalatorPct / 100, steps);
  return baseAmount * factor;
};

/**
 * Estimate the average weekly occurrences for a stream definition.
 * @param {object} stream - Stream configuration.
 * @returns {number} Estimated occurrences per week.
 */
export const estimateOccurrencesPerWeek = (stream) => {
  if (!stream || typeof stream !== "object") return 0;
  switch (stream.frequency) {
    case "daily":
      return stream.skipWeekends ? 5 : 7;
    case "weekly": {
      const days = toWeekdayArray(stream.dayOfWeek);
      return days.length || 1;
    }
    case "biweekly": {
      const days = toWeekdayArray(stream.dayOfWeek);
      return (days.length || 1) / 2;
    }
    case "monthly":
      return 12 / 52;
    case "once":
    default:
      return 0;
  }
};

/**
 * Determine the next occurrence for a transaction or stream relative to a base date.
 * @param {object} entry - Transaction or stream definition.
 * @param {string} [fromDateYMD] - Base date in YYYY-MM-DD format.
 * @returns {{date: string, amount: number}|null} The next occurrence or null if none.
 */
export const getNextOccurrence = (entry, fromDateYMD) => {
  if (!entry || typeof entry !== "object") return null;
  const today = typeof fromDateYMD === "string" ? fromDateYMD : null;
  const baseDateYMD = today || null;

  const isRecurring = Boolean(entry.recurring || entry.repeats || entry.frequency);
  if (!isRecurring) {
    const date = typeof entry.date === "string" ? entry.date : null;
    if (!date || (baseDateYMD && compareYMD(date, baseDateYMD) < 0)) return null;
    const amount = Math.abs(Number(entry.amount || 0));
    if (!Number.isFinite(amount)) return null;
    return { date, amount };
  }

  const startDate =
    typeof entry.startDate === "string"
      ? entry.startDate
      : typeof entry.date === "string"
      ? entry.date
      : null;
  const endDate =
    typeof entry.endDate === "string"
      ? entry.endDate
      : typeof entry.date === "string"
      ? entry.date
      : null;

  if (!startDate || !endDate) return null;
  const start = fromYMD(startDate);
  const end = fromYMD(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;

  let previous = null;
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (!shouldApplyStreamOn(cursor, entry)) continue;
    const occurrenceYMD = toYMD(cursor);
    if (baseDateYMD && compareYMD(occurrenceYMD, baseDateYMD) < 0) {
      previous = new Date(cursor.getTime());
      continue;
    }
    const amount = resolveRecurringAmount(entry, cursor, previous);
    if (!amount) return null;
    return { date: occurrenceYMD, amount: Math.abs(amount) };
  }

  return null;
};

/**
 * Describe a transaction by combining its identifying fields.
 * @param {object} entry - Transaction or stream entry.
 * @param {string} fallback - Fallback label when fields are missing.
 * @returns {string} Human readable description.
 */
export const describeNameAndCategory = (entry, fallback) => {
  if (!entry || typeof entry !== "object") return fallback;
  const parts = [];
  if (entry.name) parts.push(entry.name);
  if (entry.category) parts.push(entry.category);
  if (!parts.length && entry.note) parts.push(entry.note);
  return parts.join(" – ") || fallback;
};

/**
 * Create a sanitized one-off transaction.
 * @param {object} entry - Raw transaction data.
 * @param {{strict?: boolean}} [options] - Optional strict flag.
 * @returns {object|null} Sanitized transaction or null when invalid.
 */
export const createOneOffTransaction = (entry, { strict = false } = {}) =>
  sanitizeOneOff(entry, strict);

/**
 * Update a one-off transaction within a list.
 * @param {object[]} list - Existing transaction list.
 * @param {string} id - Identifier of the transaction to update.
 * @param {object} updates - Partial update payload.
 * @param {{strict?: boolean}} [options] - Optional strict flag.
 * @returns {object[]} New list with the updated transaction.
 */
export const updateOneOffTransaction = (list, id, updates, { strict = false } = {}) => {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || item.id !== id) return item;
    const merged = { ...item, ...updates };
    const sanitized = sanitizeOneOff(merged, strict);
    return sanitized ?? item;
  });
};

/**
 * Remove a one-off transaction from a list.
 * @param {object[]} list - Existing transaction list.
 * @param {string} id - Identifier of the transaction to remove.
 * @returns {object[]} New list without the specified transaction.
 */
export const deleteOneOffTransaction = (list, id) => {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && item.id !== id);
};

/**
 * Create a sanitized recurring income stream.
 * @param {object} entry - Raw stream data.
 * @param {{strict?: boolean}} [options] - Optional strict flag.
 * @returns {object|null} Sanitized stream or null when invalid.
 */
export const createIncomeStream = (entry, { strict = false } = {}) =>
  sanitizeStream(entry, strict);

/**
 * Update an income stream within a list.
 * @param {object[]} list - Existing income stream list.
 * @param {string} id - Identifier of the stream to update.
 * @param {object} updates - Partial update payload.
 * @param {{strict?: boolean}} [options] - Optional strict flag.
 * @returns {object[]} New list with the updated stream.
 */
export const updateIncomeStream = (list, id, updates, { strict = false } = {}) => {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || item.id !== id) return item;
    const merged = { ...item, ...updates };
    const sanitized = sanitizeStream(merged, strict);
    return sanitized ?? item;
  });
};

/**
 * Remove an income stream from a list.
 * @param {object[]} list - Existing stream list.
 * @param {string} id - Identifier of the stream to remove.
 * @returns {object[]} New list without the specified stream.
 */
export const deleteIncomeStream = (list, id) => {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && item.id !== id);
};

/**
 * Ensure a recurring stream definition contains sanitized step adjustments.
 * @param {object} stream - Stream definition to sanitize in-place.
 * @returns {object} Updated stream with normalized steps.
 */
export const normalizeStreamSteps = (stream) => {
  if (!stream || typeof stream !== "object") return stream;
  const next = { ...stream };
  next.steps = sanitizeSteps(stream.steps);
  return next;
};

/**
 * Validate whether provided recurrence boundaries are sensible.
 * @param {object} entry - Transaction or stream entry.
 * @returns {boolean} True when the recurrence dates are valid.
 */
export const hasValidRecurrenceWindow = (entry) => {
  if (!entry || typeof entry !== "object") return false;
  const start = typeof entry.startDate === "string" ? entry.startDate : null;
  const end = typeof entry.endDate === "string" ? entry.endDate : null;
  if (!start || !end) return false;
  if (!isValidYMDString(start) || !isValidYMDString(end)) return false;
  return compareYMD(start, end) <= 0;
};

