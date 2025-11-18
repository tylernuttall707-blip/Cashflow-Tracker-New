"use strict";

import { compareYMD, fromYMD, toYMD } from "./dateUtils";
import { clampCurrency, clampPercent, isValidYMDString } from "./validation";
import {
  describeNameAndCategory,
  resolveRecurringAmount,
  shouldApplyStreamOn,
} from "./transactions";
import type {
  AppState,
  CalendarRow,
  ProjectionOverrides,
  ProjectionResult,
  Transaction,
  YMDString,
} from "../types";

/**
 * Format a numeric value into a currency string.
 * @param value - Numeric value to format.
 * @returns Formatted currency string (e.g. $1,234.00).
 */
export const fmtMoney = (value: number): string =>
  (value < 0 ? "-$" : "$") +
  Math.abs(Number(value) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Parse loose currency inputs into a numeric value.
 * @param value - Raw input value.
 * @returns Parsed numeric value or NaN when parsing fails.
 */
export const parseMoney = (value: unknown): number => {
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
      str = `${parts.slice(0, -1).join("")}.${parts[parts.length - 1]}`;
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

/**
 * Round a number to two decimal places.
 * @param value - Numeric value to round.
 * @returns Rounded value.
 */
export const round2 = (value: number): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

/**
 * Compute the effective amount after applying percentage and delta adjustments.
 * @param base - Base amount.
 * @param pct - Percentage adjustment (e.g. 0.1 for +10%).
 * @param delta - Flat adjustment delta.
 * @returns Rounded effective amount.
 */
export const computeEffectiveAmount = (base: number, pct: number, delta: number): number => {
  const b = Number(base || 0);
  const p = Number(pct || 0);
  const d = Number(delta || 0);
  if (!Number.isFinite(b) || !Number.isFinite(p) || !Number.isFinite(d)) return 0;
  return round2(b * (1 + p) + d);
};

/**
 * Resolve the percentage required to reach an effective amount.
 * @param base - Base amount.
 * @param effective - Target effective amount.
 * @param delta - Flat delta applied alongside the percentage.
 * @returns Calculated percentage (e.g. 0.1 for +10%).
 */
export const resolvePercentFromEffective = (
  base: number,
  effective: number,
  delta: number = 0
): number => {
  const b = Number(base || 0);
  if (!Number.isFinite(b) || b === 0) return 0;
  const e = Number(effective || 0);
  if (!Number.isFinite(e)) return 0;
  const d = Number(delta || 0);
  if (!Number.isFinite(d)) return 0;
  return clampPercent((e - d) / b - 1);
};

/**
 * Generate calendar rows between two dates.
 * @param startYMD - Inclusive start date (YYYY-MM-DD).
 * @param endYMD - Inclusive end date (YYYY-MM-DD).
 * @returns Calendar rows seeded with zeroed totals.
 */
export const generateCalendar = (startYMD: YMDString, endYMD: YMDString): CalendarRow[] => {
  const start = fromYMD(startYMD);
  const end = fromYMD(endYMD);
  const rows: CalendarRow[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    rows.push({
      date: toYMD(cursor),
      income: 0,
      expenses: 0,
      net: 0,
      running: 0,
      incomeDetails: [],
      expenseDetails: [],
    });
  }
  return rows;
};

interface SaleEntryInternal {
  id: string;
  startDate: YMDString;
  endDate: YMDString;
  pct: number;
  topup: number;
  lastEdited: "pct" | "topup";
  businessDaysOnly: boolean;
}

/**
 * Compute a cash-flow projection across the supplied state window.
 * @param state - Application state containing settings and transactions.
 * @param overrides - Optional overrides for multiplier/transform hooks.
 * @returns Projection summary including calendar rows and balance stats.
 */
export const computeProjection = (
  state: AppState,
  overrides: ProjectionOverrides = {}
): ProjectionResult => {
  // Use the new expandedTransactions-based projection if available
  if (state.expandedTransactions && state.expandedTransactions.length > 0) {
    return computeProjectionFromExpanded(state, overrides);
  }

  // Fall back to legacy projection for backward compatibility
  const getStreamMultiplier =
    typeof overrides.getStreamMultiplier === "function" ? overrides.getStreamMultiplier : () => 1;
  const transformStreamAmount =
    typeof overrides.transformStreamAmount === "function" ? overrides.transformStreamAmount : null;

  const saleConfig = overrides.sale && typeof overrides.sale === "object" ? overrides.sale : null;
  const saleEntries: SaleEntryInternal[] = [];
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

  const { settings, oneOffs = [], incomeStreams = [], adjustments = [] } = state || {};
  if (!settings) {
    throw new Error("State missing settings for projection");
  }
  const calendar = generateCalendar(settings.startDate, settings.endDate);
  const byDate = new Map(calendar.map((row) => [row.date, row]));

  const recurring = oneOffs.filter(
    (tx): tx is Transaction => tx && typeof tx === "object" && tx.recurring
  );
  const singles = oneOffs.filter(
    (tx): tx is Transaction =>
      tx &&
      typeof tx === "object" &&
      !tx.recurring &&
      !(tx.source === "AR" && tx.status === "archived")
  );

  let totalStreamIncome = 0;

  for (const tx of singles) {
    if (!('date' in tx) || typeof tx.date !== 'string') continue;
    const row = byDate.get(tx.date);
    if (!row) continue;
    const amount = Number(tx.amount || 0);
    if (!amount) continue;
    const absAmount = Math.abs(amount);
    const label = describeNameAndCategory(tx, tx.type === "expense" ? "Expense" : "Income");
    if (tx.type === "expense") {
      row.expenses += absAmount;
      row.expenseDetails.push({ source: label, amount: absAmount });
    } else {
      const signed = amount >= 0 ? absAmount : -absAmount;
      row.income += signed;
      row.incomeDetails.push({ source: label, amount: signed });
    }
  }

  const incomeLastOccurrence = new Map<string, Date>();
  incomeStreams.forEach((stream, index) => {
    if (!stream || typeof stream !== "object") return;
    const key = `stream:${typeof stream.id === "string" ? stream.id : index}`;
    for (const row of calendar) {
      const date = fromYMD(row.date);
      if (!shouldApplyStreamOn(date, stream)) continue;
      const prev = incomeLastOccurrence.get(key) || null;
      const amount = resolveRecurringAmount(stream, date, prev);
      if (amount) {
        const absAmount = Math.abs(amount);
        const label = describeNameAndCategory(stream, "Income Stream");
        let adjustedAmount = absAmount;
        if (transformStreamAmount) {
          const transformed = Number(
            transformStreamAmount({ stream, baseAmount: absAmount, date: row.date })
          );
          adjustedAmount = Number.isFinite(transformed) && transformed >= 0 ? round2(transformed) : 0;
        } else {
          const multiplierValue = Number(getStreamMultiplier(stream, absAmount, row.date));
          const appliedMultiplier = Number.isFinite(multiplierValue) ? Math.max(0, multiplierValue) : 1;
          adjustedAmount = round2(absAmount * appliedMultiplier);
        }
        if (adjustedAmount) {
          row.income += adjustedAmount;
          row.incomeDetails.push({ source: label, amount: adjustedAmount });
          totalStreamIncome += adjustedAmount;
        }
      }
      incomeLastOccurrence.set(key, new Date(date.getTime()));
    }
  });

  const txLastOccurrence = new Map<string, Date>();
  recurring.forEach((tx, index) => {
    if (
      !('startDate' in tx) || typeof tx.startDate !== "string" ||
      !('endDate' in tx) || typeof tx.endDate !== "string" ||
      !('frequency' in tx) || typeof tx.frequency !== "string"
    ) {
      return;
    }
    const key = `tx:${typeof tx.id === "string" ? tx.id : index}`;
    for (const row of calendar) {
      const date = fromYMD(row.date);
      if (!shouldApplyStreamOn(date, tx)) continue;
      const prev = txLastOccurrence.get(key) || null;
      const amount = resolveRecurringAmount(tx, date, prev);
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
      txLastOccurrence.set(key, new Date(date.getTime()));
    }
  });

  adjustments.forEach((adj) => {
    const row = byDate.get(adj?.date);
    if (!row) return;
    const amount = Number(adj.amount || 0);
    const label = adj?.note ? `Adjustment – ${adj.note}` : "Adjustment";
    if (amount >= 0) {
      row.income += amount;
      row.incomeDetails.push({ source: label, amount });
    } else {
      const absAmount = Math.abs(amount);
      row.expenses += absAmount;
      row.expenseDetails.push({ source: label, amount: absAmount });
    }
  });

  let running = round2(Number(settings.startingBalance || 0));
  let totalIncome = 0;
  let totalExpenses = 0;
  let lowestBalance = Number.isFinite(running) ? running : 0;
  let lowestBalanceDate: YMDString = settings.startDate || (calendar.length ? calendar[0].date : "");
  let peakBalance = lowestBalance;
  let peakBalanceDate: YMDString = lowestBalanceDate;
  let firstNegativeDate: YMDString | null = null;
  let negativeDays = 0;

  for (const row of calendar) {
    const baseIncomeBeforeSales = row.income;
    if (saleEnabled) {
      const dow = fromYMD(row.date).getDay();
      const isBusinessDay = dow >= 1 && dow <= 5;
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
    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) + 1;
    const totalWeeks = totalDays / 7;
    if (totalWeeks > 0) {
      projectedWeeklyIncome = totalStreamIncome / totalWeeks;
    }
  }

  return {
    cal: calendar,
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

/**
 * Compute a cash-flow projection using expandedTransactions (simplified version)
 * @param state - Application state containing settings and expandedTransactions
 * @param overrides - Optional overrides for multiplier/transform hooks (for income streams)
 * @returns Projection summary including calendar rows and balance stats
 */
export const computeProjectionFromExpanded = (
  state: AppState,
  _overrides: ProjectionOverrides = {}
): ProjectionResult => {
  const { settings, expandedTransactions = [], adjustments = [] } = state || {};
  if (!settings) {
    throw new Error("State missing settings for projection");
  }

  const calendar = generateCalendar(settings.startDate, settings.endDate);
  const byDate = new Map(calendar.map((row) => [row.date, row]));

  // Process all expanded transactions
  for (const tx of expandedTransactions) {
    const row = byDate.get(tx.date);
    if (!row) continue;

    const amount = Math.abs(Number(tx.amount || 0));
    if (!amount) continue;

    const label = `${tx.name}${tx.category ? ` – ${tx.category}` : ''}`;

    if (tx.type === "expense") {
      row.expenses += amount;
      row.expenseDetails.push({ source: label, amount });
    } else {
      row.income += amount;
      row.incomeDetails.push({ source: label, amount });
    }
  }

  // Process adjustments
  adjustments.forEach((adj) => {
    const row = byDate.get(adj?.date);
    if (!row) return;
    const amount = Number(adj.amount || 0);
    const label = adj?.note ? `Adjustment – ${adj.note}` : "Adjustment";
    if (amount >= 0) {
      row.income += amount;
      row.incomeDetails.push({ source: label, amount });
    } else {
      const absAmount = Math.abs(amount);
      row.expenses += absAmount;
      row.expenseDetails.push({ source: label, amount: absAmount });
    }
  });

  // Calculate running balance and statistics
  let running = round2(Number(settings.startingBalance || 0));
  let totalIncome = 0;
  let totalExpenses = 0;
  let lowestBalance = Number.isFinite(running) ? running : 0;
  let lowestBalanceDate: YMDString = settings.startDate || (calendar.length ? calendar[0].date : "");
  let peakBalance = lowestBalance;
  let peakBalanceDate: YMDString = lowestBalanceDate;
  let firstNegativeDate: YMDString | null = null;
  let negativeDays = 0;

  for (const row of calendar) {
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

  // Calculate projected weekly income
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
    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) + 1;
    const totalWeeks = totalDays / 7;
    if (totalWeeks > 0) {
      // Calculate weekly income from income transactions only
      const incomeTransactions = expandedTransactions.filter(tx => tx.type === 'income');
      const totalIncomeFromTransactions = incomeTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0);
      projectedWeeklyIncome = totalIncomeFromTransactions / totalWeeks;
    }
  }

  return {
    cal: calendar,
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
