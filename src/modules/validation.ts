"use strict";

import { compareYMD, fromYMD, toYMD, todayYMD } from "./dateUtils";
import type {
  AppState,
  Transaction,
  OneOffTransaction,
  RecurringTransaction,
  IncomeStream,
  Step,
  OneOffSortState,
  OneOffSortKey,
  YMDString,
  NthWeek,
  WhatIfState,
  AROptions,
  ARMappingOverrides,
  ClampOptions,
  Settings,
  GlobalTweak,
  StreamTweak,
  SaleConfig,
} from "../types";

const ONE_OFF_SORT_KEYS: OneOffSortKey[] = ["date", "schedule", "type", "name", "category", "next"];
const DEFAULT_END: YMDString = "2025-12-31";

/**
 * Normalize arbitrary weekday input into a sorted array of unique indices.
 */
const normalizeWeekdayArray = (value: unknown): number[] => {
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
 * Resolve the first weekday index from arbitrary input.
 */
const normalizeFirstWeekday = (value: unknown, fallback: number = 0): number => {
  const days = normalizeWeekdayArray(value);
  if (days.length) return days[0];
  const num = Number(value);
  if (Number.isFinite(num)) return clamp(Math.trunc(num), 0, 6);
  return clamp(Number(fallback) || 0, 0, 6);
};

/**
 * Normalize the nth ordinal descriptor for monthly recurrences.
 */
const normalizeNthDescriptor = (value: unknown): NthWeek => {
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
 * Generate a random identifier suitable for client-side records.
 */
const uid = (): string => Math.random().toString(36).slice(2, 9);

/**
 * Deep clone arbitrary JSON-safe values.
 */
const deepClone = <T>(value: T): T | null => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

/**
 * Round a numeric value to two decimal places.
 */
const round2 = (value: number): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

/**
 * Clamp a numeric value between inclusive bounds.
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Clamp percentage-like inputs while preserving precision.
 */
export const clampPercent = (
  value: number,
  { min = -1, max = 2, fallback = 0 }: ClampOptions = {}
): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num * 1000) / 1000));
};

/**
 * Clamp currency values to two decimal places.
 */
export const clampCurrency = (value: number, fallback: number = 0): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return round2(num);
};

/**
 * Produce the default one-off sort state configuration.
 */
export const defaultOneOffSortState = (): OneOffSortState => ({
  key: "date",
  direction: "asc"
});

/**
 * Sanitize persisted sort preferences for one-off entries.
 */
export const sanitizeOneOffSortState = (value: unknown): OneOffSortState => {
  const defaults = defaultOneOffSortState();
  if (!value || typeof value !== "object") return defaults;
  const obj = value as Record<string, unknown>;
  const key = ONE_OFF_SORT_KEYS.includes(obj.key as OneOffSortKey)
    ? (obj.key as OneOffSortKey)
    : defaults.key;
  const direction = obj.direction === "desc" ? "desc" : defaults.direction;
  return { key, direction };
};

/**
 * Determine if a value is a valid YYYY-MM-DD string.
 */
export const isValidYMDString = (value: unknown): value is YMDString => {
  if (typeof value !== "string" || !value) return false;
  const parsed = fromYMD(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return toYMD(parsed) === value;
};

/**
 * Sanitize recurring step adjustments.
 */
export const sanitizeSteps = (value: unknown): Step[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((step): Step | null => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return null;
      const stepObj = step as Record<string, unknown>;
      const effectiveFrom =
        typeof stepObj.effectiveFrom === "string" && isValidYMDString(stepObj.effectiveFrom)
          ? stepObj.effectiveFrom
          : null;
      const amount = Number(stepObj.amount || 0);
      if (!effectiveFrom || !Number.isFinite(amount)) return null;
      return { effectiveFrom, amount: Math.abs(amount) };
    })
    .filter((step): step is Step => step !== null)
    .sort((a, b) => compareYMD(a.effectiveFrom, b.effectiveFrom));
};

/**
 * Sanitize single one-off transaction entries.
 */
