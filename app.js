/* 2025 Cash Flow — all client-side, localStorage powered */

(() => {
  "use strict";

  // ---------- Utilities ----------
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const fmtMoney = (n) =>
    (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (ymd) => {
    if (!ymd) return "";
    try {
      const d = fromYMD(ymd);
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ymd;
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (err) {
      return ymd;
    }
  };
  const pad = (n) => String(n).padStart(2, "0");
  const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYMD = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const round2 = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100) / 100;
  };
  const addDays = (ymd, days = 0) => {
    if (!ymd || typeof ymd !== "string") return ymd;
    const delta = Number(days || 0);
    if (!Number.isFinite(delta)) return ymd;
    const d = fromYMD(ymd);
    if (Number.isNaN(d.getTime())) return ymd;
    d.setDate(d.getDate() + delta);
    return toYMD(d);
  };
  const rollWeekend = (ymd, policy = "forward") => {
    if (!ymd || typeof ymd !== "string") return ymd;
    const d = fromYMD(ymd);
    if (Number.isNaN(d.getTime())) return ymd;
    const moveForward = () => {
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
    };
    const moveBack = () => {
      do {
        d.setDate(d.getDate() - 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
    };
    if (d.getDay() === 6 || d.getDay() === 0) {
      if (policy === "back") moveBack();
      else if (policy === "forward") moveForward();
      // policy === "none" keeps original weekend date
    }
    return toYMD(d);
  };
  const parseCurrency = (value) => {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : NaN;
    }
    let str = String(value).trim();
    if (!str) return NaN;
    let negative = false;
    if (/^\((.*)\)$/.test(str)) {
      negative = true;
      str = str.slice(1, -1);
    }
    str = str.replace(/[−–—]/g, "-");
    if (str.endsWith("-")) {
      negative = true;
      str = str.slice(0, -1);
    }
    if (str.startsWith("-")) {
      negative = true;
      str = str.slice(1);
    }
    str = str.replace(/[^0-9.,]/g, "");
    if (!str) return NaN;
    const hasComma = str.includes(",");
    const hasDot = str.includes(".");
    if (hasComma && hasDot) {
      if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
        str = str.replace(/\./g, "");
        str = str.replace(/,/g, ".");
      } else {
        str = str.replace(/,/g, "");
      }
    } else if (hasComma) {
      const parts = str.split(",");
      if (parts.length > 1 && parts[parts.length - 1].length === 2) {
        str = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
      } else {
        str = parts.join("");
      }
    } else {
      str = str.replace(/,/g, "");
    }
    const num = Number(str);
    if (!Number.isFinite(num)) return NaN;
    return negative ? -num : num;
  };
  const parseExcelOrISODate = (value) => {
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
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(str)) {
      const parts = str.split(/[\/\-]/).map((seg) => seg.trim());
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
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const compareYMD = (a, b) => String(a || "").localeCompare(String(b || ""));
  const describeNameAndCategory = (entry, fallback) => {
    if (!entry || typeof entry !== "object") return fallback;
    const parts = [];
    if (entry.name) parts.push(entry.name);
    if (entry.category) parts.push(entry.category);
    if (!parts.length && entry.note) parts.push(entry.note);
    return parts.join(" – ") || fallback;
  };
  const monthsBetween = (prev, next) => {
    if (!prev || !next) return 0;
    const months = (next.getFullYear() - prev.getFullYear()) * 12 + (next.getMonth() - prev.getMonth());
    return Math.max(0, months);
  };

  const getBaseAmountForDate = (entry, date) => {
    const base = Number(entry.amount || 0);
    if (!Array.isArray(entry.steps) || !entry.steps.length) return base;
    const target = toYMD(date);
    let current = base;
    for (const step of entry.steps) {
      const eff = typeof step?.effectiveFrom === "string" ? step.effectiveFrom : null;
      if (!eff || compareYMD(eff, target) > 0) break;
      const amt = Number(step.amount || 0);
      if (!Number.isFinite(amt)) continue;
      current = Math.abs(amt);
    }
    return current;
  };

  const resolveRecurringAmount = (entry, date, prevDate) => {
    const baseAmount = Math.abs(Number(getBaseAmountForDate(entry, date) || 0));
    if (!baseAmount) return 0;
    const escalatorPct = Number(entry.escalatorPct || 0);
    if (!prevDate || !Number.isFinite(escalatorPct) || escalatorPct === 0) {
      return baseAmount;
    }
    const steps = monthsBetween(prevDate, date);
    if (!steps) return baseAmount;
    const factor = Math.pow(1 + escalatorPct / 100, steps);
    return baseAmount * factor;
  };

  const getNextOccurrence = (entry, fromDateYMD = todayYMD) => {
    if (!entry || typeof entry !== "object") return null;
    const isRecurring = Boolean(entry.recurring || entry.repeats || entry.frequency);
    if (!isRecurring) {
      const date = typeof entry.date === "string" ? entry.date : null;
      if (!date || compareYMD(date, fromDateYMD) < 0) return null;
      const amount = Math.abs(Number(entry.amount || 0));
      if (!Number.isFinite(amount)) return null;
      return { date, amount };
    }

    const startDate = typeof entry.startDate === "string" ? entry.startDate : typeof entry.date === "string" ? entry.date : null;
    const endDate = typeof entry.endDate === "string" ? entry.endDate : typeof entry.date === "string" ? entry.date : null;
    if (!startDate || !endDate) return null;

    const start = fromYMD(startDate);
    const end = fromYMD(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;

    let prev = null;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (!shouldApplyStreamOn(d, entry)) continue;
      const occYMD = toYMD(d);
      const amount = resolveRecurringAmount(entry, d, prev);
      if (compareYMD(occYMD, fromDateYMD) >= 0) {
        return { date: occYMD, amount: Math.abs(amount) };
      }
      prev = new Date(d.getTime());
    }

    return null;
  };
  const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const getDOWLabel = (value) => {
    const n = Number(value);
    if (Number.isNaN(n)) return DOW_LABELS[0];
    const idx = ((n % 7) + 7) % 7;
    return DOW_LABELS[idx] ?? DOW_LABELS[0];
  };

// Nth-weekday helpers (safe to keep even if not used yet)
const normalizeNth = (value) => {
  if (value === null || value === undefined) return "1";
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "last") return "last";
    const parsed = parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 5) return String(parsed);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const int = Math.trunc(value);
    if (int >= 1 && int <= 5) return String(int);
  }
  return "1";
};

const ordinal = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
};

