import { fromYMD } from "./dates.js";

export const fmtMoney = (n) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const fmtDate = (ymd) => {
  if (!ymd) return "";
  try {
    const d = fromYMD(ymd);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (err) {
    return ymd;
  }
};

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const round2 = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

export const fmtCount = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
};

export const parseCurrency = (value) => {
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

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const compareText = (a, b) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, { sensitivity: "base" }) ||
  String(a ?? "").localeCompare(String(b ?? ""));

export const describeNameAndCategory = (entry, fallback) => {
  if (!entry || typeof entry !== "object") return fallback;
  const parts = [];
  if (entry.name) parts.push(entry.name);
  if (entry.category) parts.push(entry.category);
  if (!parts.length && entry.note) parts.push(entry.note);
  return parts.join(" – ") || fallback;
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export const deepClone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};