export const sanitizeOneOff = (entry: unknown, strict: boolean = false): Transaction | null => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    if (strict) throw new Error("Invalid one-off record");
    return null;
  }

  const entryObj = entry as Record<string, unknown>;
  const amount = Number(entryObj.amount || 0);
  if (!Number.isFinite(amount)) {
    if (strict) throw new Error("Invalid one-off amount");
    return null;
  }

  const type: "income" | "expense" = entryObj.type === "income" ? "income" : "expense";
  const id = typeof entryObj.id === "string" ? entryObj.id : uid();
  const baseResult = {
    id,
    type,
    name: typeof entryObj.name === "string" ? entryObj.name : "",
    category: typeof entryObj.category === "string" ? entryObj.category : "",
    amount: Math.abs(amount),
    recurring: Boolean(entryObj.recurring),
  };

  const resultWithNote = typeof entryObj.note === "string"
    ? { ...baseResult, note: entryObj.note }
    : baseResult;

  const steps = sanitizeSteps(entryObj.steps);
  const escalator = Number(entryObj.escalatorPct || 0);
  const escalatorPct = Number.isFinite(escalator) ? escalator : 0;

  if (baseResult.recurring) {
    const frequency = typeof entryObj.frequency === "string" ? entryObj.frequency : null;
    const startDate = typeof entryObj.startDate === "string" ? entryObj.startDate : null;
    const endDate = typeof entryObj.endDate === "string"
      ? entryObj.endDate
      : typeof entryObj.date === "string"
        ? entryObj.date
        : null;
    const datesValid = frequency && startDate && endDate &&
      isValidYMDString(startDate) && isValidYMDString(endDate);
    if (!datesValid) {
      if (strict) throw new Error("Invalid recurring one-off metadata");
      return null;
    }

    const recurringResult: RecurringTransaction = {
      ...resultWithNote,
      recurring: true as const,
      frequency: frequency as any,
      startDate,
      endDate,
      steps,
      escalatorPct,
    };

    const start = fromYMD(startDate);
    const startDow = Number.isNaN(start.getTime()) ? 0 : start.getDay();
    const startDom = Number.isNaN(start.getTime()) ? 1 : start.getDate();

    if (compareYMD(recurringResult.startDate, recurringResult.endDate) > 0) {
      if (strict) throw new Error("Invalid recurring one-off range");
      recurringResult.endDate = recurringResult.startDate;
    }

    const onDate = typeof entryObj.onDate === "string" ? entryObj.onDate : null;
    if (onDate) recurringResult.onDate = onDate;

    if (frequency === "daily") {
      recurringResult.skipWeekends = Boolean(entryObj.skipWeekends);
    }

    if (frequency === "weekly" || frequency === "biweekly") {
      const weekdays = normalizeWeekdayArray(entryObj.dayOfWeek);
      recurringResult.dayOfWeek = weekdays.length ? weekdays : [startDow];
    }

    if (frequency === "monthly") {
      const mode = entryObj.monthlyMode === "nth" ? "nth" : "day";
      recurringResult.monthlyMode = mode;
      if (mode === "nth") {
        const weekdays = normalizeWeekdayArray(entryObj.dayOfWeek);
        if (weekdays.length) recurringResult.dayOfWeek = weekdays;
        recurringResult.nthWeek = normalizeNthDescriptor(
          (entryObj.nthWeek as any) ?? (entryObj.nthWeekNumber as any)
        );
        recurringResult.nthWeekday = normalizeFirstWeekday(
          (entryObj.nthWeekday as any) ?? (entryObj.dayOfWeek as any),
          startDow
        );
      } else {
        const rawDom = Number(entryObj.dayOfMonth);
        const dom = Number.isFinite(rawDom) ? Math.trunc(rawDom) : startDom;
        recurringResult.dayOfMonth = clamp(dom, 1, 31);
      }
    }

    return recurringResult;
  } else {
    const date = typeof entryObj.date === "string" ? entryObj.date : null;
    if (!date) {
      if (strict) throw new Error("Invalid one-off date");
      return null;
    }

    const oneOffResult: OneOffTransaction = {
      ...resultWithNote,
      recurring: false as const,
      date,
      steps: [] as never[],
      escalatorPct: 0,
    };

    return oneOffResult;
  }
};