const describeNth = (nth) => {
  const n = normalizeNth(nth);
  return n === "last" ? "last" : ordinal(Number(n));
};

  const toWeekdayArray = (value) => {
    if (value === undefined || value === null) return [];

    let raw;
    if (Array.isArray(value)) raw = value;
    else if (typeof value === "string" && value.includes(",")) raw = value.split(/[\s,]+/);
    else raw = [value];

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

// Weekday pick helper
const firstWeekday = (value, fallback = 0) => {
  const days = toWeekdayArray(value);
  if (days.length) return days[0];
  const num = Number(value);
  if (Number.isFinite(num)) return clamp(Math.trunc(num), 0, 6);
  return clamp(Number(fallback) || 0, 0, 6);
};

  const formatWeekdayList = (value) => {
    const days = toWeekdayArray(value);
    if (!days.length) return "";
    return days.map((dow) => getDOWLabel(dow)).join(", ");
  };

  const readWeekdaySelections = (selectEl) => {
    if (!selectEl) return [];
    const values = Array.from(selectEl.selectedOptions || []).map((opt) => opt.value);
    return toWeekdayArray(values);
  };

  const todayYMD = (() => {
    const d = new Date();
    return toYMD(d);
  })();

  // ---------- Storage ----------
  const STORAGE_KEY = "cashflow2025_v1";
  const defaultEnd = "2025-12-31";

  const defaultState = () => ({
    settings: {
      startDate: todayYMD,
      endDate: defaultEnd,
      startingBalance: 0,
    },
    adjustments: [],
    oneOffs: [],
    incomeStreams: [],
  });

  const isValidYMDString = (value) => {
    if (typeof value !== "string" || !value) return false;
    const parsed = fromYMD(value);
    if (Number.isNaN(parsed.getTime())) return false;
    return toYMD(parsed) === value;
  };

  const normalizeState = (raw, { strict = false } = {}) => {
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

    const sanitizeSteps = (value) => {
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

    const sanitizeOneOff = (entry) => {
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
        const endDate = typeof entry.endDate === "string" ? entry.endDate : null;
        const datesValid =
          frequency && startDate && endDate && isValidYMDString(startDate) && isValidYMDString(endDate);
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
            const domSource =
              entry.dayOfMonth !== undefined ? entry.dayOfMonth : result.dayOfMonth ?? 1;
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

    state.oneOffs = sanitizeList(state.oneOffs);

    const sanitizeStream = (entry) => {
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
            startDate:
              typeof stream.startDate === "string" ? stream.startDate : fallbackStart,
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

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      return normalizeState(data);
    } catch {
      return defaultState();
    }
  };

  const save = (state) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  };

  let STATE = load();

STATE.incomeStreams = (STATE.incomeStreams || []).map((stream) => {
  if (!stream || typeof stream !== "object") return stream;

  // Copy and normalize fields
  const next = { ...stream };

  // dayOfWeek can be a single number or array/string → normalize to array [0..6]
  if (next.dayOfWeek !== undefined) {
    next.dayOfWeek = toWeekdayArray(next.dayOfWeek);
  }

  // Support monthly "nth weekday" mode for streams only
  if (next.monthlyMode === "nth") {
    next.nthWeek = normalizeNth(next.nthWeek); // "1".."5" or "last"
    // If nthWeekday missing, default to first value from dayOfWeek or Sunday (0)
    next.nthWeekday = firstWeekday(next.nthWeekday ?? next.dayOfWeek ?? 0, 0);
  }

  return next;
});

STATE.oneOffs = (STATE.oneOffs || []).map((tx) => {
  if (!tx || typeof tx !== "object") return tx;

  // Keep one-offs simple; normalize dayOfWeek only if present (harmless for old data)
  if (tx.dayOfWeek !== undefined) {
    return { ...tx, dayOfWeek: toWeekdayArray(tx.dayOfWeek) };
  }
  return tx;
});


  // ---------- Receivables importer helpers ----------
  const normalizeHeaderLabel = (value) =>
    String(value ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const COMPANY_HEADER_CANDIDATES = ["customer", "distributor", "company", "bill to", "sold to"];
  const INVOICE_HEADER_CANDIDATES = ["invoice", "inv #", "doc #", "document", "reference", "ref"];
  const DUE_HEADER_CANDIDATES = ["due", "due date", "due_dt", "net due", "maturity", "due date (net)"];
  const AMOUNT_HEADER_CANDIDATES = ["open amount", "balance", "amt due", "amount", "outstanding", "open bal"];
  const TERMS_HEADER_CANDIDATES = ["terms", "payment terms", "net terms", "terms description"];
  const INVOICE_DATE_HEADER_CANDIDATES = [
    "invoice date",
    "inv date",
    "document date",
    "doc date",
    "document dt",
    "posting date",
    "invoice_dt",
    "doc_dt",
    "date",
  ];

  const detectARColumns = (headers = []) => {
    const normalized = headers.map((header) => ({ raw: header, norm: normalizeHeaderLabel(header) }));
    const evaluate = (candidates) => {
      let best = { header: "", score: 0 };
      for (const entry of normalized) {
        if (!entry.norm) continue;
        let score = 0;
        for (const candidate of candidates) {
          const normCandidate = normalizeHeaderLabel(candidate);
          if (!normCandidate) continue;
          if (entry.norm === normCandidate) {
            score = Math.max(score, 3);
          } else if (entry.norm.includes(normCandidate) || normCandidate.includes(entry.norm)) {
            score = Math.max(score, 2);
          } else if (normCandidate.split(" ").some((token) => token && entry.norm.includes(token))) {
            score = Math.max(score, 1);
          }
        }
        if (score > best.score) {
          best = { header: entry.raw, score };
        }
      }
      return best;
    };

    const mapping = {
      company: evaluate(COMPANY_HEADER_CANDIDATES),
      invoice: evaluate(INVOICE_HEADER_CANDIDATES),
      due: evaluate(DUE_HEADER_CANDIDATES),
      amount: evaluate(AMOUNT_HEADER_CANDIDATES),
    };
    const aux = {
      terms: evaluate(TERMS_HEADER_CANDIDATES),
      invoiceDate: evaluate(INVOICE_DATE_HEADER_CANDIDATES),
    };

    return {
      mapping: Object.fromEntries(Object.entries(mapping).map(([key, val]) => [key, val.header || ""])),
      scores: Object.fromEntries(Object.entries(mapping).map(([key, val]) => [key, val.score || 0])),
      aux: Object.fromEntries(Object.entries(aux).map(([key, val]) => [key, val.header || ""])),
    };
  };

  const resolveColumnName = (headers = [], name) => {
    if (!name) return "";
    const direct = headers.find((header) => String(header) === name);
    if (direct !== undefined) return direct;
    const norm = normalizeHeaderLabel(name);
    if (!norm) return name;
    const match = headers.find((header) => normalizeHeaderLabel(header) === norm);
    return match || name;
  };

  const parseNetTerms = (value) => {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (!str) return null;
    const netMatch = str.match(/net\s*(\d+)/i);
    if (netMatch && Number.isFinite(Number(netMatch[1]))) return Number(netMatch[1]);
    const daysMatch = str.match(/(\d+)\s*day/i);
    if (daysMatch && Number.isFinite(Number(daysMatch[1]))) return Number(daysMatch[1]);
    return null;
  };

  const defaultARName = (company, invoice) => {
    const companyLabel = String(company ?? "").trim();
    const invoiceLabel = String(invoice ?? "").trim();
    if (companyLabel && invoiceLabel) return `(${companyLabel}) Inv #${invoiceLabel}`;
    if (invoiceLabel) return `Invoice #${invoiceLabel}`;
    if (companyLabel) return `${companyLabel} Receivable`;
    return "Receivable";
  };

  const isEmptyCell = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return true;
      if (/^[-–—]+$/.test(trimmed)) return true;
      return false;
    }
    return false;
  };

  const isAgingBucketHeader = (header) => {
    const raw = String(header ?? "").trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    if (lower.includes("aging total")) return false;
    const norm = normalizeHeaderLabel(raw);
    if (!norm) return false;
    if (norm === "current" || norm.startsWith("current ")) return true;
    if (lower.includes("current") && !lower.includes("currency")) return true;
    if (!norm.includes("day")) return false;
    const matches = norm.match(/\b(\d{1,3})\b/g);
    if (!matches || !matches.length) return false;
    return matches.some((token) => {
      const num = Number(token);
      return Number.isFinite(num) && num >= 0 && num <= 365;
    });
  };

  const detectAgingBucketColumns = (rows) => {
    const seen = new Set();
    for (const item of rows) {
      if (!item || typeof item.values !== "object") continue;
      for (const header of Object.keys(item.values)) {
        if (isAgingBucketHeader(header)) {
          seen.add(header);
        }
      }
    }
    return Array.from(seen);
  };

  const normalizeCompanyKey = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).trim().toUpperCase();
  };
  const normalizeInvoiceKey = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).trim().toUpperCase().replace(/\s+/g, "");
  };
  const makeSourceKey = (company, invoice) => {
    const normCompany = normalizeCompanyKey(company);
    const normInvoice = normalizeInvoiceKey(invoice);
    if (!normCompany || !normInvoice) return null;
    return `${normCompany}#${normInvoice}`;
  };

  const findOneOffBySourceKey = (key) => {
    if (!key) return undefined;
    return (STATE.oneOffs || []).find((tx) => tx && tx.source === "AR" && tx.sourceKey === key);
  };

  const arState = {
    rows: [],
    mapping: { company: "", invoice: "", due: "", amount: "" },
    aux: { terms: "", invoiceDate: "" },
    headerOrder: [],
    page: 1,
    perPage: 200,
    parsing: false,
    summary: null,
    detection: null,
    lastRange: { start: 0, end: 0 },
    options: { roll: "forward", lag: 0, conf: 100, category: "AR" },
  };

  const computeExpectedDate = (dueYMD) => {
    if (!dueYMD || !isValidYMDString(dueYMD)) return dueYMD || "";
    const rollPolicy = arState.options.roll || "forward";
    const rolled = rollWeekend(dueYMD, rollPolicy);
    const lagValue = Number(arState.options.lag || 0);
    const lagDays = Number.isFinite(lagValue) ? Math.trunc(lagValue) : 0;
    return addDays(rolled, lagDays);
  };

  const validateARRow = (row) => {
    if (!row) return false;
    const errors = {};
    if (!row.company || !String(row.company).trim()) errors.company = true;
    if (!row.invoice || !String(row.invoice).trim()) errors.invoice = true;
    if (!row.dueDate || !isValidYMDString(row.dueDate)) errors.dueDate = true;
    if (!row.expectedDate || !isValidYMDString(row.expectedDate)) errors.expectedDate = true;
    if (!Number.isFinite(Number(row.amount)) || Number(row.amount) === 0) errors.amount = true;
    if (!row.name || !String(row.name).trim()) errors.name = true;
    row.errors = errors;
    row.valid = Object.keys(errors).length === 0;
    if (!row.valid) row.selected = false;
    return row.valid;
  };

  const refreshARRow = (row, { dueChanged = false, forceExpected = false, forceAmount = false, forceName = false } = {}) => {
    if (!row) return;
    if (dueChanged) row.manualExpected = false;
    const conf = clamp(Number(arState.options.conf || 0), 0, 100);
    if (forceExpected || dueChanged || (!row.manualExpected && row.dueDate)) {
      row.expectedDate = computeExpectedDate(row.dueDate);
    }
    if (forceAmount || (!row.manualAmount && Number.isFinite(row.baseAmount))) {
      row.amount = round2(row.baseAmount * (conf / 100));
    }
    if (forceName || (!row.manualName && row.company !== undefined)) {
      row.name = defaultARName(row.company, row.invoice);
    }
    row.sourceKey = makeSourceKey(row.company, row.invoice);
    row.action = row.sourceKey && findOneOffBySourceKey(row.sourceKey) ? "update" : "add";
    validateARRow(row);
  };

  const updateSelectAllState = () => {
    const selectAll = $("#arSelectAll");
    if (!selectAll) return;
    const validRows = arState.rows.filter((row) => row.valid);
    if (!validRows.length) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      selectAll.disabled = arState.rows.length === 0;
      return;
    }
    const selected = validRows.filter((row) => row.selected).length;
    selectAll.disabled = false;
    selectAll.checked = selected > 0 && selected === validRows.length;
    selectAll.indeterminate = selected > 0 && selected < validRows.length;
  };

  const updateARImportButton = () => {
    const btn = $("#arImportBtn");
    if (!btn) return;
    const baseLabel = btn.dataset.baseLabel || btn.textContent || "Import";
    if (arState.parsing) {
      btn.disabled = true;
      btn.textContent = baseLabel;
      return;
    }
    const selected = arState.rows.filter((row) => row.valid && row.selected).length;
    btn.disabled = selected === 0;
    btn.textContent = selected > 0 ? `${baseLabel} (${selected})` : baseLabel;
  };

  const applyRowToDOM = (row) => {
    const tbody = $("#arPreview tbody");
    if (!tbody) return;
    const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
    if (!tr) return;
    tr.classList.toggle("invalid", !row.valid);
    const checkbox = tr.querySelector('input[type="checkbox"][data-act="toggleRow"]');
    if (checkbox) {
      checkbox.disabled = !row.valid;
      checkbox.checked = row.valid && row.selected;
    }
    tr.querySelectorAll('[data-field]').forEach((input) => {
      const field = input.dataset.field;
      let value = row[field];
      if (field === "amount") {
        value = Number.isFinite(Number(row.amount)) ? Number(row.amount).toFixed(2) : "";
      }
      if (field === "dueDate" || field === "expectedDate") {
        value = row[field] || "";
      }
      if (field === "company" || field === "invoice" || field === "name") {
        value = row[field] ?? "";
      }
      if (document.activeElement !== input && value !== undefined) {
        input.value = value;
      }
      const hasError = Boolean(row.errors?.[field]);
      input.classList.toggle("invalid", hasError);
      const cell = input.closest("td");
      if (cell) cell.classList.toggle("invalid-cell", hasError);
    });
    const badge = tr.querySelector('[data-badge]');
    if (badge) {
      badge.textContent = row.action === "update" ? "Update" : "Add";
      badge.classList.toggle("badge-update", row.action === "update");
      badge.classList.toggle("badge-add", row.action !== "update");
    }
  };

  const renderARPagination = () => {
    const container = $("#arPagination");
    if (!container) return;
    container.innerHTML = "";
    const total = arState.rows.length;
    if (!total) return;
    const perPage = arState.perPage || total;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const info = document.createElement("span");
    const start = Math.min(arState.lastRange.start, total) || (total ? 1 : 0);
    const end = Math.min(arState.lastRange.end, total);
    info.textContent = `Rows ${start}-${end} of ${total}`;

    const pageInfo = document.createElement("span");
    pageInfo.textContent = pages > 1 ? `Page ${arState.page} of ${pages}` : "";

    const pager = document.createElement("div");
    pager.className = "pager";
    const prev = document.createElement("button");
    prev.textContent = "Prev";
    prev.disabled = arState.page <= 1;
    prev.dataset.page = String(arState.page - 1);
    const next = document.createElement("button");
    next.textContent = "Next";
    next.disabled = arState.page >= pages;
    next.dataset.page = String(arState.page + 1);
    pager.appendChild(prev);
    pager.appendChild(next);

    container.appendChild(info);
    if (pageInfo.textContent) container.appendChild(pageInfo);
    if (pages > 1) container.appendChild(pager);
  };

  const updateARStatus = (message = "", kind = "") => {
    const el = $("#arStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("error", "success");
    if (kind) el.classList.add(kind);
  };

  const renderARSummary = () => {
    const el = $("#arSummary");
    if (!el) return;
    if (!arState.summary) {
      el.textContent = "";
      return;
    }
    const { added = 0, updated = 0, skipped = 0 } = arState.summary;
    el.textContent = `Last import: ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}.`;
  };

  const renderARPreview = () => {
    const tbody = $("#arPreview tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const selectAll = $("#arSelectAll");
    if (selectAll) {
      selectAll.disabled = arState.rows.length === 0;
      if (arState.rows.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
    }
    if (!arState.rows.length) {
      arState.lastRange = { start: 0, end: 0 };
      updateARImportButton();
      updateSelectAllState();
      renderARPagination();
      renderARSummary();
      return;
    }
    const perPage = arState.perPage || arState.rows.length;
    const totalPages = Math.max(1, Math.ceil(arState.rows.length / perPage));
    if (arState.page > totalPages) arState.page = totalPages;
    const startIndex = (arState.page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, arState.rows.length);
    const pageRows = arState.rows.slice(startIndex, endIndex);
    for (const row of pageRows) {
      const amountValue = Number.isFinite(Number(row.amount)) ? Number(row.amount).toFixed(2) : "";
      const tr = document.createElement("tr");
      tr.dataset.rowId = row.id;
      tr.innerHTML = `
        <td class="select-col">
          <input type="checkbox" data-act="toggleRow" data-id="${row.id}" ${row.valid ? "" : "disabled"} ${row.valid && row.selected ? "checked" : ""} />
        </td>
        <td><input type="text" data-field="company" data-id="${row.id}" value="${escapeHtml(row.company ?? "")}" /></td>
        <td><input type="text" data-field="invoice" data-id="${row.id}" value="${escapeHtml(row.invoice ?? "")}" /></td>
        <td><input type="date" data-field="dueDate" data-id="${row.id}" value="${row.dueDate || ""}" /></td>
        <td><input type="date" data-field="expectedDate" data-id="${row.id}" value="${row.expectedDate || ""}" /></td>
        <td><input type="number" step="0.01" data-field="amount" data-id="${row.id}" value="${amountValue}" /></td>
        <td><input type="text" data-field="name" data-id="${row.id}" value="${escapeHtml(row.name ?? "")}" /></td>
        <td><span class="badge ${row.action === "update" ? "badge-update" : "badge-add"}" data-badge>${row.action === "update" ? "Update" : "Add"}</span></td>
      `;
      tbody.appendChild(tr);
      applyRowToDOM(row);
    }
    arState.lastRange = { start: startIndex + 1, end: endIndex };
    updateARImportButton();
    updateSelectAllState();
    renderARPagination();
    renderARSummary();
  };

  const normalizeARRows = (rawRows, mapping, aux) => {
    const rows = [];
    let skipped = 0;
    const totalsRegex = /^(total|subtotal|aging|bucket)/i;
    const bucketColumns = detectAgingBucketColumns(rawRows);
    let currentCompany = "";
    for (const item of rawRows) {
      if (!item || typeof item.values !== "object") {
        skipped += 1;
        continue;
      }
      const raw = item.values;
      const firstCell = item.firstCell;
      if (typeof firstCell === "string" && totalsRegex.test(firstCell.trim().toLowerCase())) {
        skipped += 1;
        continue;
      }
      const companyRaw = mapping.company ? raw[mapping.company] : undefined;
      const invoiceRaw = mapping.invoice ? raw[mapping.invoice] : undefined;
      const dueRaw = mapping.due ? raw[mapping.due] : undefined;
      const amountRaw = mapping.amount ? raw[mapping.amount] : undefined;
      const termsRaw = aux.terms ? raw[aux.terms] : undefined;
      const invoiceDateRaw = aux.invoiceDate ? raw[aux.invoiceDate] : undefined;

      let company = String(companyRaw ?? "").trim();
      if (company) currentCompany = company;
      const invoice = String(invoiceRaw ?? "").trim();

      const bucketValues = bucketColumns.map((column) => ({
        column,
        raw: raw[column],
        number: parseCurrency(raw[column]),
      }));
      const bucketHasAny = bucketValues.some((entry) => !isEmptyCell(entry.raw));
      const bucketSum = bucketValues.reduce(
        (total, entry) => (Number.isFinite(entry.number) ? total + entry.number : total),
        0
      );
      const bucketHasNonZero = bucketValues.some((entry) => Number.isFinite(entry.number) && entry.number !== 0);

      const hasDueRaw = !isEmptyCell(dueRaw);
      const hasMappedAmountRaw = !isEmptyCell(amountRaw);

      if (!company && invoice && !hasDueRaw && !hasMappedAmountRaw && !bucketHasAny) {
        currentCompany = invoice;
        continue;
      }

      if (!company && currentCompany) {
        company = currentCompany;
      }

      let dueDate = parseExcelOrISODate(dueRaw);
      const invoiceDate = parseExcelOrISODate(invoiceDateRaw);
      if (!dueDate) {
        const netDays = parseNetTerms(termsRaw);
        if (invoiceDate && Number.isFinite(netDays)) {
          dueDate = addDays(invoiceDate, netDays);
        }
      }

      let baseAmount = parseCurrency(amountRaw);
      const hasMappedAmount = Number.isFinite(baseAmount) && baseAmount !== 0;
      const hasBucketAmount = bucketColumns.length > 0 && (bucketHasNonZero || (!hasMappedAmount && bucketHasAny));
      if (hasBucketAmount) {
        baseAmount = bucketSum;
      }

      if (!company || !invoice || !dueDate || !Number.isFinite(baseAmount) || baseAmount === 0) {
        skipped += 1;
        continue;
      }

      const row = {
        id: `ar-${uid()}`,
        company,
        invoice,
        dueDate,
        expectedDate: dueDate,
        baseAmount: round2(baseAmount),
        amount: round2(baseAmount),
        name: defaultARName(company, invoice),
        manualExpected: false,
        manualAmount: false,
        manualName: false,
        selected: true,
        errors: {},
        sourceKey: makeSourceKey(company, invoice),
        action: "add",
      };
      rows.push(row);
    }
    return { rows, skipped };
  };

  const parseARFile = (file) =>
    new Promise((resolve, reject) => {
      if (!file) {
        resolve({ rows: [], headers: [] });
        return;
      }
      const ext = file.name?.split(".").pop()?.toLowerCase();
      if (ext === "csv") {
        if (typeof Papa === "undefined") {
          reject(new Error("CSV parser unavailable"));
          return;
        }
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            try {
              const headers = (results.meta?.fields || []).map((h) => String(h ?? "").trim());
              const firstField = headers[0];
              const rows = (results.data || [])
                .map((row) => {
                  const cleaned = { ...row };
                  const allBlank = Object.values(cleaned).every(
                    (value) => value === null || value === undefined || String(value).trim() === ""
                  );
                  if (allBlank) return null;
                  const firstCell = firstField ? cleaned[firstField] : Object.values(cleaned)[0];
                  return { values: cleaned, firstCell };
                })
                .filter(Boolean);
              resolve({ rows, headers });
            } catch (err) {
              reject(err);
            }
          },
          error: (err) => reject(err || new Error("Failed to parse CSV")),
        });
        return;
      }
      if (ext === "xlsx" || ext === "xls") {
        if (typeof XLSX === "undefined") {
          reject(new Error("Excel parser unavailable"));
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = new Uint8Array(ev.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rowsArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
            const headerRow = rowsArray.find((row) => Array.isArray(row) && row.some((cell) => String(cell).trim() !== ""));
            if (!headerRow) {
              resolve({ rows: [], headers: [] });
              return;
            }
            const headerIndex = rowsArray.indexOf(headerRow);
            const headers = headerRow.map((cell) => String(cell ?? "").trim());
            const dataRows = rowsArray.slice(headerIndex + 1);
            const rows = dataRows
              .map((arr) => {
                if (!Array.isArray(arr)) return null;
                const allBlank = arr.every((value) => value === null || value === undefined || String(value).trim() === "");
                if (allBlank) return null;
                const values = {};
                headers.forEach((header, idx) => {
                  values[header] = arr[idx];
                });
                return { values, firstCell: arr[0] };
              })
              .filter(Boolean);
            resolve({ rows, headers });
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.readAsArrayBuffer(file);
        return;
      }
      reject(new Error("Unsupported file type"));
    });

  const recalcARRows = ({ force = false } = {}) => {
    if (!arState.rows.length) return;
    for (const row of arState.rows) {
      if (force) {
        row.manualExpected = false;
        row.manualAmount = false;
      }
      const shouldExpected = force || (!row.manualExpected && row.dueDate);
      const shouldAmount = force || (!row.manualAmount && Number.isFinite(row.baseAmount));
      refreshARRow(row, {
        forceExpected: shouldExpected,
        forceAmount: shouldAmount,
        forceName: false,
      });
    }
  };

  const handleARParse = async () => {
    const fileInput = $("#arFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      updateARStatus("Choose a CSV/XLS(X) file to preview.", "error");
      return;
    }
    arState.parsing = true;
    updateARStatus("Parsing receivables…");
    updateARImportButton();
    try {
      const { rows: rawRows, headers } = await parseARFile(file);
      if (!headers.length && !rawRows.length) {
        arState.rows = [];
        renderARPreview();
        updateARStatus("No data rows found in file.", "error");
        return;
      }
      const detection = detectARColumns(headers);
      arState.detection = detection;

      const applySuggestion = (selector, suggestion) => {
        const input = $(selector);
        if (!input) return;
        if (!input.value && suggestion) input.value = suggestion;
      };
      applySuggestion("#colCompany", detection.mapping.company);
      applySuggestion("#colInvoice", detection.mapping.invoice);
      applySuggestion("#colDue", detection.mapping.due);
      applySuggestion("#colAmount", detection.mapping.amount);

      const mappingInput = {
        company: $("#colCompany")?.value?.trim() || "",
        invoice: $("#colInvoice")?.value?.trim() || "",
        due: $("#colDue")?.value?.trim() || "",
        amount: $("#colAmount")?.value?.trim() || "",
      };

      const resolvedMapping = {
        company: resolveColumnName(headers, mappingInput.company),
        invoice: resolveColumnName(headers, mappingInput.invoice),
        due: resolveColumnName(headers, mappingInput.due),
        amount: resolveColumnName(headers, mappingInput.amount),
      };

      const missing = Object.entries(resolvedMapping)
        .filter(([, column]) => !column || !headers.includes(column));
      if (missing.length) {
        const fields = missing.map(([key]) => key).join(", ");
        updateARStatus(`Column not found for: ${fields}`, "error");
        arState.rows = [];
        renderARPreview();
        return;
      }

      const resolvedAux = {
        terms: detection.aux.terms ? resolveColumnName(headers, detection.aux.terms) : "",
        invoiceDate: detection.aux.invoiceDate ? resolveColumnName(headers, detection.aux.invoiceDate) : "",
      };

      const { rows: normalizedRows, skipped } = normalizeARRows(rawRows, resolvedMapping, resolvedAux);
      if (!normalizedRows.length) {
        arState.rows = [];
        renderARPreview();
        updateARStatus("No valid invoice rows detected. Check your column mapping.", "error");
        return;
      }

      const limitedRows = normalizedRows.slice(0, 5000);
      arState.rows = limitedRows;
      arState.mapping = resolvedMapping;
      arState.aux = resolvedAux;
      arState.page = 1;
      arState.perPage = limitedRows.length > 1000 ? 200 : Math.max(limitedRows.length, 1);
      arState.summary = null;

      for (const row of arState.rows) {
        row.manualAmount = false;
        row.manualExpected = false;
        row.manualName = false;
        refreshARRow(row, { dueChanged: true, forceExpected: true, forceAmount: true, forceName: true });
        row.selected = row.valid;
      }

      const validCount = arState.rows.filter((row) => row.valid).length;
      const truncated = normalizedRows.length > limitedRows.length;
      const parts = [];
      parts.push(`${rawRows.length} rows parsed`);
      parts.push(`${validCount} ready`);
      if (skipped) parts.push(`${skipped} skipped`);
      if (truncated) parts.push(`showing first ${limitedRows.length}`);
      const lowConfidence = Object.values(detection.scores || {}).some((score) => score < 2);
      if (lowConfidence) parts.push("check column mapping");

      renderARPreview();
      updateARStatus(parts.join(" · "));
    } catch (err) {
      const message = err?.message || String(err);
      updateARStatus(`Failed to parse file: ${message}`, "error");
    } finally {
      arState.parsing = false;
      updateARImportButton();
    }
  };

  const handleARSelectAll = (event) => {
    const checked = Boolean(event.target.checked);
    for (const row of arState.rows) {
      if (!row.valid) {
        row.selected = false;
        continue;
      }
      row.selected = checked;
    }
    const tbody = $("#arPreview tbody");
    if (tbody) {
      tbody.querySelectorAll('input[type="checkbox"][data-act="toggleRow"]').forEach((checkbox) => {
        const id = checkbox.dataset.id;
        const row = arState.rows.find((r) => r.id === id);
        if (!row) return;
        checkbox.checked = row.valid && row.selected;
      });
    }
    updateARImportButton();
    updateSelectAllState();
  };

  const handleARTableInput = (event) => {
    const target = event.target;
    if (!target.matches('[data-field]')) return;
    const id = target.dataset.id;
    const field = target.dataset.field;
    const row = arState.rows.find((r) => r.id === id);
    if (!row) return;
    const value = target.value;
    switch (field) {
      case "company":
        row.company = value;
        refreshARRow(row, { forceName: !row.manualName });
        break;
      case "invoice":
        row.invoice = value;
        refreshARRow(row, { forceName: !row.manualName });
        break;
      case "dueDate":
        row.dueDate = value;
        refreshARRow(row, { dueChanged: true, forceExpected: true });
        break;
      case "expectedDate":
        row.expectedDate = value;
        row.manualExpected = true;
        validateARRow(row);
        break;
      case "amount":
        row.amount = Number(value);
        row.manualAmount = true;
        validateARRow(row);
        break;
      case "name":
        row.name = value;
        row.manualName = true;
        validateARRow(row);
        break;
      default:
        break;
    }
    applyRowToDOM(row);
    updateARImportButton();
    updateSelectAllState();
  };

  const handleARTableChange = (event) => {
    const target = event.target;
    if (target.matches('input[type="checkbox"][data-act="toggleRow"]')) {
      const id = target.dataset.id;
      const row = arState.rows.find((r) => r.id === id);
      if (!row) return;
      if (!row.valid) {
        target.checked = false;
        row.selected = false;
      } else {
        row.selected = target.checked;
      }
      updateARImportButton();
      updateSelectAllState();
      return;
    }
    if (target.matches('[data-field]')) {
      handleARTableInput(event);
    }
  };

  const handleARPageClick = (event) => {
    const btn = event.target.closest('button[data-page]');
    if (!btn) return;
    const page = Number(btn.dataset.page);
    if (!Number.isFinite(page)) return;
    if (page < 1) return;
    const perPage = arState.perPage || arState.rows.length;
    const totalPages = Math.max(1, Math.ceil(arState.rows.length / perPage));
    if (page > totalPages) return;
    arState.page = page;
    renderARPreview();
  };

  const handleARImport = () => {
    const selectedRows = arState.rows.filter((row) => row.valid && row.selected);
    if (!selectedRows.length) {
      updateARStatus("No rows selected for import.", "error");
      return;
    }
    const defaultCategory = (arState.options.category || "AR").trim() || "AR";
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of selectedRows) {
      const sourceKey = row.sourceKey || makeSourceKey(row.company, row.invoice);
      if (!sourceKey) {
        skipped += 1;
        row.selected = false;
        continue;
      }
      const expected = row.expectedDate && isValidYMDString(row.expectedDate) ? row.expectedDate : row.dueDate;
      if (!expected || !isValidYMDString(expected)) {
        skipped += 1;
        row.selected = false;
        continue;
      }
      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount === 0) {
        skipped += 1;
        row.selected = false;
        continue;
      }
      const name = row.name && row.name.trim() ? row.name.trim() : defaultARName(row.company, row.invoice);
      const existing = findOneOffBySourceKey(sourceKey);
      const entry = {
        id: existing?.id || uid(),
        date: expected,
        type: "income",
        name,
        category: amount < 0 ? "AR Credit" : defaultCategory,
        amount: round2(amount),
        source: "AR",
        sourceKey,
      };
      if (existing) {
        Object.assign(existing, entry);
        updated += 1;
      } else {
        STATE.oneOffs.push(entry);
        added += 1;
      }
      row.action = "update";
      row.sourceKey = sourceKey;
      row.selected = false;
    }
    if (added || updated) {
      save(STATE);
      recalcAndRender();
    }
    arState.summary = { added, updated, skipped };
    renderARPreview();
    if (added || updated) {
      updateARStatus(`Import complete: ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}.`, "success");
    } else {
      updateARStatus(skipped ? `Nothing imported. ${skipped} rows skipped.` : "Nothing to import.", "error");
    }
  };

  const initARImporter = () => {
    const rollSelect = $("#arRoll");
    if (!rollSelect) return;
    const lagInput = $("#arLag");
    const confInput = $("#arConf");
    const categoryInput = $("#arCategory");

    arState.options.roll = rollSelect.value || "forward";
    arState.options.lag = Number(lagInput?.value || 0) || 0;
    const confValue = clamp(Number(confInput?.value || 100) || 0, 0, 100);
    arState.options.conf = confValue;
    if (confInput) confInput.value = confValue;
    arState.options.category = categoryInput?.value || "AR";

    rollSelect.addEventListener("change", (e) => {
      arState.options.roll = e.target.value || "forward";
    });
    lagInput?.addEventListener("change", () => {
      const val = Number(lagInput.value || 0);
      const normalized = Number.isFinite(val) ? Math.max(0, Math.trunc(val)) : 0;
      arState.options.lag = normalized;
      lagInput.value = normalized;
    });
    confInput?.addEventListener("change", () => {
      const val = Number(confInput.value || 0);
      const normalized = clamp(Number.isFinite(val) ? val : 0, 0, 100);
      arState.options.conf = normalized;
      confInput.value = normalized;
    });
    categoryInput?.addEventListener("input", () => {
      arState.options.category = categoryInput.value;
    });

    const importBtn = $("#arImportBtn");
    if (importBtn) importBtn.dataset.baseLabel = importBtn.textContent || "Import";

    $("#arParseBtn")?.addEventListener("click", handleARParse);
    $("#arRecalcBtn")?.addEventListener("click", () => {
      if (!arState.rows.length) {
        updateARStatus("Nothing to recalculate yet.", "error");
        return;
      }
      recalcARRows({ force: true });
      renderARPreview();
      updateARStatus("Recalculated using current options.", "success");
    });
    $("#arImportBtn")?.addEventListener("click", handleARImport);
    $("#arSelectAll")?.addEventListener("change", handleARSelectAll);
    const previewTable = $("#arPreview");
    previewTable?.addEventListener("input", handleARTableInput);
    previewTable?.addEventListener("change", handleARTableChange);
    $("#arPagination")?.addEventListener("click", handleARPageClick);
  };


