"use strict";

import { compareYMD, fromYMD, monthsBetween, toYMD } from "./dateUtils";
import {
  clamp,
  sanitizeOneOff,
  sanitizeStream,
  sanitizeSteps,
  isValidYMDString,
} from "./validation";
import type {
  YMDString,
  NthWeek,
  IncomeStream,
  Transaction,
  Step,
} from "../types";

/**
 * Normalize arbitrary weekday input into a sorted array of unique indices.
 */
export const toWeekdayArray = (value: unknown): number[] => {
  if (value === undefined || value === null) return [];

  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value.includes(",")
    ? value.split(/[\s,]+/)
    : [value];

  const seen = new Set<number>();
  const days: number[] = [];
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
 */
export const normalizeNth = (value: unknown): NthWeek => {
  if (value === null || value === undefined) return "1";
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "last") return "last";
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 5) return String(parsed) as NthWeek;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const int = Math.trunc(value);
    if (int >= 1 && int <= 5) return String(int) as NthWeek;
  }
  return "1";
};

/**
 * Resolve the first weekday to use when selecting from an arbitrary input.
 */
export const firstWeekday = (value: unknown, fallback: number = 0): number => {
  const days = toWeekdayArray(value);
  if (days.length) return days[0];
  const num = Number(value);
  if (Number.isFinite(num)) return clamp(Math.trunc(num), 0, 6);
  return clamp(Number(fallback) || 0, 0, 6);
};

/**
 * Determine whether the supplied date falls within an inclusive range.
 */
const isBetween = (date: Date, start: Date, end: Date): boolean =>
  date >= start && date <= end;

/**
 * Determine whether a monthly recurrence matches a specific date.
 */
export const matchesMonthlyByDay = (date: Date, dayOfMonth: number): boolean => {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const target = clamp(dayOfMonth, 1, lastDay);
  return date.getDate() === target;
};

/**
 * Determine whether a date falls on the nth weekday of the month.
 */