/**
 * Sanitize an income stream definition.
 */
export const sanitizeStream = (entry: unknown, strict: boolean = false): IncomeStream | null => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    if (strict) throw new Error("Invalid income stream record");
    return null;
  }

  const entryObj = entry as Record<string, unknown>;
  const amount = Number(entryObj.amount || 0);
  if (!Number.isFinite(amount)) {
    if (strict) throw new Error("Invalid income stream amount");
    return null;
  }

  const frequency = typeof entryObj.frequency === "string" ? entryObj.frequency : "once";
  const startDate = typeof entryObj.startDate === "string"
    ? entryObj.startDate
    : typeof entryObj.onDate === "string"
      ? entryObj.onDate
      : null;
  const endDate = typeof entryObj.endDate === "string"
    ? entryObj.endDate
    : typeof entryObj.onDate === "string"
      ? entryObj.onDate
      : null;
  const datesValid = startDate && endDate &&
    isValidYMDString(startDate) && isValidYMDString(endDate);
  if (!datesValid) {
    if (strict) throw new Error("Invalid income stream date range");
    return null;
  }

  const startVsEnd = compareYMD(startDate, endDate);
  const normalizedStart = startVsEnd <= 0 ? startDate : endDate;
  const normalizedEnd = startVsEnd <= 0 ? endDate : startDate;

  const id = typeof entryObj.id === "string" ? entryObj.id : uid();
  const startDateObj = fromYMD(normalizedStart);
  const startDow = Number.isNaN(startDateObj.getTime()) ? 0 : startDateObj.getDay();
  const startDom = Number.isNaN(startDateObj.getTime()) ? 1 : startDateObj.getDate();

  const stream: IncomeStream = {
    id,
    name: typeof entryObj.name === "string" ? entryObj.name : "",
    category: typeof entryObj.category === "string" ? entryObj.category : "",
    amount: Math.abs(amount),
    frequency: frequency as any,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    onDate: typeof entryObj.onDate === "string" ? entryObj.onDate : null,
    skipWeekends: Boolean(entryObj.skipWeekends),
    steps: sanitizeSteps(entryObj.steps),
    escalatorPct: Number.isFinite(Number(entryObj.escalatorPct || 0))
      ? Number(entryObj.escalatorPct || 0)
      : 0,
  };

  if (frequency === "once") {
    stream.onDate = typeof entryObj.onDate === "string" ? entryObj.onDate : stream.startDate;
  }
  if (frequency === "daily") {
    stream.skipWeekends = Boolean(entryObj.skipWeekends);
  }
  if (frequency === "weekly" || frequency === "biweekly") {
    const weekdays = normalizeWeekdayArray(entryObj.dayOfWeek);
    stream.dayOfWeek = weekdays.length ? weekdays : [startDow];
  }
  if (frequency === "monthly") {
    const mode = entryObj.monthlyMode === "nth" ? "nth" : "day";
    stream.monthlyMode = mode;
    if (mode === "nth") {
      const weekdays = normalizeWeekdayArray(entryObj.dayOfWeek);
      if (weekdays.length) stream.dayOfWeek = weekdays;
      stream.nthWeek = normalizeNthDescriptor(
        (entryObj.nthWeek as any) ?? (entryObj.nthWeekNumber as any)
      );
      stream.nthWeekday = normalizeFirstWeekday(
        (entryObj.nthWeekday as any) ?? (entryObj.dayOfWeek as any),
        startDow
      );
    } else {
      const rawDom = Number(entryObj.dayOfMonth);
      const dom = Number.isFinite(rawDom) ? Math.trunc(rawDom) : startDom;
      stream.dayOfMonth = clamp(dom, 1, 31);
    }
  }

  return stream;
};

/**
 * Generate the default application state structure.
 */
