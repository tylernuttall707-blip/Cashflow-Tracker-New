"use strict";

import { compareYMD, fromYMD, toYMD, todayYMD } from "./dateUtils.js";

const ONE_OFF_SORT_KEYS = ["date", "schedule", "type", "name", "category", "next"];
const DEFAULT_END = "2025-12-31";

/**
 * Generate a random identifier suitable for client-side records.
 * @returns {string} A pseudo-random identifier string.
 */
const uid = () => Math.random().toString(36).slice(2, 9);

/**
 * Deep clone arbitrary JSON-safe values.
 * @template T
 * @param {T} value - The value to clone.
 * @returns {T|null} The cloned value or null when cloning fails.
 */
const deepClone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

/**
 * Round a numeric value to two decimal places.
 * @param {number} value - The numeric value to round.
 * @returns {number} The rounded value.
 */
const round2 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

/**
 * Clamp a numeric value between inclusive bounds.
 * @param {number} value - The numeric value to clamp.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} The clamped value.
 */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Clamp percentage-like inputs while preserving precision.
 * @param {number} value - The raw percentage value (e.g. 0.1 for 10%).
 * @param {{min?: number, max?: number, fallback?: number}} [options] - Optional bounds.
 * @returns {number} The normalized percentage value.
 */
export const clampPercent = (value, { min = -1, max = 2, fallback = 0 } = {}) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num * 1000) / 1000));
};

/**
 * Clamp currency values to two decimal places.
 * @param {number} value - The raw value to normalize.
 * @param {number} [fallback=0] - Fallback value when input is invalid.
 * @returns {number} The sanitized currency amount.
 */
export const clampCurrency = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return round2(num);
};

/**
 * Produce the default one-off sort state configuration.
 * @returns {{key: string, direction: "asc"|"desc"}} The default sort descriptor.
 */
export const defaultOneOffSortState = () => ({ key: "date", direction: "asc" });

/**
 * Sanitize persisted sort preferences for one-off entries.
 * @param {unknown} value - The raw persisted value.
 * @returns {{key: string, direction: "asc"|"desc"}} The sanitized sort descriptor.
 */
export const sanitizeOneOffSortState = (value) => {
  const defaults = defaultOneOffSortState();
  if (!value || typeof value !== "object") return defaults;
  const key = ONE_OFF_SORT_KEYS.includes(value.key) ? value.key : defaults.key;
  const direction = value.direction === "desc" ? "desc" : defaults.direction;
  return { key, direction };
};

/**
 * Determine if a value is a valid YYYY-MM-DD string.
 * @param {unknown} value - The value to inspect.
 * @returns {boolean} True when the value is a valid YMD string.
 */
export const isValidYMDString = (value) => {
  if (typeof value !== "string" || !value) return false;
  const parsed = fromYMD(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return toYMD(parsed) === value;
};

/**
 * Sanitize recurring step adjustments.
 * @param {unknown} value - Raw steps array.
 * @returns {Array<{effectiveFrom: string, amount: number}>} Cleaned step list.
 */
export const sanitizeSteps = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) return null;
      const effectiveFrom =
        typeof step.effectiveFrom === "string" && isValidYMDString(step.effectiveFrom)
          ? step.effectiveFrom
          : null;
      const amount = Number(step.amount || 0);
      if (!effectiveFrom || !Number.isFinite(amount)) return null;
      return { effectiveFrom, amount: Math.abs(amount) };
    })
    .filter((step) => step !== null)
    .sort((a, b) => compareYMD(a.effectiveFrom, b.effectiveFrom));
};

/**
 * Sanitize single one-off transaction entries.
 * @param {unknown} entry - Raw entry value.
 * @param {boolean} [strict=false] - Whether to throw on invalid input.
 * @returns {object|null} Sanitized entry or null when invalid and not strict.
 */
