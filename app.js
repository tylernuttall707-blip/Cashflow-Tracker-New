/* 2025 Cash Flow — all client-side, localStorage powered */

(() => {
  "use strict";

  // ---------- Utilities ----------
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const fmtMoney = (n) =>
    (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (n) => String(n).padStart(2, "0");
  const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYMD = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const uid = () => Math.random().toString(36).slice(2, 9);
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

      if (result.recurring) {
        const frequency = typeof entry.frequency === "string" ? entry.frequency : null;
        const startDate = typeof entry.startDate === "string" ? entry.startDate : null;
        const endDate = typeof entry.endDate === "string" ? entry.endDate : null;
        if (!frequency || !startDate || !endDate) {
          if (strict) throw new Error("Invalid recurring one-off metadata");
          return null;
        }
        result.frequency = frequency;
        result.startDate = startDate;
        result.endDate = endDate;
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
      }

      return result;
    };

    const sanitizeList = (list) =>
      list
        .map((item) => sanitizeOneOff(item))
        .filter((item) => item !== null);

    state.oneOffs = sanitizeList(state.oneOffs);

    state.incomeStreams = state.incomeStreams
      .filter((stream) => stream && typeof stream === "object" && !Array.isArray(stream))
      .map((stream) => {
        const next = { ...stream };
        next.dayOfWeek = toWeekdayArray(next.dayOfWeek);
        next.dayOfMonth = clamp(Number(next.dayOfMonth ?? 1), 1, 31);
        const freq = typeof next.frequency === "string" ? next.frequency : null;
        if (freq === "monthly" && stream.monthlyMode === "nth") {
          next.monthlyMode = "nth";
          next.nthWeek = normalizeNth(stream.nthWeek);
          next.nthWeekday = firstWeekday(stream.nthWeekday ?? next.dayOfWeek ?? 0, 0);
        } else if (freq === "monthly") {
          next.monthlyMode = "day";
          delete next.nthWeek;
          delete next.nthWeekday;
        } else {
          next.monthlyMode = "day";
          delete next.nthWeek;
          delete next.nthWeekday;
        }
        return next;
      });

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
      days.push({ date: toYMD(d), income: 0, expenses: 0, net: 0, running: 0 });
    }
    return days;
  };

  const computeProjection = (state) => {
    const { settings, oneOffs, incomeStreams, adjustments } = state;
    const cal = generateCalendar(settings.startDate, settings.endDate);
    const recurring = oneOffs.filter((tx) => tx && typeof tx === "object" && tx.recurring);
    const singles = oneOffs.filter((tx) => tx && typeof tx === "object" && !tx.recurring);

    // Accumulate one-offs by exact date
    const byDate = new Map(cal.map((row) => [row.date, row]));

    for (const tx of singles) {
      const row = byDate.get(tx.date);
      if (!row) continue;
      const amt = Number(tx.amount || 0);
      if (!amt) continue;
      if (tx.type === "expense") row.expenses += Math.abs(amt);
      else row.income += Math.abs(amt);
    }

    // Apply recurring income streams
    for (const st of incomeStreams) {
      const amount = Number(st.amount || 0);
      if (!amount) continue;
      for (const row of cal) {
        const d = fromYMD(row.date);
        if (shouldApplyStreamOn(d, st)) {
          row.income += amount;
        }
      }
    }

    // Apply recurring one-offs
    for (const tx of recurring) {
      const amount = Number(tx.amount || 0);
      if (!amount) continue;
      if (typeof tx.startDate !== "string" || typeof tx.endDate !== "string" || typeof tx.frequency !== "string") {
        continue;
      }
      for (const row of cal) {
        const d = fromYMD(row.date);
        if (shouldApplyStreamOn(d, tx)) {
          if (tx.type === "expense") row.expenses += Math.abs(amount);
          else row.income += Math.abs(amount);
        }
      }
    }

    // Adjustments (can be positive or negative)
    for (const adj of adjustments) {
      const row = byDate.get(adj.date);
      if (row) {
        const amt = Number(adj.amount || 0);
        if (amt >= 0) row.income += amt;
        else row.expenses += Math.abs(amt);
      }
    }

    // Net + running
    let running = Number(settings.startingBalance || 0);
    let totalIncome = 0;
    let totalExpenses = 0;

    for (const row of cal) {
      row.net = row.income - row.expenses;
      running += row.net;
      row.running = running;
      totalIncome += row.income;
      totalExpenses += row.expenses;
    }

    return { cal, totalIncome, totalExpenses, endBalance: running };
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

    const repeats = Boolean(tx.repeats ?? tx.recurring);
    if (!repeats) return "—";

    const frequency = tx.frequency;
    if (!frequency) return "Repeats";

    const start = tx.startDate || tx.date || null;
    const end = tx.endDate || tx.date || null;
    const range = start && end ? ` (${start} → ${end})` : "";

    switch (frequency) {
      case "daily":
        return `Daily${tx.skipWeekends ? " (M–F)" : ""}${range}`;
      case "weekly": {
        const list = formatWeekdayList(tx.dayOfWeek);
        return list ? `Weekly on ${list}${range}` : `Weekly (no days selected)${range}`;
      }
      case "biweekly": {
        const list = formatWeekdayList(tx.dayOfWeek);
        return list ? `Every 2 weeks on ${list}${range}` : `Every 2 weeks (no days selected)${range}`;
      }
      case "monthly": {
        return `${describeMonthlySchedule(tx)}${range}`;
      }
      case "once": {
        const when = tx.onDate || tx.date || start;
        return when ? `On ${when}` : "Once";
      }
      default:
        return `Repeats${range}`;
    }
  };

  const renderOneOffs = () => {
    const tbody = $("#oneOffTable tbody");
    tbody.innerHTML = "";

    const rows = [...(STATE.oneOffs || [])]
      .filter((tx) => tx && typeof tx === "object")
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    for (const tx of rows) {
      const amt = Number(tx.amount || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tx.date || ""}</td>
        <td>${describeTransactionSchedule(tx)}</td>
        <td>${tx.type || ""}</td>
        <td>${tx.name || ""}</td>
        <td>${tx.category || ""}</td>
        <td class="num">${fmtMoney(amt)}</td>
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

  const bindOneOffs = () => {
    const form = $("#oneOffForm");
    const freqSel = $("#ooFreq");
    const repeatsToggle = $("#ooRepeats");
    if (!form || !freqSel || !repeatsToggle) return;

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
      }

      STATE.oneOffs.push(entry);

      save(STATE);
      form.reset();
      showTransactionFreqBlocks();
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
      const schedule = (() => {
        switch (st.frequency) {
          case "once": return `On ${st.onDate}`;
          case "daily": return `Daily${st.skipWeekends ? " (M–F)" : ""}`;
          case "weekly": {
            const list = formatWeekdayList(st.dayOfWeek);
            return list ? `Weekly on ${list}` : "Weekly (no days selected)";
          }
          case "biweekly": {
            const list = formatWeekdayList(st.dayOfWeek);
            return list ? `Every 2 weeks on ${list}` : "Every 2 weeks (no days selected)";
          }

          case "monthly": return describeMonthlySchedule(st);
          default: return "";
        }
      })();

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${st.name}</td>
        <td>${st.category || ""}</td>
        <td>${st.frequency}</td>
        <td>${schedule}</td>
        <td class="num">${fmtMoney(Number(st.amount || 0))}</td>
        <td>${st.startDate} → ${st.endDate}</td>
        <td><button class="link" data-id="${st.id}" data-act="delStream">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }
  };

  const bindStreams = () => {
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

      STATE.incomeStreams.push(stream);
      save(STATE);
      $("#streamForm").reset();
      $("#stFreq").value = "once";
      showFreqBlocks();
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
    const { cal, totalIncome, totalExpenses, endBalance } = computeProjection(STATE);

    // KPIs
    $("#kpiEndBalance").textContent = fmtMoney(endBalance);
    $("#kpiIncome").textContent = fmtMoney(totalIncome);
    $("#kpiExpenses").textContent = fmtMoney(totalExpenses);

    // Chart data
    const labels = cal.map((r) => r.date);
    const data = cal.map((r) => Number(r.running.toFixed(2)));

    const ctx = $("#balanceChart").getContext("2d");
    if (balanceChart) balanceChart.destroy();
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
          }
        ]
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: false }
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

    const dlg = $("#importDialog");
    $("#importBtn").addEventListener("click", () => dlg.showModal());
    $("#confirmImportBtn").addEventListener("click", (e) => {
      e.preventDefault();
      try {
        const parsed = JSON.parse($("#importText").value);
        const nextState = normalizeState(parsed, { strict: true });
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

    // Ensure defaults if missing
    if (!STATE.settings.endDate) STATE.settings.endDate = defaultEnd;
    save(STATE);

    recalcAndRender();
  };

  document.addEventListener("DOMContentLoaded", init);
})();
