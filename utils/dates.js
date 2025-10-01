export const pad = (n) => String(n).padStart(2, "0");

export const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromYMD = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (ymd, days = 0) => {
  if (!ymd || typeof ymd !== "string") return ymd;
  const delta = Number(days || 0);
  if (!Number.isFinite(delta)) return ymd;
  const d = fromYMD(ymd);
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + delta);
  return toYMD(d);
};

export const rollWeekend = (ymd, policy = "forward") => {
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
  }
  return toYMD(d);
};

export const parseExcelOrISODate = (value) => {
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
    if (days > 59) days -= 1;
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
  const [datePart] = str.split(/\s+/);
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(datePart)) {
    const parts = datePart.split(/[\/\-]/).map((seg) => seg.trim());
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

export const compareYMD = (a, b) => String(a || "").localeCompare(String(b || ""));

export const monthsBetween = (prev, next) => {
  if (!prev || !next) return 0;
  const months = (next.getFullYear() - prev.getFullYear()) * 12 + (next.getMonth() - prev.getMonth());
  return Math.max(0, months);
};

export const todayYMD = (() => {
  const d = new Date();
  return toYMD(d);
})();

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const getDOWLabel = (value) => {
  const n = Number(value);
  if (Number.isNaN(n)) return DOW_LABELS[0];
  const idx = ((n % 7) + 7) % 7;
  return DOW_LABELS[idx] ?? DOW_LABELS[0];
};

export const normalizeNth = (value) => {
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

export const ordinal = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1:
      return `${num}st`;
    case 2:
      return `${num}nd`;
    case 3:
      return `${num}rd`;
    default:
      return `${num}th`;
  }
};

export const describeNth = (nth) => {
  const n = normalizeNth(nth);
  return n === "last" ? "last" : ordinal(Number(n));
};

export const toWeekdayArray = (value) => {
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
    const normalized = Math.max(0, Math.min(6, Math.trunc(num)));
    if (!seen.has(normalized)) {
      seen.add(normalized);
      days.push(normalized);
    }
  }

  return days.sort((a, b) => a - b);
};

export const firstWeekday = (value, fallback = 0) => {
  const days = toWeekdayArray(value);
  if (days.length) return days[0];
  const num = Number(value);
  if (Number.isFinite(num)) return Math.max(0, Math.min(6, Math.trunc(num)));
  return Math.max(0, Math.min(6, Number(fallback) || 0));
};

export const formatWeekdayList = (value) => {
  const days = toWeekdayArray(value);
  if (!days.length) return "";
  return days.map((dow) => getDOWLabel(dow)).join(", ");
};

export const readWeekdaySelections = (selectEl) => {
  if (!selectEl) return [];
  const values = Array.from(selectEl.selectedOptions || []).map((opt) => opt.value);
  return toWeekdayArray(values);
};