export const sanitizeOneOff = (entry, strict = false) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    if (strict) throw new Error("Invalid one-off record");
    return null;
  }

  const amount = Number(entry.amount || 0);
  if (!Number.isFinite(amount)) {
    if (strict) throw new Error("Invalid one-off amount");
    return null;
  }

  const type = entry.type === "income" ? "income" : "expense";
  const id = typeof entry.id === "string" ? entry.id : uid();
  const result = {
    id,
    type,
    name: typeof entry.name === "string" ? entry.name : "",
    category: typeof entry.category === "string" ? entry.category : "",
    amount: Math.abs(amount),
    recurring: Boolean(entry.recurring),
  };

  if (entry.note !== undefined) result.note = entry.note;
  result.steps = sanitizeSteps(entry.steps);
  const escalator = Number(entry.escalatorPct || 0);
  result.escalatorPct = Number.isFinite(escalator) ? escalator : 0;

  if (result.recurring) {
    const frequency = typeof entry.frequency === "string" ? entry.frequency : null;
    const startDate = typeof entry.startDate === "string" ? entry.startDate : null;
    const endDate = typeof entry.endDate === "string" ? entry.endDate : typeof entry.date === "string" ? entry.date : null;
    const datesValid = frequency && startDate && endDate && isValidYMDString(startDate) && isValidYMDString(endDate);
    if (!datesValid) {
      if (strict) throw new Error("Invalid recurring one-off metadata");
      return null;
    }
    result.frequency = frequency;
    result.startDate = startDate;
    result.endDate = endDate;
    if (compareYMD(result.startDate, result.endDate) > 0) {
      if (strict) throw new Error("Invalid recurring one-off range");
      result.endDate = result.startDate;
    }
    const onDate = typeof entry.onDate === "string" ? entry.onDate : null;
    if (onDate) result.onDate = onDate;
  } else {
    const date = typeof entry.date === "string" ? entry.date : null;
    if (!date) {
      if (strict) throw new Error("Invalid one-off date");
      return null;
    }
    result.date = date;
    result.steps = [];
    result.escalatorPct = 0;
  }

  return result;
};

/**
 * Sanitize an income stream definition.
 * @param {unknown} entry - Raw stream object.
 * @param {boolean} [strict=false] - Whether to throw on invalid input.
 * @returns {object|null} Sanitized stream or null when invalid and not strict.
 */
export const sanitizeStream = (entry, strict = false) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    if (strict) throw new Error("Invalid income stream record");
    return null;
  }

  const amount = Number(entry.amount || 0);
  if (!Number.isFinite(amount)) {
    if (strict) throw new Error("Invalid income stream amount");
    return null;
  }

  const frequency = typeof entry.frequency === "string" ? entry.frequency : "once";
  const startDate = typeof entry.startDate === "string" ? entry.startDate : typeof entry.onDate === "string" ? entry.onDate : null;
  const endDate = typeof entry.endDate === "string" ? entry.endDate : typeof entry.onDate === "string" ? entry.onDate : null;
  const datesValid = startDate && endDate && isValidYMDString(startDate) && isValidYMDString(endDate);
  if (!datesValid) {
    if (strict) throw new Error("Invalid income stream date range");
    return null;
  }

  const startVsEnd = compareYMD(startDate, endDate);
  const normalizedStart = startVsEnd <= 0 ? startDate : endDate;
  const normalizedEnd = startVsEnd <= 0 ? endDate : startDate;

  const id = typeof entry.id === "string" ? entry.id : uid();
  const stream = {
    id,
    name: typeof entry.name === "string" ? entry.name : "",
    category: typeof entry.category === "string" ? entry.category : "",
    amount: Math.abs(amount),
    frequency,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    onDate: typeof entry.onDate === "string" ? entry.onDate : null,
    skipWeekends: Boolean(entry.skipWeekends),
    dayOfWeek: clamp(Number(entry.dayOfWeek ?? 0), 0, 6),
    dayOfMonth: clamp(Number(entry.dayOfMonth ?? 1), 1, 31),
    steps: sanitizeSteps(entry.steps),
    escalatorPct: Number.isFinite(Number(entry.escalatorPct || 0)) ? Number(entry.escalatorPct || 0) : 0,
  };

  if (frequency === "once") {
    stream.onDate = typeof entry.onDate === "string" ? entry.onDate : stream.startDate;
  }
  if (frequency === "daily") {
    stream.skipWeekends = Boolean(entry.skipWeekends);
  }
  if (frequency === "weekly" || frequency === "biweekly") {
    stream.dayOfWeek = clamp(Number(entry.dayOfWeek ?? 0), 0, 6);
  }
  if (frequency === "monthly") {
    stream.dayOfMonth = clamp(Number(entry.dayOfMonth ?? 1), 1, 31);
  }

  return stream;
};

