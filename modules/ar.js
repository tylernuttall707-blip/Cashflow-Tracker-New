"use strict";

import { round2 } from "./calculations.js";
import { addDays, compareYMD, rollWeekend } from "./dateUtils.js";
import {
  clamp,
  defaultAROptions,
  isValidYMDString,
  sanitizeAROptions,
} from "./validation.js";

/**
 * Collapse a value into an alphanumeric-only uppercase token.
 * @param {unknown} value - Raw value to normalize.
 * @returns {string} Normalized token without punctuation.
 */
const collapseAlphaNumeric = (value) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
};

/**
 * Normalize a company identifier for Accounts Receivable matching.
 * @param {unknown} value - Raw company value.
 * @returns {string} Normalized company token.
 */
export const normalizeCompanyKey = (value) => collapseAlphaNumeric(value);

/**
 * Normalize an invoice identifier for Accounts Receivable matching.
 * @param {unknown} value - Raw invoice value.
 * @returns {string} Normalized invoice token.
 */
export const normalizeInvoiceKey = (value) => collapseAlphaNumeric(value);

/**
 * Build a deterministic AR source key from company and invoice identifiers.
 * @param {unknown} company - Company label.
 * @param {unknown} invoice - Invoice label.
 * @returns {string|null} Combined source key or null when insufficient data.
 */
export const makeSourceKey = (company, invoice) => {
  const normCompany = normalizeCompanyKey(company);
  const normInvoice = normalizeInvoiceKey(invoice);
  if (!normCompany || !normInvoice) return null;
  return `${normCompany}#${normInvoice}`;
};

/**
 * Derive the default display name for an AR invoice.
 * @param {unknown} company - Company label.
 * @param {unknown} invoice - Invoice label.
 * @returns {string} Human readable invoice name.
 */
export const defaultARName = (company, invoice) => {
  const companyLabel = String(company ?? "").trim();
  const invoiceLabel = String(invoice ?? "").trim();
  if (companyLabel && invoiceLabel) return `(${companyLabel}) Inv #${invoiceLabel}`;
  if (invoiceLabel) return `Invoice #${invoiceLabel}`;
  if (companyLabel) return `${companyLabel} Receivable`;
  return "Receivable";
};

/**
 * Attempt to find an invoice number within free-form text.
 * @param {unknown} text - Raw descriptive text.
 * @returns {string} Detected invoice token.
 */