export const defaultState = (): AppState => ({
  settings: {
    startDate: todayYMD,
    endDate: DEFAULT_END,
    startingBalance: 0,
  },
  adjustments: [],
  oneOffs: [],
  incomeStreams: [],
  ui: {
    oneOffSort: defaultOneOffSortState(),
  },
});

/**
 * Normalize persisted state payloads.
 */
export const normalizeState = (
  raw: unknown,
  { strict = false }: { strict?: boolean } = {}
): AppState => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid state payload");
  }

  const rawObj = raw as Record<string, unknown>;
  const base = defaultState();
  const state: AppState = { ...base, ...rawObj } as AppState;

  const rawSettings = rawObj.settings;
  if (rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)) {
    state.settings = { ...base.settings, ...(rawSettings as Record<string, unknown>) } as Settings;
  } else {
    if (strict) throw new Error("Invalid settings data");
    state.settings = { ...base.settings };
  }

  if (rawObj.ui && typeof rawObj.ui === "object" && !Array.isArray(rawObj.ui)) {
    const rawUi = rawObj.ui as Record<string, unknown>;
    state.ui = { ...base.ui, ...rawUi } as any;
    state.ui.oneOffSort = sanitizeOneOffSortState(rawUi.oneOffSort);
  } else {
    if (strict && rawObj.ui !== undefined) throw new Error("Invalid ui data");
    state.ui = { ...base.ui };
  }

  const ensureArray = (key: keyof AppState): void => {
    const value = rawObj[key] ?? state[key];
    if (value === undefined) {
      (state as any)[key] = [];
      return;
    }
    if (!Array.isArray(value)) {
      if (strict) throw new Error(`Invalid ${key}; expected an array`);
      (state as any)[key] = [];
      return;
    }
    (state as any)[key] = value;
  };

  ensureArray("adjustments");
  ensureArray("oneOffs");
  ensureArray("incomeStreams");

  const sanitizeList = (list: unknown[]): Transaction[] =>
    list
      .map((item) => sanitizeOneOff(item, strict))
      .filter((item): item is Transaction => item !== null);

  state.oneOffs = sanitizeList(state.oneOffs as unknown[]);

  state.incomeStreams = (state.incomeStreams as unknown[])
    .map((entry) => sanitizeStream(entry, strict))
    .filter((entry): entry is IncomeStream => entry !== null);

  if (Array.isArray(rawObj.expenseStreams) && (rawObj.expenseStreams as unknown[]).length) {
    const fallbackStart = state.settings.startDate;
    const fallbackEnd = state.settings.endDate;
    const mapped = (rawObj.expenseStreams as unknown[])
      .map((stream): Transaction | null => {
        if (!stream || typeof stream !== "object" || Array.isArray(stream)) {
          if (strict) throw new Error("Invalid legacy expense stream");
          return null;
        }
        const streamObj = stream as Record<string, unknown>;
        const candidate = {
          ...streamObj,
          id: typeof streamObj.id === "string" ? streamObj.id : uid(),
          type: "expense",
          recurring: true,
          date: typeof streamObj.startDate === "string" ? streamObj.startDate : streamObj.onDate,
          startDate: typeof streamObj.startDate === "string" ? streamObj.startDate : fallbackStart,
          endDate: typeof streamObj.endDate === "string" ? streamObj.endDate : fallbackEnd,
        };
        return sanitizeOneOff(candidate, strict);
      })
      .filter((item): item is Transaction => item !== null);
    if (mapped.length) {
      state.oneOffs = [...state.oneOffs, ...mapped];
    }
  }

  delete (state as any).expenseStreams;

  if (typeof state.settings.startDate !== "string") {
    if (strict) throw new Error("Invalid settings.startDate");
    state.settings.startDate = base.settings.startDate;
  }
  if (typeof state.settings.endDate !== "string") {
    if (strict) throw new Error("Invalid settings.endDate");
    state.settings.endDate = base.settings.endDate;
  }
  if (!isValidYMDString(state.settings.startDate)) {
    if (strict) throw new Error("Invalid settings.startDate format");
    state.settings.startDate = base.settings.startDate;
  }
  if (!isValidYMDString(state.settings.endDate)) {
    if (strict) throw new Error("Invalid settings.endDate format");
    state.settings.endDate = base.settings.endDate;
  }
  if (compareYMD(state.settings.startDate, state.settings.endDate) > 0) {
    if (strict) throw new Error("Invalid settings date range");
    state.settings.endDate = state.settings.startDate;
  }
  const sb = Number(state.settings.startingBalance);
  if (Number.isFinite(sb)) {
    state.settings.startingBalance = sb;
  } else {
    if (strict) throw new Error("Invalid settings.startingBalance");
    state.settings.startingBalance = base.settings.startingBalance;
  }

  return state;
};