/**
 * Generate the default application state structure.
 * @returns {object} Newly created default state tree.
 */
export const defaultState = () => ({
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
 * @param {unknown} raw - Raw persisted state.
 * @param {{strict?: boolean}} [options] - Optional strict parsing flags.
 * @returns {object} Sanitized application state.
 */
export const normalizeState = (raw, { strict = false } = {}) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid state payload");
  }

  const base = defaultState();
  const state = { ...base, ...raw };

  const rawSettings = raw.settings;
  if (rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)) {
    state.settings = { ...base.settings, ...rawSettings };
  } else {
    if (strict) throw new Error("Invalid settings data");
    state.settings = { ...base.settings };
  }

  if (raw.ui && typeof raw.ui === "object" && !Array.isArray(raw.ui)) {
    state.ui = { ...base.ui, ...raw.ui };
    state.ui.oneOffSort = sanitizeOneOffSortState(raw.ui.oneOffSort);
  } else {
    if (strict && raw.ui !== undefined) throw new Error("Invalid ui data");
    state.ui = { ...base.ui };
  }

  const ensureArray = (key) => {
    const value = raw[key] ?? state[key];
    if (value === undefined) {
      state[key] = [];
      return;
    }
    if (!Array.isArray(value)) {
      if (strict) throw new Error(`Invalid ${key}; expected an array`);
      state[key] = [];
      return;
    }
    state[key] = value;
  };

  ensureArray("adjustments");
  ensureArray("oneOffs");
  ensureArray("incomeStreams");

  const sanitizeList = (list) =>
    list
      .map((item) => sanitizeOneOff(item, strict))
      .filter((item) => item !== null);

  state.oneOffs = sanitizeList(state.oneOffs);

  state.incomeStreams = state.incomeStreams
    .map((entry) => sanitizeStream(entry, strict))
    .filter((entry) => entry !== null);

  if (Array.isArray(raw.expenseStreams) && raw.expenseStreams.length) {
    const fallbackStart = state.settings.startDate;
    const fallbackEnd = state.settings.endDate;
    const mapped = raw.expenseStreams
      .map((stream) => {
        if (!stream || typeof stream !== "object" || Array.isArray(stream)) {
          if (strict) throw new Error("Invalid legacy expense stream");
          return null;
        }
        const candidate = {
          ...stream,
          id: typeof stream.id === "string" ? stream.id : uid(),
          type: "expense",
          recurring: true,
          date: typeof stream.startDate === "string" ? stream.startDate : stream.onDate,
          startDate: typeof stream.startDate === "string" ? stream.startDate : fallbackStart,
          endDate: typeof stream.endDate === "string" ? stream.endDate : fallbackEnd,
        };
        return sanitizeOneOff(candidate, strict);
      })
      .filter((item) => item !== null);
    if (mapped.length) {
      state.oneOffs = [...state.oneOffs, ...mapped];
    }
  }

  delete state.expenseStreams;

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
 * @param {object} src - The source state.
 * @returns {object} Sanitized clone of the source state.
 */
export const cloneStateForSandbox = (src) => {
  try {
    return normalizeState(deepClone(src) ?? {}, { strict: false });
  } catch {
    return normalizeState(defaultState(), { strict: false });
  }
};

/**
 * Sanitize What-If scenario persistence payloads.
 * @param {unknown} raw - Raw persisted sandbox state.
 * @param {object} [fallbackBase=defaultState()] - Fallback base state.
 * @returns {{base: object, tweaks: object}} Sanitized What-If state tree.
 */
