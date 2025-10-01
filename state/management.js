import {
  todayYMD,
  compareYMD,
  fromYMD,
  toYMD,
  toWeekdayArray,
  normalizeNth,
  firstWeekday,
} from "../utils/dates.js";
import { clamp, round2, uid, deepClone } from "../utils/formatting.js";

export const STORAGE_KEYS = {
  STATE: "cashflow2025_v1",
  WHAT_IF: "cashflow2025_whatif_v1",
  AR_PREFS: "cashflow2025_arPrefs_v1",
};

export const DEFAULT_CONFIG = {
  END_DATE: "2025-12-31",
};

const ONE_OFF_SORT_KEYS = ["date", "schedule", "type", "name", "category", "next"];

export const defaultOneOffSortState = () => ({ key: "date", direction: "asc" });

export const sanitizeOneOffSortState = (value) => {
  const defaults = defaultOneOffSortState();
  if (!value || typeof value !== "object") return defaults;
  const key = ONE_OFF_SORT_KEYS.includes(value.key) ? value.key : defaults.key;
  const direction = value.direction === "desc" ? "desc" : defaults.direction;
  return { key, direction };
};

export const defaultState = () => ({
  settings: {
    startDate: todayYMD,
    endDate: DEFAULT_CONFIG.END_DATE,
    startingBalance: 0,
  },
  adjustments: [],
  oneOffs: [],
  incomeStreams: [],
  ui: {
    oneOffSort: defaultOneOffSortState(),
  },
});

export const isValidYMDString = (value) => {
  if (typeof value !== "string" || !value) return false;
  const parsed = fromYMD(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return toYMD(parsed) === value;
};

export const createSaleEntry = (startDate) => {
  const safeStart = isValidYMDString(startDate) ? startDate : todayYMD;
  return {
    id: uid(),
    name: "",
    pct: 0,
    topup: 0,
    startDate: safeStart,
    endDate: safeStart,
    businessDaysOnly: true,
    lastEdited: "pct",
  };
};

const sanitizeSteps = (steps) => {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => {
      if (!step || typeof step !== "object") return null;
      const date = typeof step.effectiveFrom === "string" ? step.effectiveFrom : null;
      const amount = Number(step.amount || 0);
      if (!date || !Number.isFinite(amount) || amount <= 0) return null;
      return { effectiveFrom: date, amount: Math.abs(amount) };
    })
    .filter((step) => step !== null)
    .sort((a, b) => compareYMD(a.effectiveFrom, b.effectiveFrom));
};

