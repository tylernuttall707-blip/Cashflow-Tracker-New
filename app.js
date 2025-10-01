import {
  todayYMD,
  toYMD,
  fromYMD,
  addDays,
  rollWeekend,
  parseExcelOrISODate,
  compareYMD,
  monthsBetween,
  getDOWLabel,
  normalizeNth,
  describeNth,
  toWeekdayArray,
  firstWeekday,
  formatWeekdayList,
  readWeekdaySelections,
} from "./utils/dates.js";
import {
  fmtMoney,
  fmtDate,
  escapeHtml,
  round2,
  fmtCount,
  parseCurrency,
  clamp,
  compareText,
  describeNameAndCategory,
  uid,
  deepClone,
} from "./utils/formatting.js";
import {
  DEFAULT_CONFIG,
  defaultState,
  defaultOneOffSortState,
  sanitizeOneOffSortState,
  isValidYMDString,
  createSaleEntry,
  normalizeState,
  loadState,
  saveState,
  clampPercent,
  clampCurrency,
  computeEffectiveAmount,
  resolvePercentFromEffective,
  cloneStateForSandbox,
  getStreamById,
  getStreamBaseAmount,
  sanitizeWhatIfState,
  loadWhatIf,
  saveWhatIf,
  STORAGE_KEYS,
} from "./state/management.js";
import { createDashboardRenderer } from "./components/dashboard.js";
import { createWhatIfRenderer } from "./components/whatif.js";

/* 2025 Cash Flow — all client-side, localStorage powered */