export const sanitizeWhatIfState = (raw, fallbackBase = defaultState()) => {
  const fallback = cloneStateForSandbox(fallbackBase);
  const baseRaw = raw && typeof raw === "object" ? raw.base : null;
  const base = baseRaw ? cloneStateForSandbox(baseRaw) : fallback;

  if (!Array.isArray(base.incomeStreams)) base.incomeStreams = [];

  const baseSettings = base.settings || fallback.settings || defaultState().settings;
  const tweaksRaw = raw && typeof raw === "object" && typeof raw.tweaks === "object" ? raw.tweaks : {};

  const globalRaw = tweaksRaw.global && typeof tweaksRaw.global === "object" ? tweaksRaw.global : {};
  const global = {
    pct: clampPercent(globalRaw.pct, { min: -1, max: 2, fallback: 0 }),
    delta: clampCurrency(globalRaw.delta, 0),
    lastEdited: ["pct", "delta", "effective"].includes(globalRaw.lastEdited) ? globalRaw.lastEdited : "pct",
  };

  const streamsRaw = tweaksRaw.streams && typeof tweaksRaw.streams === "object" ? tweaksRaw.streams : {};
  const streams = {};
  for (const stream of base.incomeStreams) {
    if (!stream || typeof stream !== "object") continue;
    if (typeof stream.id !== "string") stream.id = uid();
    const streamId = stream.id;
    const rawEntry = streamsRaw && typeof streamsRaw[streamId] === "object" ? streamsRaw[streamId] : {};
    const pct = clampPercent(rawEntry.pct, { min: -1, max: 2, fallback: 0 });
    const delta = clampCurrency(rawEntry.delta, 0);
    const effective = Number.isFinite(Number(rawEntry.effective)) ? round2(Number(rawEntry.effective)) : null;
    const weeklyTarget = Number.isFinite(Number(rawEntry.weeklyTarget)) ? round2(Number(rawEntry.weeklyTarget)) : null;
    const lastEdited = ["pct", "delta", "effective", "weekly"].includes(rawEntry.lastEdited)
      ? rawEntry.lastEdited
      : "pct";
    streams[streamId] = { pct, delta, effective, weeklyTarget, lastEdited };
  }

  const startDate = isValidYMDString(tweaksRaw.startDate) ? tweaksRaw.startDate : baseSettings.startDate;
  let endDate = isValidYMDString(tweaksRaw.endDate) ? tweaksRaw.endDate : baseSettings.endDate;
  if (compareYMD(startDate, endDate) > 0) endDate = startDate;

  const saleRaw = tweaksRaw.sale && typeof tweaksRaw.sale === "object" ? tweaksRaw.sale : {};
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
    const entry = { ...rawEntry };
    const entryStart = isValidYMDString(entry.startDate) ? entry.startDate : legacyStart;
    let entryEnd = isValidYMDString(entry.endDate) ? entry.endDate : entryStart;
    if (compareYMD(entryStart, entryEnd) > 0) entryEnd = entryStart;
    const entryPct = clampPercent(entry.pct, { min: -1, max: 5, fallback: 0 });
    const entryTopup = clampCurrency(entry.topup, 0);
    const lastEdited = entry.lastEdited === "topup" ? "topup" : "pct";
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
      lastEdited,
    });
  }
  const sale = {
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
 * @returns {{roll: string, lag: number, conf: number, category: string, prune: boolean}} Default options.
 */
export const defaultAROptions = () => ({ roll: "forward", lag: 0, conf: 100, category: "AR", prune: false });

/**
 * Provide default AR mapping overrides.
 * @returns {{company: string, invoice: string, due: string, amount: string}} Default mappings.
 */
export const defaultARMappingOverrides = () => ({ company: "", invoice: "", due: "", amount: "" });

/**
 * Sanitize Accounts Receivable options payloads.
 * @param {unknown} value - Raw options input.
 * @returns {{roll: string, lag: number, conf: number, category: string, prune: boolean}} Clean options.
 */
export const sanitizeAROptions = (value) => {
  const defaults = defaultAROptions();
  if (!value || typeof value !== "object") return { ...defaults };
  const roll = ["forward", "back", "none"].includes(value.roll) ? value.roll : defaults.roll;
  const lagValue = Number(value.lag);
  const lag = Number.isFinite(lagValue) ? Math.max(0, Math.trunc(lagValue)) : defaults.lag;
  const confValue = Number(value.conf);
  const conf = Number.isFinite(confValue) ? clamp(confValue, 0, 100) : defaults.conf;
  const category = String(value.category ?? defaults.category).trim() || defaults.category;
  const prune = Boolean(value.prune);
  return { roll, lag, conf, category, prune };
};

/**
 * Sanitize Accounts Receivable mapping overrides.
 * @param {unknown} value - Raw mapping input.
 * @returns {{company: string, invoice: string, due: string, amount: string}} Clean mapping overrides.
 */
export const sanitizeARMapping = (value) => {
  const defaults = defaultARMappingOverrides();
  if (!value || typeof value !== "object") return { ...defaults };
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (value[key]) {
      result[key] = String(value[key]);
    }
  }
  return result;
};