// ---------- Recurrence engine ----------
const isBetween = (d, start, end) => d >= start && d <= end;

const lastDayOfMonth = (y, mIndex) => new Date(y, mIndex + 1, 0).getDate(); // 0 => last day prev month
const occursMonthly = (date, dayOfMonth) => {
  const ld = lastDayOfMonth(date.getFullYear(), date.getMonth());
  const target = clamp(dayOfMonth, 1, ld);
  return date.getDate() === target;
};

// NEW: "nth weekday of month" matcher (e.g., 3rd Fri, last Wed)
const occursNthWeekday = (date, nth, weekday) => {
  const nthValue = normalizeNth(nth);            // "1".."5" or "last"
  const targetDow = firstWeekday(weekday, 0);    // 0..6
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstDow = firstOfMonth.getDay();
  const firstOccurrenceDay = 1 + ((targetDow - firstDow + 7) % 7);

  const occurrences = [];
  const lastDay = lastDayOfMonth(date.getFullYear(), date.getMonth());
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

const occursWeeklyOn = (date, weekdays) => {
  const days = toWeekdayArray(weekdays);
  if (!days.length) return false;
  return days.includes(date.getDay());
};


  const occursBiweeklyOn = (date, weekdays, startDate) => {
    const days = toWeekdayArray(weekdays);
    if (!days.length) return false;
    return days.some((dow) => {
      if (date.getDay() !== dow) return false;
      const anchor = new Date(startDate.getTime());
      const deltaToDOW = (dow - anchor.getDay() + 7) % 7;
      anchor.setDate(anchor.getDate() + deltaToDOW); // first scheduled day for this DOW
      if (date < anchor) return false;
      const diffDays = Math.floor((date - anchor) / (1000 * 60 * 60 * 24));
      return diffDays % 14 === 0;
    });
  };

  const shouldApplyStreamOn = (date, stream) => {
    const d = date;
    const s = fromYMD(stream.startDate);
    const e = fromYMD(stream.endDate);
    if (!isBetween(d, s, e)) return false;

    switch (stream.frequency) {
      case "once":
        return stream.onDate && toYMD(d) === stream.onDate;
      case "daily":
        if (stream.skipWeekends && (d.getDay() === 0 || d.getDay() === 6)) return false;
        return true;
      case "weekly":
        return occursWeeklyOn(d, stream.dayOfWeek);
      case "biweekly":
        return occursBiweeklyOn(d, stream.dayOfWeek, s);
      case "monthly":
        if (stream.monthlyMode === "nth") {
          return occursNthWeekday(d, stream.nthWeek, stream.nthWeekday);
        }
        return occursMonthly(d, Number(stream.dayOfMonth || 1));
      default:
        return false;
    }
  };

  const shouldApplyTransactionOn = (date, tx) => {
    if (!tx || typeof tx !== "object") return false;
    const repeats = Boolean(tx.repeats);
    if (!repeats) {
      return toYMD(date) === tx.date;
    }

    if (!tx.frequency || !tx.startDate || !tx.endDate) return false;

const shim = {
  frequency: tx.frequency,
  startDate: tx.startDate,
  endDate: tx.endDate,
  onDate: tx.onDate || null,
  skipWeekends: Boolean(tx.skipWeekends),
  dayOfWeek: toWeekdayArray(tx.dayOfWeek),                 // normalize to [0..6]
  dayOfMonth: Number(tx.dayOfMonth ?? 1),
  monthlyMode: tx.monthlyMode === "nth" ? "nth" : "day",   // supports “nth weekday”
  nthWeek: normalizeNth(tx.nthWeek),                       // "1".."5" or "last"
  nthWeekday: firstWeekday(tx.nthWeekday ?? tx.dayOfWeek ?? 0, 0), // picks a valid DOW
};

    return shouldApplyStreamOn(date, shim);
  };

  // ---------- Projection ----------
  const generateCalendar = (startYMD, endYMD) => {
    const start = fromYMD(startYMD);
    const end = fromYMD(endYMD);
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push({
        date: toYMD(d),
        income: 0,
        expenses: 0,
        net: 0,
        running: 0,
        incomeDetails: [],
        expenseDetails: [],
      });
    }
    return days;
  };

  const computeProjection = (state) => {
    const { settings, oneOffs, incomeStreams, adjustments } = state;
    const cal = generateCalendar(settings.startDate, settings.endDate);
    const recurring = oneOffs.filter((tx) => tx && typeof tx === "object" && tx.recurring);
    const singles = oneOffs.filter((tx) => tx && typeof tx === "object" && !tx.recurring);
    let totalStreamIncome = 0;

    // Accumulate one-offs by exact date
    const byDate = new Map(cal.map((row) => [row.date, row]));

    for (const tx of singles) {
      const row = byDate.get(tx.date);
      if (!row) continue;
      const amt = Number(tx.amount || 0);
      if (!amt) continue;
      const absAmt = Math.abs(amt);
      const label = describeNameAndCategory(tx, tx.type === "expense" ? "Expense" : "Income");
      if (tx.type === "expense") {
        row.expenses += absAmt;
        row.expenseDetails.push({ source: label, amount: absAmt });
      } else {
        row.income += absAmt;
        row.incomeDetails.push({ source: label, amount: absAmt });
      }
    }

    // Apply recurring income streams
    const incomeLastOccurrence = new Map();
    for (const st of incomeStreams) {
      if (!st || typeof st !== "object") continue;
      const streamId = typeof st.id === "string" ? st.id : (st.id = uid());
      const key = `stream:${streamId}`;
      for (const row of cal) {
        const d = fromYMD(row.date);
        if (!shouldApplyStreamOn(d, st)) continue;
        const prev = incomeLastOccurrence.get(key) || null;
        const amount = resolveRecurringAmount(st, d, prev);
        if (amount) {
          const absAmount = Math.abs(amount);
          row.income += absAmount;
          const label = describeNameAndCategory(st, "Income Stream");
          row.incomeDetails.push({ source: label, amount: absAmount });
          totalStreamIncome += absAmount;
        }
        incomeLastOccurrence.set(key, new Date(d.getTime()));
      }
    }

    // Apply recurring one-offs
    const txLastOccurrence = new Map();
    for (const tx of recurring) {
      if (typeof tx.startDate !== "string" || typeof tx.endDate !== "string" || typeof tx.frequency !== "string") {
        continue;
      }
      const txId = typeof tx.id === "string" ? tx.id : (tx.id = uid());
      const key = `tx:${txId}`;
      for (const row of cal) {
        const d = fromYMD(row.date);
        if (shouldApplyStreamOn(d, tx)) {
          const prev = txLastOccurrence.get(key) || null;
          const amount = resolveRecurringAmount(tx, d, prev);
          if (amount) {
            const absAmount = Math.abs(amount);
            const label = describeNameAndCategory(tx, tx.type === "expense" ? "Expense" : "Income");
            if (tx.type === "expense") {
              row.expenses += absAmount;
              row.expenseDetails.push({ source: label, amount: absAmount });
            } else {
              row.income += absAmount;
              row.incomeDetails.push({ source: label, amount: absAmount });
            }
          }
          txLastOccurrence.set(key, new Date(d.getTime()));
        }
      }
    }

    // Adjustments (can be positive or negative)
    for (const adj of adjustments) {
      const row = byDate.get(adj.date);
      if (row) {
        const amt = Number(adj.amount || 0);
        if (amt >= 0) {
          row.income += amt;
          const label = adj.note ? `Adjustment – ${adj.note}` : "Adjustment";
          row.incomeDetails.push({ source: label, amount: amt });
        } else {
          const absAmt = Math.abs(amt);
          row.expenses += absAmt;
          const label = adj.note ? `Adjustment – ${adj.note}` : "Adjustment";
          row.expenseDetails.push({ source: label, amount: absAmt });
        }
      }
    }

    // Net + running
    let running = Number(settings.startingBalance || 0);
    let totalIncome = 0;
    let totalExpenses = 0;
    let lowestBalance = Number(settings.startingBalance || 0);
    if (!Number.isFinite(lowestBalance)) lowestBalance = 0;
    let lowestBalanceDate = settings.startDate || (cal.length ? cal[0].date : "");
    let peakBalance = lowestBalance;
    let peakBalanceDate = lowestBalanceDate;
    let firstNegativeDate = null;
    let negativeDays = 0;

    for (const row of cal) {
      row.net = row.income - row.expenses;
      running += row.net;
      row.running = running;
      totalIncome += row.income;
      totalExpenses += row.expenses;

      if (row.running < lowestBalance) {
        lowestBalance = row.running;
        lowestBalanceDate = row.date;
      }
      if (row.running > peakBalance) {
        peakBalance = row.running;
        peakBalanceDate = row.date;
      }
      if (row.running < 0) {
        negativeDays += 1;
        if (!firstNegativeDate) firstNegativeDate = row.date;
      }
    }

    let projectedWeeklyIncome = 0;
    const startDate = fromYMD(settings.startDate);
    const endDate = fromYMD(settings.endDate);
    if (
      startDate instanceof Date &&
      endDate instanceof Date &&
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate >= startDate
    ) {
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const totalDays = Math.floor((endDate - startDate) / MS_PER_DAY) + 1;
      const totalWeeks = totalDays / 7;
      if (totalWeeks > 0) {
        projectedWeeklyIncome = totalStreamIncome / totalWeeks;
      }
    }

    return {
      cal,
      totalIncome,
      totalExpenses,
      endBalance: running,
      projectedWeeklyIncome,
      lowestBalance,
      lowestBalanceDate,
      peakBalance,
      peakBalanceDate,
      firstNegativeDate,
      negativeDays,
    };
  };

  // ---------- Rendering ----------
  // Tabs
  const bindTabs = () => {
    $$(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab").forEach((b) => b.classList.remove("active"));
        $$(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $("#" + btn.dataset.tab).classList.add("active");
      });
    });
  };

  // Settings form
  const renderSettingsForm = () => {
    if (!STATE.settings) STATE.settings = defaultState().settings;
    const settings = STATE.settings;
    $("#startDate").value = settings.startDate || todayYMD;
    $("#endDate").value = settings.endDate || defaultEnd;
    $("#startingBalance").value = Number(settings.startingBalance || 0);
  };

  const initSettings = () => {
    renderSettingsForm();

    $("#settingsForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const startDate = $("#startDate").value || todayYMD;
      const endDate = $("#endDate").value || defaultEnd;
      const startingBalance = Number($("#startingBalance").value || 0);
      STATE.settings = { startDate, endDate, startingBalance };
      save(STATE);
      recalcAndRender();
    });
  };

  // Adjustments
  const renderAdjustments = () => {
    const tbody = $("#adjTable tbody");
    tbody.innerHTML = "";
    const rows = [...STATE.adjustments].sort((a, b) => a.date.localeCompare(b.date));
    for (const a of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${a.date}</td>
        <td class="num">${fmtMoney(Number(a.amount || 0))}</td>
        <td>${a.note || ""}</td>
        <td><button class="link" data-id="${a.id}" data-act="delAdj">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }
  };

  const bindAdjustments = () => {
    $("#adjForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const date = $("#adjDate").value;
      const amount = Number($("#adjAmount").value || 0);
      const note = $("#adjNote").value.trim();
      if (!date || isNaN(amount)) return;
      STATE.adjustments.push({ id: uid(), date, amount, note });
      save(STATE);
      $("#adjForm").reset();
      recalcAndRender();
    });

    $("#adjTable").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act='delAdj']");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      STATE.adjustments = STATE.adjustments.filter((a) => a.id !== id);
      save(STATE);
      recalcAndRender();
    });
  };

  // One-offs
  const describeMonthlySchedule = (item) => {
    if (!item || typeof item !== "object") return "Monthly";
    if (item.monthlyMode === "nth") {
      const nth = normalizeNth(item.nthWeek);
      const nthLabel = describeNth(nth);
      const weekday = firstWeekday(item.nthWeekday ?? item.dayOfWeek ?? 0, 0);
      return `Monthly on the ${nthLabel} ${getDOWLabel(weekday)}`;
    }
    const day = clamp(Number(item.dayOfMonth ?? 1), 1, 31);
    return `Monthly on day ${day}`;
  };

  const describeTransactionSchedule = (tx) => {
    if (!tx || typeof tx !== "object") return "—";

    const repeats = Boolean(tx.repeats ?? tx.recurring ?? tx.frequency);
    if (!repeats) return "—";

    const frequency = tx.frequency;
    if (!frequency) return "Repeats";

    const start = tx.startDate || tx.date || null;
    const end = tx.endDate || tx.date || null;
    const range = start && end ? ` (${start} → ${end})` : "";

    let desc = "";
    switch (frequency) {
      case "daily":
        desc = `Daily${tx.skipWeekends ? " (M–F)" : ""}${range}`;
        break;
      case "weekly":
        desc = `Weekly on ${getDOWLabel(tx.dayOfWeek)}${range}`;
        break;
      case "biweekly":
        desc = `Every 2 weeks on ${getDOWLabel(tx.dayOfWeek)}${range}`;
        break;
      case "monthly": {
        const day = clamp(Number(tx.dayOfMonth ?? 1), 1, 31);
        desc = `Monthly on day ${day}${range}`;
        break;
      }
      case "once": {
        const when = tx.onDate || tx.date || start;
        desc = when ? `On ${when}` : "Once";
        break;
      }
      default:
        desc = `Repeats${range}`;
        break;
    }

    const extras = [];
    if (Array.isArray(tx.steps) && tx.steps.length) extras.push("stepped");
    const escalator = Number(tx.escalatorPct || 0);
    if (escalator) extras.push(`${escalator}% escalator`);
    if (extras.length) desc += ` [${extras.join(", ")}]`;

    return desc;
  };

  const renderOneOffs = () => {
    const tbody = $("#oneOffTable tbody");
    tbody.innerHTML = "";

    const rows = [...(STATE.oneOffs || [])]
      .filter((tx) => tx && typeof tx === "object")
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    for (const tx of rows) {
      const nextLabel = (() => {
        const next = getNextOccurrence(tx, todayYMD);
        if (!next) return "—";
        return `${fmtMoney(next.amount)} (${next.date})`;
      })();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tx.date || ""}</td>
        <td>${describeTransactionSchedule(tx)}</td>
        <td>${tx.type || ""}</td>
        <td>${tx.name || ""}</td>
        <td>${tx.category || ""}</td>
        <td class="num">${nextLabel}</td>
        <td><button class="link" data-id="${tx.id}" data-act="delOneOff">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }
  };

  const applyMonthlyModeVisibility = (select) => {
    if (!select) return;
    const form = select.closest("form");
    if (!form) return;
    const mode = select.value === "nth" ? "nth" : "day";
    form.querySelectorAll(".monthly-mode").forEach((el) => el.classList.add("hidden"));
    form
      .querySelectorAll(`.monthly-mode-${mode}`)
      .forEach((el) => el.classList.remove("hidden"));
  };

  const showTransactionFreqBlocks = () => {
    const form = $("#oneOffForm");
    if (!form) return;
    const repeats = $("#ooRepeats").checked;
    const recurringFields = $$(".tx-recurring-only", form);
    const freqFields = $$(".tx-freq-only", form);

    if (!repeats) {
      recurringFields.forEach((el) => el.classList.add("hidden"));
      freqFields.forEach((el) => el.classList.add("hidden"));
      return;
    }

    recurringFields.forEach((el) => el.classList.remove("hidden"));
    freqFields.forEach((el) => el.classList.add("hidden"));

    const freq = $("#ooFreq").value;
    $$(".tx-freq-" + freq, form).forEach((el) => el.classList.remove("hidden"));

    if (freq === "monthly") {
      applyMonthlyModeVisibility($("#ooMonthlyMode"));
    }

    const baseDate = $("#ooDate").value;
    if (baseDate) {
      const startInput = $("#ooStart");
      const endInput = $("#ooEnd");
      if (startInput && !startInput.value) startInput.value = baseDate;
      if (endInput && !endInput.value) endInput.value = baseDate;
    }
  };

  const addStepRow = (root, data = {}) => {
    if (!root) return;
    const tbody = root.querySelector("tbody");
    if (!tbody) return;
    const tr = document.createElement("tr");
    tr.className = "step-row";
    const effectiveFrom = typeof data.effectiveFrom === "string" ? data.effectiveFrom : "";
    const amountValue = data.amount !== undefined && data.amount !== null ? Number(data.amount) : "";
    tr.innerHTML = `
      <td><input type="date" class="step-date" value="${effectiveFrom}" /></td>
      <td class="num"><input type="number" class="step-amount" step="0.01" value="${amountValue === "" ? "" : amountValue}" /></td>
      <td><button type="button" class="link" data-act="removeStep">Remove</button></td>
    `;
    tbody.appendChild(tr);
  };

  const collectStepRows = (root) => {
    if (!root) return [];
    const rows = $$(".step-row", root);
    return rows
      .map((row) => {
        const date = $(".step-date", row)?.value;
        const amountRaw = $(".step-amount", row)?.value;
        if (!date || amountRaw === undefined || amountRaw === null || amountRaw === "") return null;
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount)) return null;
        return { effectiveFrom: date, amount: Math.abs(amount) };
      })
      .filter((step) => step !== null)
      .sort((a, b) => compareYMD(a.effectiveFrom, b.effectiveFrom));
  };

  const clearStepRows = (root) => {
    if (!root) return;
    const tbody = root.querySelector("tbody");
    if (tbody) tbody.innerHTML = "";
  };

  const initStepEditor = (root) => {
    if (!root) return;
    root.addEventListener("click", (e) => {
      const removeBtn = e.target.closest("button[data-act='removeStep']");
      if (removeBtn) {
        removeBtn.closest(".step-row")?.remove();
        return;
      }
      const addBtn = e.target.closest("button[data-act='addStep']");
      if (addBtn) {
        addStepRow(root);
      }
    });
  };

  const bindOneOffs = () => {
    const form = $("#oneOffForm");
    const freqSel = $("#ooFreq");
    const repeatsToggle = $("#ooRepeats");
    if (!form || !freqSel || !repeatsToggle) return;

    initStepEditor($("#ooStepEditor"));

    repeatsToggle.addEventListener("change", showTransactionFreqBlocks);
    freqSel.addEventListener("change", showTransactionFreqBlocks);
    $("#ooMonthlyMode")?.addEventListener("change", (e) => {
      applyMonthlyModeVisibility(e.target);
    });
    const dateInput = $("#ooDate");
    dateInput?.addEventListener("change", () => {
      if (!repeatsToggle.checked) return;
      const baseDate = dateInput.value;
      if (!baseDate) return;
      const startInput = $("#ooStart");
      const endInput = $("#ooEnd");
      if (startInput && !startInput.value) startInput.value = baseDate;
      if (endInput && !endInput.value) endInput.value = baseDate;
    });
    showTransactionFreqBlocks();

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const repeats = repeatsToggle.checked;
      const date = $("#ooDate").value;
      const type = $("#ooType").value;
      const name = $("#ooName").value.trim();
      const category = $("#ooCategory").value.trim();
      const amount = Number($("#ooAmount").value || 0);
      if (!date || !name || Number.isNaN(amount)) return;

      const entry = {
        id: uid(),
        date,
        type,
        name,
        category,
        amount: Math.abs(amount),
      };

      if (repeats) {
        const frequency = $("#ooFreq").value;
        const startDate = $("#ooStart").value;
        const endDate = $("#ooEnd").value;
        if (!frequency || !startDate || !endDate) return;

        entry.repeats = true;
        entry.recurring = true;
        entry.frequency = frequency;
        entry.startDate = startDate;
        entry.endDate = endDate;
        entry.skipWeekends = $("#ooSkipWeekends").checked;

        if (frequency === "weekly" || frequency === "biweekly") {
          const weekdays = readWeekdaySelections($("#ooDOW"));
          if (!weekdays.length) return;
          entry.dayOfWeek = weekdays;
        }
        if (frequency === "monthly") {
          const modeSel = $("#ooMonthlyMode");
          const mode = modeSel && modeSel.value === "nth" ? "nth" : "day";
          entry.monthlyMode = mode;
          if (mode === "nth") {
            entry.nthWeek = normalizeNth($("#ooNthWeek").value);
            entry.nthWeekday = clamp(Number($("#ooNthWeekday").value || 0), 0, 6);
          } else {
            entry.dayOfMonth = clamp(Number($("#ooDOM").value || 1), 1, 31);
          }
        }

        entry.steps = collectStepRows($("#ooStepEditor"));
        const escalatorRaw = Number($("#ooEscalator").value || 0);
        entry.escalatorPct = Number.isFinite(escalatorRaw) ? escalatorRaw : 0;
      } else {
        entry.steps = [];
        entry.escalatorPct = 0;
      }

      STATE.oneOffs.push(entry);

      save(STATE);
      form.reset();
      showTransactionFreqBlocks();
      clearStepRows($("#ooStepEditor"));
      $("#ooEscalator").value = "";
      recalcAndRender();
    });

    $("#oneOffTable").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act='delOneOff']");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      STATE.oneOffs = STATE.oneOffs.filter((t) => t.id !== id);
      save(STATE);
      recalcAndRender();
    });
  };

  // Streams
  const showFreqBlocks = () => {
    const val = $("#stFreq").value;
    $$(".freq-only").forEach((el) => el.classList.add("hidden"));
    $$(".freq-" + val).forEach((el) => el.classList.remove("hidden"));
    if (val === "monthly") {
      applyMonthlyModeVisibility($("#stMonthlyMode"));
    }
  };

  const renderStreams = () => {
    const tbody = $("#streamsTable tbody");
    tbody.innerHTML = "";
    const rows = [...STATE.incomeStreams].sort((a, b) => a.name.localeCompare(b.name));
    for (const st of rows) {
      const schedule = describeTransactionSchedule(st);
      const next = getNextOccurrence(st, todayYMD);
      const nextLabel = next ? `${fmtMoney(next.amount)} (${next.date})` : "—"
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${st.name}</td>
        <td>${st.category || ""}</td>
        <td>${st.frequency}</td>
        <td>${schedule}</td>
        <td class="num">${nextLabel}</td>
        <td>${st.startDate} → ${st.endDate}</td>
        <td><button class="link" data-id="${st.id}" data-act="delStream">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }
  };

  const bindStreams = () => {
    initStepEditor($("#stStepEditor"));
    $("#stFreq").addEventListener("change", showFreqBlocks);
    $("#stMonthlyMode")?.addEventListener("change", (e) => {
      applyMonthlyModeVisibility(e.target);
    });
    showFreqBlocks();

    $("#streamForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#stName").value.trim();
      const category = $("#stCategory").value.trim();
      const amount = Number($("#stAmount").value || 0);
      const frequency = $("#stFreq").value;
      const startDate = $("#stStart").value;
      const endDate = $("#stEnd").value;
      if (!name || isNaN(amount) || !startDate || !endDate) return;

      const dowSelect = $("#stDOW");
      const weekdays = readWeekdaySelections(dowSelect);

      const stream = {
        id: uid(),
        name, category,
        amount: Math.abs(amount),
        frequency,
        startDate,
        endDate,
        onDate: null,
        skipWeekends: false,
        dayOfWeek: weekdays,
        dayOfMonth: 1,
        monthlyMode: "day",
        nthWeek: "1",
        nthWeekday: firstWeekday(weekdays, 0),
      };

      if (frequency === "once") {
        stream.onDate = $("#stOnDate").value;
        if (!stream.onDate) return;
      }
      if (frequency === "daily") {
        stream.skipWeekends = $("#stSkipWeekends").checked;
      }
      if (frequency === "weekly" || frequency === "biweekly") {
        if (!weekdays.length) return;
      }
      if (frequency === "monthly") {
        const modeSel = $("#stMonthlyMode");
        const mode = modeSel && modeSel.value === "nth" ? "nth" : "day";
        stream.monthlyMode = mode;
        if (mode === "nth") {
          stream.nthWeek = normalizeNth($("#stNthWeek").value);
          stream.nthWeekday = clamp(Number($("#stNthWeekday").value || 0), 0, 6);
        } else {
          stream.dayOfMonth = clamp(Number($("#stDOM").value || 1), 1, 31);
        }
      }

      stream.steps = collectStepRows($("#stStepEditor"));
      const escalatorRaw = Number($("#stEscalator").value || 0);
      stream.escalatorPct = Number.isFinite(escalatorRaw) ? escalatorRaw : 0;

      STATE.incomeStreams.push(stream);
      save(STATE);
      $("#streamForm").reset();
      $("#stFreq").value = "once";
      showFreqBlocks();
      clearStepRows($("#stStepEditor"));
      $("#stEscalator").value = "";
      recalcAndRender();
    });

    $("#streamsTable").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act='delStream']");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      STATE.incomeStreams = STATE.incomeStreams.filter((s) => s.id !== id);
      save(STATE);
      recalcAndRender();
    });
  };

  // Chart + upcoming table + KPIs
  let balanceChart;

  const renderDashboard = () => {
    const {
      cal,
      totalIncome,
      totalExpenses,
      endBalance,
      projectedWeeklyIncome,
      lowestBalance,
      lowestBalanceDate,
      peakBalance,
      peakBalanceDate,
      firstNegativeDate,
      negativeDays,
    } = computeProjection(STATE);

    // KPIs
    $("#kpiEndBalance").textContent = fmtMoney(endBalance);
    $("#kpiIncome").textContent = fmtMoney(totalIncome);
    $("#kpiExpenses").textContent = fmtMoney(totalExpenses);
    const weeklyEl = $("#kpiWeeklyIncome");
    if (weeklyEl) weeklyEl.textContent = fmtMoney(projectedWeeklyIncome);
    const lowestEl = $("#kpiLowestBalance");
    if (lowestEl) lowestEl.textContent = fmtMoney(lowestBalance);
    const lowestDateEl = $("#kpiLowestDate");
    if (lowestDateEl) lowestDateEl.textContent = lowestBalanceDate ? `on ${fmtDate(lowestBalanceDate)}` : "—";
    const peakEl = $("#kpiPeakBalance");
    if (peakEl) peakEl.textContent = fmtMoney(peakBalance);
    const peakDateEl = $("#kpiPeakDate");
    if (peakDateEl) peakDateEl.textContent = peakBalanceDate ? `on ${fmtDate(peakBalanceDate)}` : "—";
    const negDaysEl = $("#kpiNegativeDays");
    if (negDaysEl) negDaysEl.textContent = String(negativeDays);
    const firstNegEl = $("#kpiFirstNegative");
    if (firstNegEl) firstNegEl.textContent = firstNegativeDate ? fmtDate(firstNegativeDate) : "—";

    // Chart data
    const labels = cal.map((r) => r.date);
    const data = cal.map((r) => Number(r.running.toFixed(2)));

    const canvasEl = $("#balanceChart");
    if (!canvasEl) return;

    const existingChart = typeof Chart?.getChart === "function"
      ? Chart.getChart(canvasEl)
      : null;
    if (existingChart) existingChart.destroy();

    if (balanceChart) {
      balanceChart.destroy();
      balanceChart = undefined;
    }

    const ctx = canvasEl.getContext("2d");
    const lineColors = {
      above: "#1b5e20",
      below: "#b71c1c"
    };
    balanceChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Projected Balance",
            data,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 0,
            borderColor: (ctx) => {
              const value = ctx?.parsed?.y;
              if (Number.isFinite(value) && value < 0) return lineColors.below;
              return lineColors.above;
            },
            segment: {
              borderColor: (ctx) => {
                const y0 = ctx?.p0?.parsed?.y;
                const y1 = ctx?.p1?.parsed?.y;
                if (!Number.isFinite(y0) || !Number.isFinite(y1)) return lineColors.above;
                if (y0 >= 0 && y1 >= 0) return lineColors.above;
                if (y0 <= 0 && y1 <= 0) return lineColors.below;
                return y1 >= 0 ? lineColors.above : lineColors.below;
              }
            },
            fill: {
              target: { value: 0 },
              above: "rgba(27, 94, 32, 0.15)",
              below: "rgba(183, 28, 28, 0.18)"
            }
          }
        ]
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 10 } },
          y: {
            beginAtZero: false,
            grid: {
              color: (ctx) => {
                const value = ctx.tick && typeof ctx.tick.value === "number" ? ctx.tick.value : null;
                return value === 0 ? "#0f172a" : "rgba(148, 163, 184, 0.2)";
              },
              lineWidth: (ctx) => {
                const value = ctx.tick && typeof ctx.tick.value === "number" ? ctx.tick.value : null;
                return value === 0 ? 2 : 1;
              }
            }
          }
        }
      }
    });

    // Upcoming 14 days
    const tbody = $("#upcomingTable tbody");
    tbody.innerHTML = "";
    const next14 = cal.slice(0, 14);
    for (const r of next14) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.date}</td>
        <td class="num">${fmtMoney(r.income)}</td>
        <td class="num">${fmtMoney(r.expenses)}</td>
        <td class="num">${fmtMoney(r.net)}</td>
        <td class="num">${fmtMoney(r.running)}</td>
      `;
      tbody.appendChild(tr);
    }
  };

  const recalcAndRender = () => {
    renderDashboard();
    renderAdjustments();
    renderOneOffs();
    renderStreams();
  };

  // ---------- Import / Export ----------
  const bindImportExport = () => {
    $("#exportBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cashflow-2025.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    $("#pdfBtn").addEventListener("click", () => {
      const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
      if (typeof jsPDF !== "function") {
        alert("PDF generator not available.");
        return;
      }

      const { cal } = computeProjection(STATE);
      const startYMD = todayYMD;
      const end = fromYMD(startYMD);
      end.setDate(end.getDate() + 29);
      const endYMD = toYMD(end);
      const next30 = cal.filter((row) => compareYMD(row.date, startYMD) >= 0 && compareYMD(row.date, endYMD) <= 0);

      if (!next30.length) {
        alert("No projection data for the next 30 days.");
        return;
      }

      const doc = new jsPDF({ orientation: "landscape" });
      if (typeof doc.autoTable !== "function") {
        alert("PDF table plugin not available.");
        return;
      }
      doc.setFontSize(16);
      doc.text("Next 30 Days Cash Flow", 14, 15);
      doc.setFontSize(10);
      doc.text(`Generated on ${startYMD}`, 14, 22);

      const tableBody = next30.map((row) => {
        const incomeDetails = Array.isArray(row.incomeDetails) && row.incomeDetails.length
          ? row.incomeDetails.map((item) => `${item.source}: ${fmtMoney(item.amount)}`).join("\n")
          : "—";
        const expenseDetails = Array.isArray(row.expenseDetails) && row.expenseDetails.length
          ? row.expenseDetails.map((item) => `${item.source}: ${fmtMoney(item.amount)}`).join("\n")
          : "—";
        return [
          row.date,
          fmtMoney(row.income),
          incomeDetails,
          fmtMoney(row.expenses),
          expenseDetails,
          fmtMoney(row.running),
        ];
      });

      doc.autoTable({
        startY: 28,
        head: [["Date", "Income", "Income Sources", "Expenses", "Expense Sources", "Bank Balance"]],
        body: tableBody,
        styles: { valign: "top", fontSize: 9 },
        columnStyles: {
          2: { cellWidth: 70 },
          4: { cellWidth: 70 },
        },
        headStyles: { fillColor: [15, 23, 42] },
      });

      doc.save(`cashflow-next-30-days-${startYMD}.pdf`);
    });

    const dlg = $("#importDialog");
    $("#importBtn").addEventListener("click", () => dlg.showModal());
    $("#confirmImportBtn").addEventListener("click", (e) => {
      e.preventDefault();
      try {
        const parsed = JSON.parse($("#importText").value);
        let nextState;
        try {
          nextState = normalizeState(parsed, { strict: true });
        } catch (strictErr) {
          nextState = normalizeState(parsed);
          console.warn("Import used compatibility mode", strictErr);
        }
        STATE = nextState;
        save(STATE);
        dlg.close();
        renderSettingsForm();
        recalcAndRender();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        alert("Import failed: " + message);
      }
    });
    dlg.addEventListener("close", () => ($("#importText").value = ""));
  };

  // ---------- Init ----------
  const init = () => {
    bindTabs();
    bindImportExport();
    initSettings();
    bindAdjustments();
    bindOneOffs();
    bindStreams();
    initARImporter();

    // Ensure defaults if missing
    if (!STATE.settings.endDate) STATE.settings.endDate = defaultEnd;
    save(STATE);

    recalcAndRender();
  };

  document.addEventListener("DOMContentLoaded", init);
})();