export const findInvoiceFromText = (text) => {
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

/**
 * Attempt to find a company identifier embedded within descriptive text.
 * @param {unknown} text - Raw descriptive text.
 * @returns {string} Detected company token.
 */
export const findCompanyFromName = (text) => {
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

/**
 * Derive a best-effort key for a cash movement to support deduplication.
 * @param {object} entry - Cash movement or one-off entry.
 * @returns {string|null} Deterministic dedupe key or null when unknown.
 */
export const deriveCashMovementKey = (entry) => {
  if (!entry || typeof entry !== "object") return null;
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

/**
 * Score the relative desirability of a cash movement entry for dedupe decisions.
 * @param {object|null|undefined} entry - Candidate entry.
 * @returns {number} Higher score indicates a better entry to keep.
 */
const scoreCashMovementStatus = (entry) => {
  if (!entry || entry.status === "archived") return 0;
  return 1;
};

/**
 * Parse an ISO date string into milliseconds since epoch for last-seen comparison.
 * @param {unknown} value - Raw last-seen value.
 * @returns {number} Parsed timestamp or 0 on failure.
 */
const parseLastSeenAt = (value) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Select the preferred entry between two potential duplicates.
 * @param {object} current - Current winning entry.
 * @param {object} candidate - Candidate entry to compare.
 * @returns {object} Entry that should be kept.
 */
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

/**
 * Detect duplicate AR-derived cash movements within a list of entries.
 *
 * The function groups candidate entries by their derived source key, selects a
 * preferred entry for each group, and returns the duplicates that should be
 * removed.
 *
 * @param {Array<object>} entries - Collection of one-off cash movement entries.
 * @returns {{removal: Array<object>, groups: Map<string, Array<object>>}}
 *   Removal list alongside the grouping map for inspection.
 */
export const detectDuplicateCashMovements = (entries = []) => {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const isARSource = entry.source === "AR" || Boolean(entry.sourceKey);
    const arCategory =
      typeof entry.category === "string" && entry.category.toLowerCase().startsWith("ar");
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
  for (const list of groups.values()) {
    if (!Array.isArray(list) || list.length <= 1) continue;
    let keep = list[0];
    for (let i = 1; i < list.length; i += 1) {
      keep = pickPreferredCashMovement(keep, list[i]);
    }
    for (const entry of list) {
      if (entry !== keep) removal.push(entry);
    }
  }

  return { removal, groups };
};

/**
 * Compute the expected payment date based on due date and AR options.
 * @param {string} dueYMD - Raw due date in YYYY-MM-DD format.
 * @param {object} [options] - AR options controlling weekend roll and lag.
 * @returns {string} Expected payment date or empty string when invalid.
 */
export const computeExpectedDate = (dueYMD, options) => {
  if (!dueYMD || !isValidYMDString(dueYMD)) return dueYMD || "";
  const opts = options ? sanitizeAROptions({ ...defaultAROptions(), ...options }) : defaultAROptions();
  const rolled = rollWeekend(dueYMD, opts.roll || "forward");
  const lagDays = Number.isFinite(Number(opts.lag)) ? Math.trunc(Number(opts.lag)) : 0;
  return addDays(rolled, lagDays);
};

/**
 * Resolve the category to use for an AR-derived transaction amount.
 * @param {number} amount - Monetary amount for the receivable.
 * @param {object} [options] - AR options containing category overrides.
 * @returns {string} Category label for the transaction.
 */
export const computeARCategory = (amount, options) => {
  const opts = options ? sanitizeAROptions({ ...defaultAROptions(), ...options }) : defaultAROptions();
  const defaultCategory = String(opts.category || "AR").trim() || "AR";
  return Number(amount) < 0 ? "AR Credit" : defaultCategory;
};

/**
 * Build a projected transaction preview for an AR import row.
 * @param {object} row - Normalized AR row containing invoice metadata.
 * @param {object} [options] - AR options controlling confidence and category.
 * @returns {object|null} Preview transaction or null when insufficient data.
 */
export const buildPreviewEntry = (row, options) => {
  if (!row || typeof row !== "object") return null;
  const opts = options ? sanitizeAROptions({ ...defaultAROptions(), ...options }) : defaultAROptions();
  const sourceKey = row.sourceKey || makeSourceKey(row.company, row.invoice);
  if (!sourceKey) return null;
  const expected = row.expectedDate && isValidYMDString(row.expectedDate) ? row.expectedDate : null;
  const amountValue = Number(row.amount);
  if (!Number.isFinite(amountValue) || amountValue === 0) return null;
  const name = row.name && String(row.name).trim();
  if (!expected || !name) return null;
  const confidence = clamp(Number(opts.conf || 0), 0, 100);
  return {
    date: expected,
    type: "income",
    name,
    category: computeARCategory(amountValue, opts),
    amount: round2(amountValue),
    source: "AR",
    sourceKey,
    status: "pending",
    dueDate: row.dueDate || null,
    company: row.company || "",
    invoice: row.invoice || "",
    confidencePct: confidence,
  };
};

/**
 * Determine whether an existing AR one-off entry matches a preview entry.
 * @param {object|null} existing - Existing one-off entry, if any.
 * @param {object|null} preview - Preview entry generated from the importer.
 * @returns {boolean} True when the entries are effectively identical.
 */
export const isAREntrySame = (existing, preview) => {
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