export const matchesMonthlyByNthWeekday = (
  date: Date,
  nth: unknown,
  weekday: unknown
): boolean => {
  const nthValue = normalizeNth(nth);
  const targetDow = firstWeekday(weekday, 0);
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstDow = firstOfMonth.getDay();
  const firstOccurrenceDay = 1 + ((targetDow - firstDow + 7) % 7);

  const occurrences: number[] = [];
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
 */
export const matchesWeekly = (date: Date, weekdays: unknown): boolean => {
  const days = toWeekdayArray(weekdays);
  if (!days.length) return false;
  return days.includes(date.getDay());
};

/**
 * Determine if a biweekly recurrence matches the provided date.
 */
export const matchesBiweekly = (
  date: Date,
  weekdays: unknown,
  anchor: Date
): boolean => {
  const days = toWeekdayArray(weekdays);
  if (!days.length) return false;
  return days.some((dow) => {
    if (date.getDay() !== dow) return false;
    const start = new Date(anchor.getTime());
    const deltaToDow = (dow - start.getDay() + 7) % 7;
    start.setDate(start.getDate() + deltaToDow);
    if (date < start) return false;
    const diffDays = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays % 14 === 0;
  });
};

/**
 * Determine if a recurring stream should fire on the supplied date.
 */
export const shouldApplyStreamOn = (date: Date, stream: any): boolean => {
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
 */
export const shouldApplyTransactionOn = (date: Date, transaction: any): boolean => {
  if (!transaction || typeof transaction !== "object") return false;
  if (!transaction.recurring && !transaction.frequency) {
    return typeof transaction.date === "string" && toYMD(date) === transaction.date;
  }

  if (!transaction.frequency || !transaction.startDate || !transaction.endDate) return false;

  const shim: any = {
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

interface RecurringEntry {
  amount?: number;
  steps?: Step[];
}

/**
 * Calculate the base amount for a recurring entry on a given date.
 */
export const getBaseAmountForDate = (entry: RecurringEntry, date: Date): number => {
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

interface EscalatorEntry extends RecurringEntry {
  escalatorPct?: number;
}

/**
 * Resolve the amount for a recurring entry considering escalators.
 */
export const resolveRecurringAmount = (
  entry: EscalatorEntry,
  date: Date,
  prevDate: Date | null
): number => {
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
 */
export const estimateOccurrencesPerWeek = (stream: any): number => {
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

interface OccurrenceResult {
  date: YMDString;
  amount: number;
}

/**
 * Determine the next occurrence for a transaction or stream relative to a base date.
 */
export const getNextOccurrence = (
  entry: any,
  fromDateYMD?: string
): OccurrenceResult | null => {
  if (!entry || typeof entry !== "object") return null;
  const today = typeof fromDateYMD === "string" ? fromDateYMD : null;
  const baseDateYMD = today || null;

  const isRecurring = Boolean(entry.recurring || entry.frequency);

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

  let previous: Date | null = null;
  for (let cursor = new Date(start.getTime()); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
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

interface DescribableEntry {
  name?: string;
  category?: string;
  note?: string;
}

/**
 * Describe a transaction by combining its identifying fields.
 */
export const describeNameAndCategory = (entry: DescribableEntry, fallback: string): string => {
  if (!entry || typeof entry !== "object") return fallback;
  const parts: string[] = [];
  if (entry.name) parts.push(entry.name);
  if (entry.category) parts.push(entry.category);
  if (!parts.length && entry.note) parts.push(entry.note);
  return parts.join(" – ") || fallback;
};

interface CreateOptions {
  strict?: boolean;
}

/**
 * Create a sanitized one-off transaction.
 */
export const createOneOffTransaction = (
  entry: unknown,
  options: CreateOptions = {}
): Transaction | null => {
  const { strict = false } = options;
  return sanitizeOneOff(entry, strict);
};

/**
 * Update a one-off transaction within a list.
 */
export const updateOneOffTransaction = (
  list: Transaction[],
  id: string,
  updates: Partial<Transaction>,
  options: CreateOptions = {}
): Transaction[] => {
  const { strict = false } = options;
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
 */
export const deleteOneOffTransaction = (list: Transaction[], id: string): Transaction[] => {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && item.id !== id);
};

/**
 * Create a sanitized recurring income stream.
 */
export const createIncomeStream = (
  entry: unknown,
  options: CreateOptions = {}
): IncomeStream | null => {
  const { strict = false } = options;
  return sanitizeStream(entry, strict);
};

/**
 * Update an income stream within a list.
 */
export const updateIncomeStream = (
  list: IncomeStream[],
  id: string,
  updates: Partial<IncomeStream>,
  options: CreateOptions = {}
): IncomeStream[] => {
  const { strict = false } = options;
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
 */
export const deleteIncomeStream = (list: IncomeStream[], id: string): IncomeStream[] => {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && item.id !== id);
};

/**
 * Ensure a recurring stream definition contains sanitized step adjustments.
 */
export const normalizeStreamSteps = (stream: IncomeStream): IncomeStream => {
  if (!stream || typeof stream !== "object") return stream;
  const next = { ...stream };
  next.steps = sanitizeSteps(stream.steps);
  return next;
};

interface RecurrenceWindow {
  startDate?: string;
  endDate?: string;
}

/**
 * Validate whether provided recurrence boundaries are sensible.
 */
export const hasValidRecurrenceWindow = (entry: RecurrenceWindow): boolean => {
  if (!entry || typeof entry !== "object") return false;
  const start = typeof entry.startDate === "string" ? entry.startDate : null;
  const end = typeof entry.endDate === "string" ? entry.endDate : null;
  if (!start || !end) return false;
  if (!isValidYMDString(start) || !isValidYMDString(end)) return false;
  return compareYMD(start, end) <= 0;
};
