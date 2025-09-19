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
    expenseStreams: [],
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
    ensureArray("expenseStreams");

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

  // ---------- Recurrence engine ----------
  const isBetween = (d, start, end) => d >= start && d <= end;

  const lastDayOfMonth = (y, mIndex) => new Date(y, mIndex + 1, 0).getDate(); // 0 => last day prev month
  const occursMonthly = (date, dayOfMonth) => {
    const ld = lastDayOfMonth(date.getFullYear(), date.getMonth());
    const target = clamp(dayOfMonth, 1, ld);
    return date.getDate() === target;
  };

  const occursWeeklyOn = (date, dow) => date.getDay() === Number(dow);

  const occursBiweeklyOn = (date, dow, startDate) => {
    // Anchor at the first occurrence on/after startDate with the given DOW
    const anchor = new Date(startDate.getTime());
    const deltaToDOW = (Number(dow) - anchor.getDay() + 7) % 7;
    anchor.setDate(anchor.getDate() + deltaToDOW); // first scheduled day
    if (date < anchor) return false;
    const days = Math.floor((date - anchor) / (1000 * 60 * 60 * 24));
    return days % 14 === 0;
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
      dayOfWeek: Number(tx.dayOfWeek ?? 0),
      dayOfMonth: Number(tx.dayOfMonth ?? 1),
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
    const { settings, oneOffs, incomeStreams, expenseStreams, adjustments } = state;
    const cal = generateCalendar(settings.startDate, settings.endDate);

    // Accumulate one-offs by exact date
    const byDate = new Map(cal.map((row) => [row.date, row]));
    for (const tx of oneOffs) {
      const amt = Number(tx?.amount || 0);
      if (!amt) continue;

      const applyToRow = (row) => {
        if (!row) return;
        if (tx.type === "expense") row.expenses += Math.abs(amt);
        else row.income += Math.abs(amt);
      };

      const hasSchedule = Boolean(tx.repeats && tx.frequency && tx.startDate && tx.endDate);
      if (hasSchedule) {
        for (const row of cal) {
          const d = fromYMD(row.date);
          if (shouldApplyTransactionOn(d, tx)) {
            applyToRow(row);
          }
        }
      } else {
        applyToRow(byDate.get(tx.date));
      }
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

    // Apply recurring expense streams
    for (const st of expenseStreams || []) {
      const amount = Number(st.amount || 0);
      if (!amount) continue;
      for (const row of cal) {
        const d = fromYMD(row.date);
        if (shouldApplyStreamOn(d, st)) {
          row.expenses += amount;
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
  const describeTransactionSchedule = (tx) => {
    if (!tx || !tx.repeats || !tx.frequency) return "—";

    const range = tx.startDate && tx.endDate ? ` (${tx.startDate} → ${tx.endDate})` : "";
    switch (tx.frequency) {
      case "daily":
        return `Daily${tx.skipWeekends ? " (M–F)" : ""}${range}`;
      case "weekly":
        return `Weekly on ${getDOWLabel(tx.dayOfWeek)}${range}`;
      case "biweekly":
        return `Every 2 weeks on ${getDOWLabel(tx.dayOfWeek)}${range}`;
      case "monthly":
        return `Monthly on day ${clamp(Number(tx.dayOfMonth ?? 1), 1, 31)}${range}`;
      default:
        return `Repeats${range}`;
    }
  };

  const renderOneOffs = () => {
    const tbody = $("#oneOffTable tbody");
    tbody.innerHTML = "";
    const rows = [...STATE.oneOffs].sort((a, b) => {
      const aKey = a.repeats && a.startDate ? a.startDate : a.date;
      const bKey = b.repeats && b.startDate ? b.startDate : b.date;
      return String(aKey || "").localeCompare(String(bKey || ""));
    });
    for (const tx of rows) {
      const amt = Number(tx.amount || 0);
      const schedule = describeTransactionSchedule(tx);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tx.date || ""}</td>
        <td>${schedule}</td>
        <td>${tx.type}</td>
        <td>${tx.name || ""}</td>
        <td>${tx.category || ""}</td>
        <td class="num">${fmtMoney(amt)}</td>
        <td><button class="link" data-id="${tx.id}" data-act="delOneOff">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }
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
      const date = $("#ooDate").value;
      const type = $("#ooType").value;
      const name = $("#ooName").value.trim();
      const category = $("#ooCategory").value.trim();
      const amount = Number($("#ooAmount").value || 0);
      if (!date || !name || isNaN(amount)) return;

      const repeats = repeatsToggle.checked;
      const record = {
        id: uid(),
        date,
        type,
        name,
        category,
        amount: Math.abs(amount),
        repeats,
      };

      if (repeats) {
        let startDate = $("#ooStart").value || date;
        let endDate = $("#ooEnd").value || startDate;
        if (!startDate || !endDate) return;
        if (endDate < startDate) {
          [startDate, endDate] = [endDate, startDate];
        }

        const frequency = freqSel.value;
        record.frequency = frequency;
        record.startDate = startDate;
        record.endDate = endDate;
        record.skipWeekends = false;
        record.dayOfWeek = Number($("#ooDOW").value || 0);
        record.dayOfMonth = clamp(Number($("#ooDOM").value || 1), 1, 31);

        if (frequency === "daily") {
          record.skipWeekends = $("#ooSkipWeekends").checked;
        }
        if (frequency === "weekly" || frequency === "biweekly") {
          record.dayOfWeek = Number($("#ooDOW").value || 0);
        }
        if (frequency === "monthly") {
          record.dayOfMonth = clamp(Number($("#ooDOM").value || 1), 1, 31);
        }
      }

      STATE.oneOffs.push(record);
      save(STATE);
      form.reset();
      freqSel.value = "monthly";
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
          case "weekly": return `Weekly on ${getDOWLabel(st.dayOfWeek)}`;
          case "biweekly": return `Every 2 weeks on ${getDOWLabel(st.dayOfWeek)}`;
          case "monthly": return `Monthly on day ${st.dayOfMonth}`;
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

      const stream = {
        id: uid(),
        name, category,
        amount: Math.abs(amount),
        frequency,
        startDate,
        endDate,
        onDate: null,
        skipWeekends: false,
        dayOfWeek: 1,
        dayOfMonth: 1
      };

      if (frequency === "once") {
        stream.onDate = $("#stOnDate").value;
        if (!stream.onDate) return;
      }
      if (frequency === "daily") {
        stream.skipWeekends = $("#stSkipWeekends").checked;
      }
      if (frequency === "weekly" || frequency === "biweekly") {
        stream.dayOfWeek = Number($("#stDOW").value);
      }
      if (frequency === "monthly") {
        stream.dayOfMonth = clamp(Number($("#stDOM").value || 1), 1, 31);
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
