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

    // Accumulate one-offs by exact date
    const byDate = new Map(cal.map((row) => [row.date, row]));
    for (const tx of oneOffs) {
      const row = byDate.get(tx.date);
      if (!row) continue;
      const amt = Number(tx.amount || 0);
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
  const initSettings = () => {
    $("#startDate").value = STATE.settings.startDate;
    $("#endDate").value = STATE.settings.endDate || defaultEnd;
    $("#startingBalance").value = Number(STATE.settings.startingBalance || 0);

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
  const renderOneOffs = () => {
    const tbody = $("#oneOffTable tbody");
    tbody.innerHTML = "";
    const rows = [...STATE.oneOffs].sort((a, b) => a.date.localeCompare(b.date));
    for (const tx of rows) {
      const amt = Number(tx.amount || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tx.date}</td>
        <td>${tx.type}</td>
        <td>${tx.name || ""}</td>
        <td>${tx.category || ""}</td>
        <td class="num">${fmtMoney(amt)}</td>
        <td><button class="link" data-id="${tx.id}" data-act="delOneOff">Delete</button></td>
      `;
      tbody.appendChild(tr);
    }
  };

  const bindOneOffs = () => {
    $("#oneOffForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const date = $("#ooDate").value;
      const type = $("#ooType").value;
      const name = $("#ooName").value.trim();
      const category = $("#ooCategory").value.trim();
      const amount = Number($("#ooAmount").value || 0);
      if (!date || !name || isNaN(amount)) return;
      STATE.oneOffs.push({ id: uid(), date, type, name, category, amount: Math.abs(amount) });
      save(STATE);
      $("#oneOffForm").reset();
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
          case "weekly": return `Weekly on ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][st.dayOfWeek]}`;
          case "biweekly": return `Every 2 weeks on ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][st.dayOfWeek]}`;
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