const sanitizeOneOff = (entry, { strict = false } = {}) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    if (strict) throw new Error("Invalid one-off entry");
    return null;
  }

  const result = { ...entry };
  result.id = typeof entry.id === "string" ? entry.id : uid();
  result.type = entry.type === "expense" ? "expense" : "income";
  result.recurring = Boolean(entry.recurring || entry.repeats);
  result.steps = sanitizeSteps(entry.steps);
  result.escalatorPct = Number.isFinite(Number(entry.escalatorPct || 0)) ? Number(entry.escalatorPct || 0) : 0;

  if (result.recurring) {
    const frequency = typeof entry.frequency === "string" ? entry.frequency : "monthly";
    result.frequency = frequency;
    result.startDate = typeof entry.startDate === "string" ? entry.startDate : typeof entry.date === "string" ? entry.date : null;
    result.endDate = typeof entry.endDate === "string" ? entry.endDate : typeof entry.date === "string" ? entry.date : null;

    if (!result.startDate || !result.endDate || !isValidYMDString(result.startDate) || !isValidYMDString(result.endDate)) {
      if (strict) throw new Error("Invalid recurring one-off date range");
      return null;
    }
    if (compareYMD(result.startDate, result.endDate) > 0) {
      if (strict) throw new Error("Invalid recurring one-off range");
      result.endDate = result.startDate;
    }
    result.skipWeekends = Boolean(entry.skipWeekends);

    if (entry.dayOfWeek !== undefined) {
      result.dayOfWeek = toWeekdayArray(entry.dayOfWeek);
    }
    if (entry.dayOfMonth !== undefined) {
      result.dayOfMonth = clamp(Number(entry.dayOfMonth || 1), 1, 31);
    }

    if (frequency === "monthly") {
      const monthlyMode = entry.monthlyMode === "nth" ? "nth" : "day";
      if (monthlyMode === "nth") {
        result.monthlyMode = "nth";
        result.nthWeek = normalizeNth(entry.nthWeek);
        const nthWeekdaySource =
          entry.nthWeekday !== undefined
            ? entry.nthWeekday
            : entry.dayOfWeek !== undefined
            ? entry.dayOfWeek
            : result.dayOfWeek ?? 0;
        result.nthWeekday = firstWeekday(nthWeekdaySource, 0);
      } else {
        result.monthlyMode = "day";
        const domSource = entry.dayOfMonth !== undefined ? entry.dayOfMonth : result.dayOfMonth ?? 1;
        result.dayOfMonth = clamp(Number(domSource || 1), 1, 31);
      }
    } else {
      result.monthlyMode = "day";
    }
    if (frequency === "weekly" || frequency === "biweekly") {
      result.dayOfWeek = toWeekdayArray(result.dayOfWeek);
    }
    if (result.monthlyMode !== "nth") {
      delete result.nthWeek;
      delete result.nthWeekday;
    }
    if (typeof entry.onDate === "string") result.onDate = entry.onDate;
    if (typeof entry.date === "string") result.date = entry.date;
    else result.date = result.startDate;
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

const sanitizeList = (list) =>
  list
    .map((item) => sanitizeOneOff(item))
    .filter((item) => item !== null);

const sanitizeStream = (entry, { strict = false } = {}) => {
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
    const list = raw[key];
    if (Array.isArray(list)) {
      state[key] = list.filter((item) => item && typeof item === "object");
    } else {
      if (strict && list !== undefined) throw new Error(`Invalid ${key} data`);
      state[key] = [];
    }
  };

  ensureArray("adjustments");
  ensureArray("oneOffs");
  ensureArray("incomeStreams");

  const sanitizeAdjustments = (list) =>
    list
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const date = typeof entry.date === "string" ? entry.date : null;
        if (!date || !isValidYMDString(date)) return null;
        const amount = Number(entry.amount || 0);
        if (!Number.isFinite(amount)) return null;
        return {
          id: typeof entry.id === "string" ? entry.id : uid(),
          date,
          amount,
          note: typeof entry.note === "string" ? entry.note : "",
        };
      })
      .filter((entry) => entry !== null);

  state.adjustments = sanitizeAdjustments(state.adjustments);
  state.oneOffs = sanitizeList(state.oneOffs);
  state.incomeStreams = state.incomeStreams
    .map((entry) => sanitizeStream(entry))
    .filter((entry) => entry !== null);

  const legacyExpenses = Array.isArray(raw.expenseStreams) ? raw.expenseStreams : [];
  if (legacyExpenses.length) {
    const fallbackStart = state.settings.startDate;
    const fallbackEnd = state.settings.endDate;
    const mapped = legacyExpenses
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
        return sanitizeOneOff(candidate);
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

export const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STATE);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    return normalizeState(data);
  } catch {
    return defaultState();
  }
};

export const saveState = (state) => {
  localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
};

export const clampPercent = (value, { min = -1, max = 2, fallback = 0 } = {}) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num * 1000) / 1000));
};

export const clampCurrency = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return round2(num);
};

export const computeEffectiveAmount = (base, pct, delta) => {
  const b = Number(base || 0);
  const p = Number(pct || 0);
  const d = Number(delta || 0);
  if (!Number.isFinite(b) || !Number.isFinite(p) || !Number.isFinite(d)) return 0;
  return round2(b * (1 + p) + d);
};

export const resolvePercentFromEffective = (base, effective, delta = 0) => {
  const b = Number(base || 0);
  if (!Number.isFinite(b) || b === 0) return 0;
  const e = Number(effective || 0);
  if (!Number.isFinite(e)) return 0;
  const d = Number(delta || 0);
  if (!Number.isFinite(d)) return 0;
  return clampPercent((e - d) / b - 1);
};

export const cloneStateForSandbox = (src) => {
  try {
    return normalizeState(deepClone(src) ?? {});
  } catch {
    return normalizeState(defaultState());
  }
};

export const getStreamById = (state, id) => {
  if (!state || !Array.isArray(state.incomeStreams)) return null;
  return state.incomeStreams.find((stream) => stream && typeof stream.id === "string" && stream.id === id) || null;
};

export const getStreamBaseAmount = (stream) => {
  if (!stream || typeof stream !== "object") return 0;
  return Math.abs(Number(stream.amount || 0)) || 0;
};

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
  const combinedEntries = saleEntriesRaw || (legacyEntryNeeded ? [{ ...saleRaw, startDate: legacyStart, endDate: legacyEnd }] : []);
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

export const loadWhatIf = (fallbackBase) => {
  const fallback = fallbackBase || defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WHAT_IF);
    if (!raw) return sanitizeWhatIfState({ base: fallback }, fallback);
    const data = JSON.parse(raw);
    return sanitizeWhatIfState(data, fallback);
  } catch {
    return sanitizeWhatIfState({ base: fallback }, fallback);
  }
};

export const saveWhatIf = (sandbox) => {
  localStorage.setItem(STORAGE_KEYS.WHAT_IF, JSON.stringify(sandbox));
};