/**
 * Clone state suitable for sandbox usage (What-If scenarios).
 */
export const cloneStateForSandbox = (src: AppState): AppState => {
  try {
    return normalizeState(deepClone(src) ?? {}, { strict: false });
  } catch {
    return normalizeState(defaultState(), { strict: false });
  }
};

/**
 * Sanitize What-If scenario persistence payloads.
 */
export const sanitizeWhatIfState = (
  raw: unknown,
  fallbackBase: AppState = defaultState()
): WhatIfState => {
  const fallback = cloneStateForSandbox(fallbackBase);
  const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const baseRaw = rawObj ? rawObj.base : null;
  const base = baseRaw ? cloneStateForSandbox(baseRaw as AppState) : fallback;

  if (!Array.isArray(base.incomeStreams)) base.incomeStreams = [];

  const baseSettings = base.settings || fallback.settings || defaultState().settings;
  const tweaksRaw = rawObj && typeof rawObj.tweaks === "object"
    ? (rawObj.tweaks as Record<string, unknown>)
    : {};

  const globalRaw = tweaksRaw.global && typeof tweaksRaw.global === "object"
    ? (tweaksRaw.global as Record<string, unknown>)
    : {};
  const global: GlobalTweak = {
    pct: clampPercent(globalRaw.pct as number, { min: -1, max: 2, fallback: 0 }),
    delta: clampCurrency(globalRaw.delta as number, 0),
    lastEdited: ["pct", "delta", "effective"].includes(globalRaw.lastEdited as string)
      ? (globalRaw.lastEdited as "pct" | "delta" | "effective")
      : "pct",
  };

  const streamsRaw = tweaksRaw.streams && typeof tweaksRaw.streams === "object"
    ? (tweaksRaw.streams as Record<string, unknown>)
    : {};
  const streams: Record<string, StreamTweak> = {};
  for (const stream of base.incomeStreams) {
    if (!stream || typeof stream !== "object") continue;
    if (typeof stream.id !== "string") stream.id = uid();
    const streamId = stream.id;
    const rawEntry = streamsRaw && typeof streamsRaw[streamId] === "object"
      ? (streamsRaw[streamId] as Record<string, unknown>)
      : {};
    const pct = clampPercent(rawEntry.pct as number, { min: -1, max: 2, fallback: 0 });
    const delta = clampCurrency(rawEntry.delta as number, 0);
    const effective = Number.isFinite(Number(rawEntry.effective))
      ? round2(Number(rawEntry.effective))
      : null;
    const weeklyTarget = Number.isFinite(Number(rawEntry.weeklyTarget))
      ? round2(Number(rawEntry.weeklyTarget))
      : null;
    const lastEdited = ["pct", "delta", "effective", "weekly"].includes(rawEntry.lastEdited as string)
      ? (rawEntry.lastEdited as "pct" | "delta" | "effective" | "weekly")
      : "pct";
    streams[streamId] = { pct, delta, effective, weeklyTarget, lastEdited };
  }

  const startDate = isValidYMDString(tweaksRaw.startDate)
    ? tweaksRaw.startDate
    : baseSettings.startDate;
  let endDate = isValidYMDString(tweaksRaw.endDate)
    ? tweaksRaw.endDate
    : baseSettings.endDate;
  if (compareYMD(startDate, endDate) > 0) endDate = startDate;

  const saleRaw = tweaksRaw.sale && typeof tweaksRaw.sale === "object"
    ? (tweaksRaw.sale as Record<string, unknown>)
    : {};
  const legacyStart = isValidYMDString(saleRaw.startDate) ? saleRaw.startDate : startDate;
  let legacyEnd = isValidYMDString(saleRaw.endDate) ? saleRaw.endDate : legacyStart;
  if (compareYMD(legacyStart, legacyEnd) > 0) legacyEnd = legacyStart;
  const saleEntriesRaw = Array.isArray(saleRaw.entries) ? saleRaw.entries : null;
  const legacyEntryNeeded =
    !saleEntriesRaw &&
    (saleRaw.startDate || saleRaw.endDate || saleRaw.pct || saleRaw.topup || saleRaw.businessDaysOnly);
  const combinedEntries =
    saleEntriesRaw || (legacyEntryNeeded ? [{ ...saleRaw, startDate: legacyStart, endDate: legacyEnd }] : []);
  const saleEntries = [];
  for (const rawEntry of combinedEntries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = { ...rawEntry } as Record<string, unknown>;
    const entryStart = isValidYMDString(entry.startDate) ? entry.startDate : legacyStart;
    let entryEnd = isValidYMDString(entry.endDate) ? entry.endDate : entryStart;
    if (compareYMD(entryStart, entryEnd) > 0) entryEnd = entryStart;
    const entryPct = clampPercent(entry.pct as number, { min: -1, max: 5, fallback: 0 });
    const entryTopup = clampCurrency(entry.topup as number, 0);
    const entryLastEdited: "pct" | "topup" = entry.lastEdited === "topup" ? "topup" : "pct";
    const id = typeof entry.id === "string" ? entry.id : uid();
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 120) : "";
    saleEntries.push({
      id,
      name,
      pct: entryPct,
      topup: entryTopup,
      startDate: entryStart,
      endDate: entryEnd,
      businessDaysOnly: Boolean(entry.businessDaysOnly),
      lastEdited: entryLastEdited,
    });
  }
  const sale: SaleConfig = {
    enabled: Boolean(saleRaw.enabled),
    entries: saleEntries,
  };

  return {
    base,
    tweaks: {
      global,
      streams,
      sale,
      startDate,
      endDate,
    },
  };
};