(() => {
  "use strict";

  // ---------- Utilities ----------
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

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

  // ---------- Storage ----------

  const ONE_OFF_SORT_KEYS = ["date", "schedule", "type", "name", "category", "next"];
  const defaultEnd = DEFAULT_CONFIG.END_DATE;
  const saleUIState = new Map();

  const createSaleDraftFromEntry = (entry) => ({
    name: typeof entry.name === "string" ? entry.name : "",
    pct: String(Math.round((Number(entry.pct) || 0) * 100)),
    topup: Number.isFinite(Number(entry.topup)) ? Number(entry.topup).toFixed(2) : "0.00",
    startDate: entry.startDate || "",
    endDate: entry.endDate || "",
    businessDaysOnly: Boolean(entry.businessDaysOnly),
    lastEdited: entry.lastEdited === "topup" ? "topup" : "pct",
  });

  const ensureSaleUIState = (entry) => {
    if (!entry || typeof entry.id !== "string") return null;
    let state = saleUIState.get(entry.id);
    if (!state) {
      state = { isEditing: false, draft: createSaleDraftFromEntry(entry) };
      saleUIState.set(entry.id, state);
    } else if (!state.isEditing) {
      state.draft = createSaleDraftFromEntry(entry);
    }
    return state;
  };

  const ensureWhatIfStreamTweak = (streamId) => {
    if (!WHATIF || typeof WHATIF !== "object") WHATIF = { base: cloneStateForSandbox(STATE), tweaks: {} };
    if (!WHATIF.tweaks || typeof WHATIF.tweaks !== "object") WHATIF.tweaks = {};
    if (!WHATIF.tweaks.streams || typeof WHATIF.tweaks.streams !== "object") WHATIF.tweaks.streams = {};
    if (!WHATIF.tweaks.streams[streamId]) {
      WHATIF.tweaks.streams[streamId] = { pct: 0, delta: 0, effective: null, weeklyTarget: null, lastEdited: "pct" };
    }
    return WHATIF.tweaks.streams[streamId];
  };

  const evaluateWhatIfStream = (stream, entry, occurrenceBase, globalTweaks) => {
    const baseAmount = Math.abs(Number(occurrenceBase || 0));
    const globalAdjusted = computeEffectiveAmount(baseAmount, globalTweaks.pct, globalTweaks.delta);
    if (entry.lastEdited === "weekly") {
      const occurrences = estimateOccurrencesPerWeek(stream);
      if (entry.weeklyTarget !== null && occurrences > 0) {
        return round2(entry.weeklyTarget / occurrences);
      }
    }
    if (entry.lastEdited === "effective" && entry.effective !== null) {
      return round2(entry.effective);
    }
    return computeEffectiveAmount(globalAdjusted, entry.pct, entry.delta);
  };

  let STATE = loadState();
  let WHATIF = loadWhatIf(STATE);

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

  const next = { ...tx };

  if (next.dayOfWeek !== undefined) {
    next.dayOfWeek = toWeekdayArray(next.dayOfWeek);
  }

  if (next.source === "AR") {
    next.status = next.status === "archived" ? "archived" : "pending";
    if (next.lastSeenAt) {
      next.lastSeenAt = String(next.lastSeenAt);
    } else {
      next.lastSeenAt = next.lastSeenAt ?? null;
    }
  }

  return next;
});


  let editingOneOffId = null;


  // ---------- Receivables importer helpers ----------
  const normalizeHeaderLabel = (value) =>
    String(value ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const COMPANY_HEADER_CANDIDATES = [
    "customer",
    "distributor",
    "company",
    "bill to",
    "sold to",
    "cmo name",
    "cmoname",
  ];
  const INVOICE_HEADER_CANDIDATES = [
    "invoice",
    "inv #",
    "doc #",
    "document",
    "reference",
    "ref",
    "arp invoice id",
    "arparinvoiceid",
  ];
  const DUE_HEADER_CANDIDATES = [
    "due",
    "due date",
    "due_dt",
    "net due",
    "maturity",
    "due date (net)",
    "arp due date",
    "arpduedate",
  ];
  const AMOUNT_HEADER_CANDIDATES = [
    "open amount",
    "balance",
    "amt due",
    "amount",
    "outstanding",
    "open bal",
    "arp invoice balance base",
    "arpinvoicebalancebase",
  ];
  const TERMS_HEADER_CANDIDATES = [
    "terms",
    "payment terms",
    "net terms",
    "terms description",
    "arp payment term id",
    "arppaymenttermid",
  ];
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
    "arp invoice date",
    "arpinvoicedate",
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

  const collapseAlphaNumeric = (value) => {
    if (value === null || value === undefined) return "";
    return String(value)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  };
  const normalizeCompanyKey = (value) => collapseAlphaNumeric(value);
  const normalizeInvoiceKey = (value) => collapseAlphaNumeric(value);
  const makeSourceKey = (company, invoice) => {
    const normCompany = normalizeCompanyKey(company);
    const normInvoice = normalizeInvoiceKey(invoice);
    if (!normCompany || !normInvoice) return null;
    return `${normCompany}#${normInvoice}`;
  };

  const findInvoiceFromText = (text) => {
    if (!text) return "";
    const str = String(text);
    const patterns = [
      /INV(?:OICE)?\s*(?:NUMBER|NO\.|NUM|#|:)?\s*([A-Z0-9-]+)/i,
      /#\s*([A-Z0-9-]{3,})/g,
    ];
    for (const pattern of patterns) {
      if (pattern.global) {
        let match = null;
        while ((match = pattern.exec(str))) {
          if (match && match[1]) {
            const candidate = normalizeInvoiceKey(match[1]);
            if (candidate) return candidate;
          }
        }
        continue;
      }
      const match = pattern.exec(str);
      if (match && match[1]) {
        const candidate = normalizeInvoiceKey(match[1]);
        if (candidate) return candidate;
      }
    }
    return "";
  };

  const findCompanyFromName = (text) => {
    if (!text) return "";
    const str = String(text);
    const match = str.match(/\(([^)]+)\)/);
    if (match && match[1]) {
      const normalized = normalizeCompanyKey(match[1]);
      if (normalized) return normalized;
    }
    const invoiceLead = str.match(/^(.*?)(?:INV(?:OICE)?\b|#)/i);
    if (invoiceLead && invoiceLead[1]) {
      let candidate = invoiceLead[1].trim();
      candidate = candidate.replace(/^income\s*/i, "");
      candidate = candidate.replace(/^[^A-Z0-9]+/i, "");
      candidate = candidate.replace(/[^A-Z0-9]+$/i, "");
      const normalized = normalizeCompanyKey(candidate);
      if (normalized && normalized !== "INCOME") return normalized;
    }
    return "";
  };

  const deriveCashMovementKey = (entry) => {
    if (!entry) return null;
    if (entry.sourceKey) return entry.sourceKey;

    const companyCandidates = [];
    const pushCompany = (value) => {
      const normalized = normalizeCompanyKey(value);
      if (normalized) companyCandidates.push(normalized);
    };
    pushCompany(entry.company);
    pushCompany(entry.customer);
    pushCompany(entry.customerName);
    pushCompany(entry.client);
    pushCompany(entry.clientName);
    pushCompany(entry.vendor);
    if (entry.name) {
      const fromName = findCompanyFromName(entry.name);
      if (fromName) companyCandidates.push(fromName);
    }

    const invoiceCandidates = [];
    const pushInvoice = (value) => {
      const normalized = normalizeInvoiceKey(value);
      if (normalized && /\d/.test(normalized)) invoiceCandidates.push(normalized);
    };
    pushInvoice(entry.invoice);
    pushInvoice(entry.invoiceNumber);
    pushInvoice(entry.reference);
    pushInvoice(entry.ref);
    pushInvoice(entry.poNumber);
    pushInvoice(entry.po);
    pushInvoice(entry.note);
    pushInvoice(entry.description);
    if (entry.name) {
      const fromName = findInvoiceFromText(entry.name);
      if (fromName) invoiceCandidates.push(fromName);
    }

    const uniqueCompanies = [...new Set(companyCandidates.filter(Boolean))];
    const uniqueInvoices = [...new Set(invoiceCandidates.filter(Boolean))];

    for (const company of uniqueCompanies) {
      for (const invoice of uniqueInvoices) {
        const key = makeSourceKey(company, invoice);
        if (key) return key;
      }
    }

    const invoiceOnly = uniqueInvoices[0];
    if (!invoiceOnly) return null;
    const amount = Math.abs(Number(entry.amount) || 0);
    const amountKey = amount ? String(round2(amount)) : "0";
    const dateKey = entry.date || entry.expectedDate || entry.dueDate || "";
    return `INVONLY#${invoiceOnly}#${amountKey}#${normalizeInvoiceKey(dateKey)}`;
  };

  const findOneOffBySourceKey = (key) => {
    if (!key) return undefined;
    return (STATE.oneOffs || []).find((tx) => tx && tx.source === "AR" && tx.sourceKey === key);
  };

  const scoreCashMovementStatus = (entry) => {
    if (!entry || entry.status === "archived") return 0;
    return 1;
  };

  const parseLastSeenAt = (value) => {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const pickPreferredCashMovement = (current, candidate) => {
    if (!current) return candidate;
    if (!candidate) return current;

    const currentStatus = scoreCashMovementStatus(current);
    const candidateStatus = scoreCashMovementStatus(candidate);
    if (candidateStatus > currentStatus) return candidate;
    if (candidateStatus < currentStatus) return current;

    const currentSeen = parseLastSeenAt(current.lastSeenAt);
    const candidateSeen = parseLastSeenAt(candidate.lastSeenAt);
    if (candidateSeen > currentSeen) return candidate;
    if (candidateSeen < currentSeen) return current;

    const dateCompare = compareYMD(candidate.date, current.date);
    if (dateCompare > 0) return candidate;
    if (dateCompare < 0) return current;

    const currentAmount = Math.abs(Number(current.amount) || 0);
    const candidateAmount = Math.abs(Number(candidate.amount) || 0);
    if (candidateAmount > currentAmount) return candidate;
    if (candidateAmount < currentAmount) return current;

    return current;
  };

  const detectDuplicateCashMovements = () => {
    const entries = Array.isArray(STATE.oneOffs) ? STATE.oneOffs : [];
    const groups = new Map();

    for (const entry of entries) {
      if (!entry) continue;
      const isARSource = entry.source === "AR" || Boolean(entry.sourceKey);
      const arCategory = typeof entry.category === "string" && entry.category.toLowerCase().startsWith("ar");
      if (!isARSource && !arCategory) continue;

      const key = deriveCashMovementKey(entry);
      if (!key) continue;
      if (!entry.sourceKey && !key.startsWith("INVONLY#")) {
        entry.sourceKey = key;
      }

      if (!groups.has(key)) {
        groups.set(key, [entry]);
      } else {
        groups.get(key).push(entry);
      }
    }

    const removal = [];
    for (const [, list] of groups.entries()) {
      if (!Array.isArray(list) || list.length <= 1) continue;
      let keep = list[0];
      for (let i = 1; i < list.length; i += 1) {
        keep = pickPreferredCashMovement(keep, list[i]);
      }
      for (const entry of list) {
        if (entry !== keep) {
          removal.push(entry);
        }
      }
    }

    return { removal };
  };

  const defaultAROptions = () => ({ roll: "forward", lag: 0, conf: 100, category: "AR", prune: false });
  const defaultARMappingOverrides = () => ({ company: "", invoice: "", due: "", amount: "" });
  const sanitizeAROptions = (value) => {
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
  const sanitizeARMapping = (value) => {
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
  const loadARPreferences = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AR_PREFS);
      if (!raw) {
        return { options: defaultAROptions(), mapping: defaultARMappingOverrides() };
      }
      const parsed = JSON.parse(raw);
      return {
        options: sanitizeAROptions(parsed.options),
        mapping: sanitizeARMapping(parsed.mapping),
      };
    } catch {
      return { options: defaultAROptions(), mapping: defaultARMappingOverrides() };
    }
  };
  const initialARPrefs = loadARPreferences();
  const saveARPreferences = () => {
    try {
      const payload = {
        options: {
          roll: arState.options.roll,
          lag: arState.options.lag,
          conf: arState.options.conf,
          category: arState.options.category,
          prune: arState.options.prune,
        },
        mapping: { ...arState.mappingOverrides },
      };
      localStorage.setItem(STORAGE_KEYS.AR_PREFS, JSON.stringify(payload));
    } catch {
      // ignore storage failures
    }
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
    options: sanitizeAROptions(initialARPrefs.options),
    mappingOverrides: sanitizeARMapping(initialARPrefs.mapping),
    duplicatesRemoved: 0,
    presentKeys: new Set(),
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
    if (!row.valid) {
      row.selected = false;
      row.userSelected = false;
    }
    return row.valid;
  };

  const computeARCategory = (amount) => {
    const defaultCategory = (arState.options.category || "AR").trim() || "AR";
    return Number(amount) < 0 ? "AR Credit" : defaultCategory;
  };

  const buildPreviewEntry = (row) => {
    if (!row) return null;
    const sourceKey = row.sourceKey || makeSourceKey(row.company, row.invoice);
    if (!sourceKey) return null;
    const expected = row.expectedDate && isValidYMDString(row.expectedDate) ? row.expectedDate : null;
    const amountValue = Number(row.amount);
    if (!Number.isFinite(amountValue) || amountValue === 0) return null;
    const name = row.name && String(row.name).trim();
    if (!expected || !name) return null;
    return {
      date: expected,
      type: "income",
      name,
      category: computeARCategory(amountValue),
      amount: round2(amountValue),
      source: "AR",
      sourceKey,
      status: "pending",
      dueDate: row.dueDate || null,
      company: row.company || "",
      invoice: row.invoice || "",
      confidencePct: clamp(Number(arState.options.conf || 0), 0, 100),
    };
  };

  const isAREntrySame = (existing, preview) => {
    if (!existing || !preview) return false;
    const existingStatus = existing.status === "archived" ? "archived" : "pending";
    if (existingStatus !== "pending") return false;
    const existingAmount = round2(Number(existing.amount || 0));
    const previewAmount = round2(Number(preview.amount || 0));
    return (
      (existing.date || "") === (preview.date || "") &&
      existingAmount === previewAmount &&
      (existing.name || "") === (preview.name || "") &&
      (existing.category || "") === (preview.category || "")
    );
  };

  const syncRowSelection = (row) => {
    if (!row) return;
    if (!row.valid) {
      row.selected = false;
      return;
    }
    if (row.userSelected) return;
    row.selected = row.action !== "same";
  };

  const updateARRowAction = (row) => {
    if (!row) return;
    const preview = buildPreviewEntry(row);
    row.previewEntry = preview;
    const sourceKey = preview?.sourceKey || makeSourceKey(row.company, row.invoice);
    row.sourceKey = sourceKey;
    const existing = findOneOffBySourceKey(sourceKey);
    row.existing = existing || null;
    if (!sourceKey) {
      row.action = "add";
      return;
    }
    if (!existing) {
      row.action = "add";
      return;
    }
    row.action = preview && isAREntrySame(existing, preview) ? "same" : "update";
  };

  const refreshARRow = (row, { dueChanged = false, forceExpected = false, forceAmount = false, forceName = false } = {}) => {
    if (!row) return;
    if (dueChanged) row.manualExpected = false;
    const conf = clamp(Number(arState.options.conf || 0), 0, 100);
    row.confidence = conf;
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
    updateARRowAction(row);
    validateARRow(row);
    syncRowSelection(row);
  };

  const updateSelectAllState = () => {
    const selectAll = $("#arSelectAll");
    if (!selectAll) return;
    const selectableRows = arState.rows.filter((row) => row.valid && row.action !== "same");
    if (!selectableRows.length) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      selectAll.disabled = true;
      return;
    }
    const selected = selectableRows.filter((row) => row.selected).length;
    selectAll.disabled = false;
    selectAll.checked = selected > 0 && selected === selectableRows.length;
    selectAll.indeterminate = selected > 0 && selected < selectableRows.length;
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
      checkbox.checked = Boolean(row.valid && row.selected);
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
      badge.textContent = row.action ? row.action.toUpperCase() : "";
      badge.classList.remove("badge-add", "badge-update", "badge-same");
      if (row.action === "update") {
        badge.classList.add("badge-update");
      } else if (row.action === "same") {
        badge.classList.add("badge-same");
      } else {
        badge.classList.add("badge-add");
      }
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
    const { added = 0, updated = 0, unchanged = 0, archived = 0, skipped = 0 } = arState.summary;
    const parts = [
      `Added ${fmtCount(added)}`,
      `Updated ${fmtCount(updated)}`,
      `Unchanged ${fmtCount(unchanged)}`,
      `Archived ${fmtCount(archived)}`,
    ];
    if (skipped) parts.push(`Skipped ${fmtCount(skipped)}`);
    el.textContent = `Last import: ${parts.join(" • ")}`;
  };

  const renderARCounters = () => {
    const el = $("#arCounters");
    if (!el) return;
    if (!arState.rows.length) {
      el.textContent = "";
      return;
    }
    let add = 0;
    let update = 0;
    let same = 0;
    for (const row of arState.rows) {
      if (!row || !row.valid) continue;
      if (row.action === "update") update += 1;
      else if (row.action === "same") same += 1;
      else add += 1;
    }
    const parts = [
      `Add ${fmtCount(add)}`,
      `Update ${fmtCount(update)}`,
      `Same ${fmtCount(same)}`,
    ];
    if (arState.duplicatesRemoved) {
      parts.push(`Duplicates removed ${fmtCount(arState.duplicatesRemoved)}`);
    }
    el.textContent = parts.join(" • ");
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
      renderARCounters();
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
        <td><span class="badge" data-badge></span></td>
      `;
      tbody.appendChild(tr);
      applyRowToDOM(row);
    }
    arState.lastRange = { start: startIndex + 1, end: endIndex };
    updateARImportButton();
    updateSelectAllState();
    renderARPagination();
    renderARSummary();
    renderARCounters();
  };

  const pickBetterDuplicate = (existing, candidate) => {
    if (!existing) return candidate;
    if (!candidate) return existing;
    if (existing.dueDate && candidate.dueDate) {
      const cmp = compareYMD(candidate.dueDate, existing.dueDate);
      if (cmp > 0) return candidate;
      if (cmp < 0) return existing;
    }
    const existingAmount = Math.abs(Number(existing.baseAmount ?? existing.amount ?? 0));
    const candidateAmount = Math.abs(Number(candidate.baseAmount ?? candidate.amount ?? 0));
    if (candidateAmount > existingAmount) return candidate;
    return existing;
  };

  const normalizeARRows = (rawRows, mapping, aux) => {
    const noKeyRows = [];
    const keyOrder = [];
    const dedup = new Map();
    const presentKeys = new Set();
    let skipped = 0;
    let duplicatesRemoved = 0;
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
        userSelected: false,
        selected: false,
        errors: {},
        valid: false,
        action: "add",
        previewEntry: null,
      };
      row.sourceKey = makeSourceKey(company, invoice);
      if (row.sourceKey) {
        presentKeys.add(row.sourceKey);
        if (!dedup.has(row.sourceKey)) {
          dedup.set(row.sourceKey, row);
          keyOrder.push(row.sourceKey);
        } else {
          const current = dedup.get(row.sourceKey);
          const preferred = pickBetterDuplicate(current, row);
          if (preferred !== current) {
            dedup.set(row.sourceKey, preferred);
          }
          duplicatesRemoved += 1;
        }
      } else {
        noKeyRows.push(row);
      }
    }
    const keyedRows = keyOrder.map((key) => dedup.get(key));
    return { rows: [...keyedRows, ...noKeyRows], skipped, duplicatesRemoved, presentKeys };
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

      arState.mappingOverrides = sanitizeARMapping(mappingInput);
      saveARPreferences();

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

      const {
        rows: normalizedRows,
        skipped,
        duplicatesRemoved,
        presentKeys,
      } = normalizeARRows(rawRows, resolvedMapping, resolvedAux);
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
      arState.duplicatesRemoved = duplicatesRemoved;
      arState.presentKeys = new Set(presentKeys || []);
      arState.page = 1;
      arState.perPage = limitedRows.length > 1000 ? 200 : Math.max(limitedRows.length, 1);
      arState.summary = null;

      for (const row of arState.rows) {
        row.manualAmount = false;
        row.manualExpected = false;
        row.manualName = false;
        row.userSelected = false;
        refreshARRow(row, { dueChanged: true, forceExpected: true, forceAmount: true, forceName: true });
      }

      const validCount = arState.rows.filter((row) => row.valid).length;
      const truncated = normalizedRows.length > limitedRows.length;
      const parts = [];
      parts.push(`${rawRows.length} rows parsed`);
      parts.push(`${validCount} ready`);
      if (skipped) parts.push(`${skipped} skipped`);
      if (truncated) parts.push(`showing first ${limitedRows.length}`);
      if (duplicatesRemoved) parts.push(`${duplicatesRemoved} duplicates merged`);
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
      if (row.action === "same") {
        continue;
      }
      row.selected = checked;
      row.userSelected = true;
    }
    const tbody = $("#arPreview tbody");
    if (tbody) {
      tbody.querySelectorAll('input[type="checkbox"][data-act="toggleRow"]').forEach((checkbox) => {
        const id = checkbox.dataset.id;
        const row = arState.rows.find((r) => r.id === id);
        if (!row) return;
        checkbox.checked = Boolean(row.valid && row.selected);
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
        updateARRowAction(row);
        validateARRow(row);
        syncRowSelection(row);
        break;
      case "amount":
        row.amount = Number.isFinite(Number(value)) ? round2(Number(value)) : Number(value);
        row.manualAmount = true;
        updateARRowAction(row);
        validateARRow(row);
        syncRowSelection(row);
        break;
      case "name":
        row.name = value;
        row.manualName = true;
        updateARRowAction(row);
        validateARRow(row);
        syncRowSelection(row);
        break;
      default:
        break;
    }
    applyRowToDOM(row);
    updateARImportButton();
    updateSelectAllState();
    renderARCounters();
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
        row.userSelected = true;
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
    const timestamp = new Date().toISOString();
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let archived = 0;
    let skipped = 0;
    let changed = false;
    const touchedKeys = new Set();

    for (const row of selectedRows) {
      const preview = row.previewEntry || buildPreviewEntry(row);
      if (!preview || !preview.sourceKey) {
        skipped += 1;
        row.selected = false;
        row.userSelected = false;
        continue;
      }
      const existing = findOneOffBySourceKey(preview.sourceKey);
      if (!existing) {
        const entry = {
          ...preview,
          id: uid(),
          lastSeenAt: timestamp,
          status: "pending",
          company: row.company || "",
          invoice: row.invoice || "",
          dueDate: row.dueDate || null,
        };
        STATE.oneOffs.push(entry);
        added += 1;
        changed = true;
      } else {
        const same = row.action === "same" && existing.status !== "archived" && isAREntrySame(existing, preview);
        Object.assign(existing, {
          ...preview,
          id: existing.id,
          lastSeenAt: timestamp,
          status: "pending",
          company: row.company || existing.company || "",
          invoice: row.invoice || existing.invoice || "",
          dueDate: row.dueDate || existing.dueDate || null,
        });
        if (same) {
          unchanged += 1;
        } else {
          updated += 1;
        }
        changed = true;
      }
      touchedKeys.add(preview.sourceKey);
      row.selected = false;
      row.userSelected = false;
    }

    for (const row of arState.rows) {
      if (!row.previewEntry || !row.previewEntry.sourceKey) continue;
      const existing = findOneOffBySourceKey(row.previewEntry.sourceKey);
      if (!existing) continue;
      if (!touchedKeys.has(row.previewEntry.sourceKey) && row.action === "same") {
        existing.lastSeenAt = timestamp;
        touchedKeys.add(row.previewEntry.sourceKey);
        changed = true;
      }
    }

    if (arState.options.prune && arState.presentKeys && arState.presentKeys.size) {
      for (const tx of STATE.oneOffs || []) {
        if (!tx || tx.source !== "AR") continue;
        if (!arState.presentKeys.has(tx.sourceKey)) {
          if (tx.status !== "archived") {
            tx.status = "archived";
            archived += 1;
            changed = true;
          }
        } else if (tx.status === "archived") {
          tx.status = "pending";
          changed = true;
        }
      }
    }

    if (changed) {
      saveState(STATE);
      recalcAndRender();
    }

    arState.summary = { added, updated, unchanged, archived, skipped };
    for (const row of arState.rows) {
      row.userSelected = false;
      row.selected = false;
      refreshARRow(row);
    }

    renderARPreview();

    if (added || updated || unchanged || archived) {
      const parts = [
        `Added ${fmtCount(added)}`,
        `Updated ${fmtCount(updated)}`,
        `Unchanged ${fmtCount(unchanged)}`,
      ];
      if (archived) parts.push(`Archived ${fmtCount(archived)}`);
      if (skipped) parts.push(`Skipped ${fmtCount(skipped)}`);
      updateARStatus(`Import complete: ${parts.join(" • ")}.`, "success");
    } else {
      updateARStatus(skipped ? `Nothing imported. ${fmtCount(skipped)} skipped.` : "Nothing to import.", "error");
    }
  };

  const initARImporter = () => {
    const rollSelect = $("#arRoll");
    if (!rollSelect) return;
    const lagInput = $("#arLag");
    const confInput = $("#arConf");
    const categoryInput = $("#arCategory");
    const pruneInput = $("#arPrune");

    if (rollSelect) rollSelect.value = arState.options.roll;
    if (lagInput) lagInput.value = String(arState.options.lag ?? 0);
    if (confInput) confInput.value = String(arState.options.conf ?? 100);
    if (categoryInput) categoryInput.value = arState.options.category || "AR";
    if (pruneInput) pruneInput.checked = Boolean(arState.options.prune);

    const mappingFields = [
      ["#colCompany", "company"],
      ["#colInvoice", "invoice"],
      ["#colDue", "due"],
      ["#colAmount", "amount"],
    ];
    for (const [selector, key] of mappingFields) {
      const input = $(selector);
      if (!input) continue;
      if (arState.mappingOverrides[key]) {
        input.value = arState.mappingOverrides[key];
      }
      input.addEventListener("change", () => {
        arState.mappingOverrides[key] = input.value.trim();
        saveARPreferences();
      });
    }

    rollSelect.addEventListener("change", (e) => {
      const val = e.target.value || "forward";
      arState.options.roll = ["forward", "back", "none"].includes(val) ? val : "forward";
      saveARPreferences();
      if (arState.rows.length) {
        recalcARRows();
        renderARPreview();
      }
    });
    lagInput?.addEventListener("change", () => {
      const val = Number(lagInput.value || 0);
      const normalized = Number.isFinite(val) ? Math.max(0, Math.trunc(val)) : 0;
      arState.options.lag = normalized;
      lagInput.value = normalized;
      saveARPreferences();
      if (arState.rows.length) {
        recalcARRows();
        renderARPreview();
      }
    });
    confInput?.addEventListener("change", () => {
      const val = Number(confInput.value || 0);
      const normalized = clamp(Number.isFinite(val) ? val : 0, 0, 100);
      arState.options.conf = normalized;
      confInput.value = normalized;
      saveARPreferences();
      if (arState.rows.length) {
        recalcARRows();
        renderARPreview();
      }
    });
    categoryInput?.addEventListener("input", () => {
      arState.options.category = categoryInput.value;
      saveARPreferences();
      if (arState.rows.length) {
        recalcARRows();
        renderARPreview();
      }
    });
    pruneInput?.addEventListener("change", () => {
      arState.options.prune = pruneInput.checked;
      saveARPreferences();
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

  const estimateOccurrencesPerWeek = (stream) => {
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

  const computeProjection = (state, overrides = {}) => {
    const getStreamMultiplier =
      typeof overrides.getStreamMultiplier === "function" ? overrides.getStreamMultiplier : () => 1;
    const transformStreamAmount =
      typeof overrides.transformStreamAmount === "function" ? overrides.transformStreamAmount : null;
    const saleConfig = overrides.sale && typeof overrides.sale === "object" ? overrides.sale : null;
    const saleEntries = [];
    if (saleConfig && saleConfig.enabled && Array.isArray(saleConfig.entries)) {
      for (const rawEntry of saleConfig.entries) {
        if (!rawEntry || typeof rawEntry !== "object") continue;
        const start = isValidYMDString(rawEntry.startDate) ? rawEntry.startDate : null;
        if (!start) continue;
        const rawEnd = isValidYMDString(rawEntry.endDate) ? rawEntry.endDate : start;
        const pct = clampPercent(rawEntry.pct, { min: -1, max: 5, fallback: 0 });
        const topup = clampCurrency(rawEntry.topup, 0);
        const lastEdited = rawEntry.lastEdited === "topup" ? "topup" : "pct";
        const end = compareYMD(start, rawEnd) > 0 ? start : rawEnd;
        saleEntries.push({
          id: rawEntry.id,
          startDate: start,
          endDate: end,
          pct,
          topup,
          lastEdited,
          businessDaysOnly: Boolean(rawEntry.businessDaysOnly),
        });
      }
    }
    const saleEnabled = saleEntries.length > 0;

    const { settings, oneOffs, incomeStreams, adjustments } = state;
    const cal = generateCalendar(settings.startDate, settings.endDate);
    const recurring = oneOffs.filter((tx) => tx && typeof tx === "object" && tx.recurring);
    const singles = oneOffs.filter(
      (tx) =>
        tx &&
        typeof tx === "object" &&
        !tx.recurring &&
        !(tx.source === "AR" && tx.status === "archived")
    );
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
        if (amt >= 0) {
          row.income += absAmt;
          row.incomeDetails.push({ source: label, amount: absAmt });
        } else {
          row.income -= absAmt;
          row.incomeDetails.push({ source: label, amount: -absAmt });
        }
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
          const label = describeNameAndCategory(st, "Income Stream");
          let adjustedAmount = absAmount;
          if (transformStreamAmount) {
            const transformed = Number(transformStreamAmount({
              stream: st,
              baseAmount: absAmount,
              date: row.date,
            }));
            adjustedAmount = Number.isFinite(transformed) && transformed >= 0 ? round2(transformed) : 0;
          } else {
            const multiplierValue = Number(getStreamMultiplier(st, absAmount, row.date));
            const appliedMultiplier = Number.isFinite(multiplierValue) ? Math.max(0, multiplierValue) : 1;
            adjustedAmount = round2(absAmount * appliedMultiplier);
          }
          if (adjustedAmount) {
            row.income += adjustedAmount;
            row.incomeDetails.push({ source: label, amount: adjustedAmount });
            totalStreamIncome += adjustedAmount;
          }
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
      const baseIncomeBeforeSales = row.income;
      if (saleEnabled) {
        const currentDow = fromYMD(row.date).getDay();
        const isBusinessDay = currentDow >= 1 && currentDow <= 5;
        for (const entry of saleEntries) {
          if (compareYMD(row.date, entry.startDate) < 0) continue;
          if (compareYMD(row.date, entry.endDate) > 0) continue;
          if (entry.businessDaysOnly && !isBusinessDay) continue;
          const windowLabel = entry.startDate
            ? entry.endDate && entry.endDate !== entry.startDate
              ? `${entry.startDate}→${entry.endDate}`
              : entry.startDate
            : entry.endDate || "";
          if (entry.lastEdited === "topup") {
            const boost = round2(entry.topup);
            if (boost) {
              row.income += boost;
              row.incomeDetails.push({
                source: windowLabel ? `Sale top-up (${windowLabel})` : "Sale top-up",
                amount: boost,
              });
            }
          } else if (entry.pct > 0) {
            const boost = round2(baseIncomeBeforeSales * entry.pct);
            if (boost) {
              row.income += boost;
              row.incomeDetails.push({
                source: windowLabel ? `Sale uplift (${windowLabel})` : "Sale uplift",
                amount: boost,
              });
            }
          }
        }
      }

      row.income = round2(row.income);
      row.expenses = round2(row.expenses);
      row.net = round2(row.income - row.expenses);
      running = round2(running + row.net);
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
      saveState(STATE);
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
      saveState(STATE);
      $("#adjForm").reset();
      recalcAndRender();
    });

    $("#adjTable").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act='delAdj']");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      STATE.adjustments = STATE.adjustments.filter((a) => a.id !== id);
      saveState(STATE);
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

  const getOneOffSortState = () => {
    if (!STATE.ui || typeof STATE.ui !== "object") {
      STATE.ui = { oneOffSort: defaultOneOffSortState() };
      return STATE.ui.oneOffSort;
    }
    const sanitized = sanitizeOneOffSortState(STATE.ui.oneOffSort);
    if (!STATE.ui.oneOffSort ||
      STATE.ui.oneOffSort.key !== sanitized.key ||
      STATE.ui.oneOffSort.direction !== sanitized.direction) {
      STATE.ui.oneOffSort = sanitized;
    }
    return STATE.ui.oneOffSort;
  };

  const updateOneOffSortState = (key) => {
    if (!key || !ONE_OFF_SORT_KEYS.includes(key)) return false;
    const sortState = getOneOffSortState();
    const prevKey = sortState.key;
    let changed = false;
    if (prevKey === key) {
      const nextDirection = sortState.direction === "asc" ? "desc" : "asc";
      if (nextDirection !== sortState.direction) {
        sortState.direction = nextDirection;
        changed = true;
      }
    } else {
      sortState.key = key;
      sortState.direction = "asc";
      changed = true;
    }
    if (changed) saveState(STATE);
    return changed;
  };

  const compareOneOffRows = (a, b, key) => {
    switch (key) {
      case "date":
        return compareYMD(a.tx?.date, b.tx?.date);
      case "schedule":
        return compareText(a.schedule, b.schedule);
      case "type":
        return compareText(a.tx?.type, b.tx?.type);
      case "name":
        return compareText(a.tx?.name, b.tx?.name);
      case "category":
        return compareText(a.tx?.category, b.tx?.category);
      case "next": {
        const nextA = a.next;
        const nextB = b.next;
        if (nextA && nextB) {
          const byDate = compareYMD(nextA.date, nextB.date);
          if (byDate) return byDate;
          const amtA = Number(nextA.amount);
          const amtB = Number(nextB.amount);
          const hasAmtA = Number.isFinite(amtA);
          const hasAmtB = Number.isFinite(amtB);
          if (hasAmtA && hasAmtB) {
            if (amtA === amtB) return 0;
            return amtA < amtB ? -1 : 1;
          }
          if (hasAmtA) return -1;
          if (hasAmtB) return 1;
          return 0;
        }
        if (nextA) return -1;
        if (nextB) return 1;
        return 0;
      }
      default:
        return 0;
    }
  };

  const updateOneOffSortIndicators = () => {
    const { key, direction } = getOneOffSortState();
    $$("#oneOffTable thead th[data-sort]").forEach((th) => {
      if (th.dataset.sort === key) {
        th.setAttribute("aria-sort", direction === "asc" ? "ascending" : "descending");
      } else {
        th.removeAttribute("aria-sort");
      }
    });
  };

  const renderOneOffs = () => {
    const tbody = $("#oneOffTable tbody");
    tbody.innerHTML = "";

    const rows = [...(STATE.oneOffs || [])]
      .filter((tx) => tx && typeof tx === "object")
      .map((tx) => ({
        tx,
        schedule: describeTransactionSchedule(tx),
        next: getNextOccurrence(tx, todayYMD),
      }));

    const sortState = getOneOffSortState();
    const direction = sortState.direction === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const primary = compareOneOffRows(a, b, sortState.key);
      if (primary) return primary * direction;
      const fallbackDate = compareYMD(a.tx?.date, b.tx?.date);
      if (fallbackDate) return fallbackDate * direction;
      return compareText(a.tx?.name, b.tx?.name) * direction;
    });

    for (const row of rows) {
      const { tx, schedule, next } = row;
      const nextLabel = next ? `${fmtMoney(next.amount)} (${next.date})` : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tx.date || ""}</td>
        <td>${schedule}</td>
        <td>${tx.type || ""}</td>
        <td>${tx.name || ""}</td>
        <td>${tx.category || ""}</td>
        <td class="num">${nextLabel}</td>
        <td>
          <button class="link" data-id="${tx.id}" data-act="editOneOff">Edit</button>
          <span aria-hidden="true">·</span>
          <button class="link" data-id="${tx.id}" data-act="delOneOff">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    updateOneOffSortIndicators();
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

  const updateOneOffFormEditingState = () => {
    const submitBtn = $("#ooSubmitBtn");
    const cancelBtn = $("#ooCancelEdit");
    if (!submitBtn || !cancelBtn) return;
    if (editingOneOffId) {
      submitBtn.textContent = "Save Changes";
      cancelBtn.classList.remove("hidden");
    } else {
      submitBtn.textContent = "Add";
      cancelBtn.classList.add("hidden");
    }
  };

  const resetOneOffForm = () => {
    const form = $("#oneOffForm");
    if (!form) return;
    form.reset();
    editingOneOffId = null;
    const stepEditor = $("#ooStepEditor");
    clearStepRows(stepEditor);
    const escalatorInput = $("#ooEscalator");
    if (escalatorInput) escalatorInput.value = "";
    showTransactionFreqBlocks();
    updateOneOffFormEditingState();
  };

  const populateWeekdaySelections = (selectEl, values) => {
    if (!selectEl) return;
    const normalized = toWeekdayArray(values);
    const lookup = new Set(normalized.map((value) => String(value)));
    const options = Array.from(selectEl.options || []);
    if (!lookup.size) {
      options.forEach((option) => {
        option.selected = option.defaultSelected;
      });
      return;
    }
    options.forEach((option) => {
      option.selected = lookup.has(option.value);
    });
  };

  const startOneOffEdit = (id) => {
    const form = $("#oneOffForm");
    if (!form) return;
    const tx = (STATE.oneOffs || []).find((item) => item && item.id === id);
    if (!tx) return;

    editingOneOffId = tx.id;

    const dateInput = $("#ooDate");
    if (dateInput) dateInput.value = tx.date || "";

    const typeInput = $("#ooType");
    if (typeInput) typeInput.value = tx.type || "expense";

    const nameInput = $("#ooName");
    if (nameInput) nameInput.value = tx.name || "";

    const categoryInput = $("#ooCategory");
    if (categoryInput) categoryInput.value = tx.category || "";

    const amountInput = $("#ooAmount");
    if (amountInput) amountInput.value = tx.amount ?? "";

    const repeatsToggle = $("#ooRepeats");
    const isRecurring = Boolean(tx.repeats || tx.recurring);
    if (repeatsToggle) repeatsToggle.checked = isRecurring;

    const freqSelect = $("#ooFreq");
    if (freqSelect) freqSelect.value = tx.frequency || "monthly";

    const startInput = $("#ooStart");
    if (startInput) startInput.value = tx.startDate || "";

    const endInput = $("#ooEnd");
    if (endInput) endInput.value = tx.endDate || "";

    const skipWeekends = $("#ooSkipWeekends");
    if (skipWeekends) skipWeekends.checked = Boolean(tx.skipWeekends);

    const monthlyModeSel = $("#ooMonthlyMode");
    if (monthlyModeSel) {
      monthlyModeSel.value = tx.monthlyMode === "nth" ? "nth" : "day";
    }

    showTransactionFreqBlocks();

    const dowSelect = $("#ooDOW");
    populateWeekdaySelections(dowSelect, tx.dayOfWeek || []);

    const monthlyMode = monthlyModeSel ? monthlyModeSel.value : "day";
    if (monthlyMode === "nth") {
      const nthWeekSel = $("#ooNthWeek");
      if (nthWeekSel) nthWeekSel.value = normalizeNth(tx.nthWeek);
      const nthWeekdaySel = $("#ooNthWeekday");
      if (nthWeekdaySel) {
        const normalizedDOW = clamp(Number(tx.nthWeekday ?? 0), 0, 6);
        nthWeekdaySel.value = String(normalizedDOW);
      }
    } else {
      const domInput = $("#ooDOM");
      if (domInput) {
        const domValue = clamp(Number(tx.dayOfMonth || domInput.value || 1), 1, 31);
        domInput.value = domValue;
      }
    }

    const stepEditor = $("#ooStepEditor");
    clearStepRows(stepEditor);
    if (stepEditor && Array.isArray(tx.steps) && tx.steps.length) {
      tx.steps.forEach((step) => addStepRow(stepEditor, step));
    }

    const escalatorInput = $("#ooEscalator");
    if (escalatorInput) {
      const esc = Number(tx.escalatorPct);
      escalatorInput.value = Number.isFinite(esc) && esc !== 0 ? esc : "";
    }

    updateOneOffFormEditingState();
    dateInput?.focus?.();
  };

  const bindOneOffs = () => {
    const form = $("#oneOffForm");
    const freqSel = $("#ooFreq");
    const repeatsToggle = $("#ooRepeats");
    if (!form || !freqSel || !repeatsToggle) return;

    initStepEditor($("#ooStepEditor"));

    resetOneOffForm();

    repeatsToggle.addEventListener("change", showTransactionFreqBlocks);
    freqSel.addEventListener("change", showTransactionFreqBlocks);
    $("#ooMonthlyMode")?.addEventListener("change", (e) => {
      applyMonthlyModeVisibility(e.target);
    });
    $("#ooCancelEdit")?.addEventListener("click", () => {
      resetOneOffForm();
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

    const dedupeBtn = $("#dedupeCashBtn");
    dedupeBtn?.addEventListener("click", () => {
      const { removal } = detectDuplicateCashMovements();
      const removalCount = Array.isArray(removal) ? removal.length : 0;
      if (!removalCount) {
        alert("No duplicate AR invoices detected.");
        return;
      }
      const confirmMessage = `Remove ${fmtCount(removalCount)} duplicate ${removalCount === 1 ? "entry" : "entries"}?`;
      if (!window.confirm(confirmMessage)) return;

      const removalSet = new Set(removal);
      STATE.oneOffs = (STATE.oneOffs || []).filter((entry) => !removalSet.has(entry));
      saveState(STATE);
      recalcAndRender();
      alert(`${fmtCount(removalCount)} duplicate ${removalCount === 1 ? "entry" : "entries"} removed.`);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const editingId = editingOneOffId;
      const isEditing = Boolean(editingId);
      const repeats = repeatsToggle.checked;
      const date = $("#ooDate").value;
      const type = $("#ooType").value;
      const name = $("#ooName").value.trim();
      const category = $("#ooCategory").value.trim();
      const amountRaw = Number($("#ooAmount").value || 0);
      if (!date || !name || Number.isNaN(amountRaw)) return;

      const entry = {
        id: isEditing ? editingId : uid(),
        date,
        type,
        name,
        category,
        amount: type === "expense" ? Math.abs(amountRaw) : round2(amountRaw),
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

      if (isEditing) {
        const idx = STATE.oneOffs.findIndex((tx) => tx && tx.id === editingId);
        if (idx >= 0) {
          const prev = STATE.oneOffs[idx];
          if (prev && typeof prev === "object") {
            entry.source = prev.source;
            entry.sourceKey = prev.sourceKey;
            entry.status = prev.status;
            entry.lastSeenAt = prev.lastSeenAt;
            if (prev.company) entry.company = prev.company;
            if (prev.invoice) entry.invoice = prev.invoice;
            if (prev.dueDate) entry.dueDate = prev.dueDate;
            if (prev.confidencePct !== undefined) entry.confidencePct = prev.confidencePct;
          }
          STATE.oneOffs[idx] = entry;
        } else {
          STATE.oneOffs.push(entry);
        }
      } else {
        STATE.oneOffs.push(entry);
      }

      saveState(STATE);
      resetOneOffForm();
      recalcAndRender();
    });

    $("#oneOffTable").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const { act, id } = btn.dataset;
      if (!id) return;

      if (act === "delOneOff") {
        STATE.oneOffs = STATE.oneOffs.filter((t) => t.id !== id);
        if (editingOneOffId === id) {
          resetOneOffForm();
        }
        saveState(STATE);
        recalcAndRender();
      } else if (act === "editOneOff") {
        startOneOffEdit(id);
      }
    });

    const tableHead = $("#oneOffTable thead");
    const requestSort = (key) => {
      if (!updateOneOffSortState(key)) return;
      renderOneOffs();
    };
    tableHead?.addEventListener("click", (event) => {
      const th = event.target.closest("th[data-sort]");
      if (!th) return;
      requestSort(th.dataset.sort);
    });
    tableHead?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const th = event.target.closest("th[data-sort]");
      if (!th) return;
      event.preventDefault();
      requestSort(th.dataset.sort);
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
      saveState(STATE);
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
      saveState(STATE);
      recalcAndRender();
    });
  };

  // Chart + upcoming table + KPIs
  let whatIfChart;
  let whatIfRenderPending = false;

  const scheduleWhatIfRender = () => {
    if (whatIfRenderPending) return;
    whatIfRenderPending = true;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
    raf(() => {
      whatIfRenderPending = false;
      renderWhatIf();
    });
  };

  const formatPercentLabel = (decimal) => {
    const num = Number(decimal) * 100;
    if (!Number.isFinite(num) || Math.abs(num) < 0.05) return "0%";
    const abs = Math.abs(num);
    const formatted = Math.abs(abs % 1) < 0.05 ? abs.toFixed(0) : abs.toFixed(1);
    const sign = num > 0 ? "+" : "-";
    return `${sign}${formatted}%`;
  };

  const formatMoneyDelta = (delta) => {
    const num = Number(delta);
    if (!Number.isFinite(num) || Math.abs(num) < 0.005) return "$0.00";
    const abs = fmtMoney(Math.abs(num));
    return num > 0 ? `+${abs}` : `-${abs}`;
  };

  const formatNumberDelta = (delta) => {
    const num = Number(delta);
    if (!Number.isFinite(num) || Math.abs(num) < 0.5) return "0";
    const rounded = Math.round(num);
    return rounded > 0 ? `+${rounded}` : String(rounded);
  };

  const applyDeltaClass = (el, delta, { positiveIsGood = true } = {}) => {
    if (!el) return;
    let className = "delta-neutral";
    const num = Number(delta);
    if (!Number.isFinite(num)) {
      const isPositive = delta === Number.POSITIVE_INFINITY;
      const isGood = isPositive ? positiveIsGood : !positiveIsGood;
      className = isGood ? "delta-positive" : "delta-negative";
    } else if (Math.abs(num) >= 0.005) {
      const isPositive = num > 0;
      const isGood = isPositive ? positiveIsGood : !positiveIsGood;
      className = isGood ? "delta-positive" : "delta-negative";
    }
    el.classList.remove("delta-positive", "delta-negative", "delta-neutral");
    el.classList.add(className);
  };

  const describeFirstNegative = (ymd) => (ymd ? fmtDate(ymd) : "—");

  const describeFirstNegativeDelta = (actual, scenario) => {
    if (!actual && !scenario) return { text: "No change", delta: 0 };
    if (!actual && scenario) return { text: `New: ${fmtDate(scenario)}`, delta: Number.NEGATIVE_INFINITY };
    if (actual && !scenario) return { text: "Cleared", delta: Number.POSITIVE_INFINITY };
    const actualDate = fromYMD(actual);
    const scenarioDate = fromYMD(scenario);
    if (Number.isNaN(actualDate.getTime()) || Number.isNaN(scenarioDate.getTime())) {
      return { text: "—", delta: 0 };
    }
    const diff = Math.round((scenarioDate - actualDate) / 86400000);
    if (diff === 0) return { text: "Same day", delta: 0 };
    const abs = Math.abs(diff);
    return { text: `${diff > 0 ? "+" : "-"}${abs} days`, delta: diff };
  };




  const { renderDashboard } = createDashboardRenderer({
    getState: () => STATE,
    computeProjection,
    fmtMoney,
    fmtDate,
    query: $,
    Chart: window.Chart || Chart,
  });

  const { renderWhatIf } = createWhatIfRenderer({
    getState: () => STATE,
    getSandbox: () => WHATIF,
    setSandbox: (next) => { WHATIF = next; },
    sanitizeWhatIfState,
    saveWhatIf,
    cloneStateForSandbox,
    defaultState,
    isValidYMDString,
    compareYMD,
    clampPercent,
    clampCurrency,
    round2,
    computeProjection,
    estimateOccurrencesPerWeek,
    computeEffectiveAmount,
    fmtMoney,
    fmtDate,
    escapeHtml,
    describeNameAndCategory,
    formatPercentLabel,
    formatMoneyDelta,
    formatNumberDelta,
    applyDeltaClass,
    describeFirstNegative,
    describeFirstNegativeDelta,
    createSaleEntry,
    uid,
    query: $,
  });