/**
 * Provide default Accounts Receivable options.
 */
export const defaultAROptions = (): AROptions => ({
  roll: "forward",
  lag: 0,
  conf: 100,
  category: "AR",
  prune: false
});

/**
 * Provide default AR mapping overrides.
 */
export const defaultARMappingOverrides = (): ARMappingOverrides => ({
  company: "",
  invoice: "",
  due: "",
  amount: ""
});

/**
 * Sanitize Accounts Receivable options payloads.
 */
export const sanitizeAROptions = (value: unknown): AROptions => {
  const defaults = defaultAROptions();
  if (!value || typeof value !== "object") return { ...defaults };
  const obj = value as Record<string, unknown>;
  const roll = ["forward", "back", "none"].includes(obj.roll as string)
    ? (obj.roll as "forward" | "back" | "none")
    : defaults.roll;
  const lagValue = Number(obj.lag);
  const lag = Number.isFinite(lagValue) ? Math.max(0, Math.trunc(lagValue)) : defaults.lag;
  const confValue = Number(obj.conf);
  const conf = Number.isFinite(confValue) ? clamp(confValue, 0, 100) : defaults.conf;
  const category = String(obj.category ?? defaults.category).trim() || defaults.category;
  const prune = Boolean(obj.prune);
  return { roll, lag, conf, category, prune };
};

/**
 * Sanitize Accounts Receivable mapping overrides.
 */
export const sanitizeARMapping = (value: unknown): ARMappingOverrides => {
  const defaults = defaultARMappingOverrides();
  if (!value || typeof value !== "object") return { ...defaults };
  const obj = value as Record<string, unknown>;
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof ARMappingOverrides)[]) {
    if (obj[key]) {
      result[key] = String(obj[key]);
    }
  }
  return result;
};
