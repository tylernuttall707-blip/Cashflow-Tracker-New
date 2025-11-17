/**
 * A/R (Accounts Receivable) Controller
 *
 * Handles UI interactions, file parsing, column detection, preview rendering,
 * and import operations for the Accounts Receivable importer.
 */

"use strict";

/**
 * Global type declarations for third-party libraries
 */

// Papa Parse CSV library
declare const Papa: {
  parse: (
    file: File,
    config: {
      header: boolean;
      skipEmptyLines: boolean;
      complete: (results: any) => void;
      error: (err: any) => void;
    }
  ) => void;
};

// XLSX Excel library
declare const XLSX: {
  read: (data: Uint8Array, config: { type: string }) => any;
  utils: {
    sheet_to_json: (sheet: any, config: { header: number; defval: string }) => any[][];
  };
};

import { round2, parseMoney } from "../modules/calculations.js";
import { addDays, compareYMD, parseExcelOrISODate } from "../modules/dateUtils.js";
import { clamp, sanitizeAROptions, defaultAROptions, sanitizeARMapping, defaultARMappingOverrides, isValidYMDString } from "../modules/validation.js";
import {
  makeSourceKey,
  defaultARName,
  computeExpectedDate,
  buildPreviewEntry,
  isAREntrySame,
} from "../modules/ar.js";
import type { AROptions, ARMappingOverrides, ARPreferences, Transaction } from "../types/index.js";

/**
 * Type definitions for AR controller
 */

/** Raw parsed row from CSV/Excel file */
interface RawARRow {
  values: Record<string, unknown>;
  firstCell: unknown;
}

/** Parsed file result */
interface ParsedFileResult {
  rows: RawARRow[];
  headers: string[];
}

/** Column detection result */
interface ColumnDetectionResult {
  mapping: Record<string, string>;
  scores: Record<string, number>;
  aux: Record<string, string>;
}

/** AR row with UI state */
interface ARRow {
  id: string;
  company: string;
  invoice: string;
  dueDate: string;
  expectedDate: string;
  baseAmount: number;
  amount: number;
  name: string;
  manualExpected: boolean;
  manualAmount: boolean;
  manualName: boolean;
  userSelected: boolean;
  selected: boolean;
  errors: Record<string, boolean>;
  valid: boolean;
  action: "add" | "update" | "same";
  previewEntry: ReturnType<typeof buildPreviewEntry> | null;
  sourceKey?: string;
  existing?: Transaction | null;
  confidence?: number;
}

/** AR controller state */
interface ARState {
  rows: ARRow[];
  mapping: Record<string, string>;
  aux: Record<string, string>;
  headerOrder: string[];
  page: number;
  perPage: number;
  parsing: boolean;
  summary: {
    added: number;
    updated: number;
    unchanged: number;
    archived: number;
    skipped: number;
  } | null;
  detection: ColumnDetectionResult | null;
  lastRange: { start: number; end: number };
  options: AROptions;
  mappingOverrides: ARMappingOverrides;
  duplicatesRemoved: number;
  presentKeys: Set<string>;
}

/**
 * Constants
 */

const AR_PREFS_STORAGE_KEY = "cashflow2025_arPrefs_v1";

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

/**
 * Utility functions
 */

/** DOM query selector helper */
const $ = <T extends Element = Element>(sel: string, ctx: Document | Element = document): T | null =>
  ctx.querySelector<T>(sel);

/** Escape HTML special characters */
const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Format count with thousands separator */
const fmtCount = (value: number): string => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
};

/** Generate unique ID */
const uid = (): string => Math.random().toString(36).slice(2, 9);

/**
 * Column Detection & Parsing Helpers
 */

/**
 * Normalize a header label for fuzzy matching.
 */
const normalizeHeaderLabel = (value: unknown): string =>
  String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Detect AR columns from headers using fuzzy matching.
 */
const detectARColumns = (headers: string[] = []): ColumnDetectionResult => {
  const normalized = headers.map((header) => ({ raw: header, norm: normalizeHeaderLabel(header) }));

  const evaluate = (candidates: string[]) => {
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

/**
 * Resolve a column name from headers (exact or fuzzy match).
 */
const resolveColumnName = (headers: string[] = [], name: string): string => {
  if (!name) return "";
  const direct = headers.find((header) => String(header) === name);
  if (direct !== undefined) return direct;
  const norm = normalizeHeaderLabel(name);
  if (!norm) return name;
  const match = headers.find((header) => normalizeHeaderLabel(header) === norm);
  return match || name;
};

/**
 * Parse net payment terms (e.g., "Net 30" => 30).
 */
const parseNetTerms = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  const netMatch = str.match(/net\s*(\d+)/i);
  if (netMatch && Number.isFinite(Number(netMatch[1]))) return Number(netMatch[1]);
  const daysMatch = str.match(/(\d+)\s*day/i);
  if (daysMatch && Number.isFinite(Number(daysMatch[1]))) return Number(daysMatch[1]);
  return null;
};

/**
 * Check if a cell value is empty (null, undefined, whitespace, or dashes).
 */
const isEmptyCell = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (/^[-–—]+$/.test(trimmed)) return true;
    return false;
  }
  return false;
};

/**
 * Check if a header is an aging bucket column.
 */
const isAgingBucketHeader = (header: unknown): boolean => {
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

/**
 * Detect aging bucket columns from parsed rows.
 */
const detectAgingBucketColumns = (rows: RawARRow[]): string[] => {
  const seen = new Set<string>();
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

/**
 * Pick the better duplicate row based on due date and amount.
 */
const pickBetterDuplicate = (existing: ARRow | undefined, candidate: ARRow): ARRow => {
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

/**
 * Normalize raw parsed rows into AR rows.
 */
const normalizeARRows = (
  rawRows: RawARRow[],
  mapping: Record<string, string>,
  aux: Record<string, string>
): {
  rows: ARRow[];
  skipped: number;
  duplicatesRemoved: number;
  presentKeys: Set<string>;
} => {
  const noKeyRows: ARRow[] = [];
  const keyOrder: string[] = [];
  const dedup = new Map<string, ARRow>();
  const presentKeys = new Set<string>();
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

    // Skip total/summary rows
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

    // Handle aging bucket columns
    const bucketValues = bucketColumns.map((column) => ({
      column,
      raw: raw[column],
      number: parseMoney(raw[column]),
    }));
    const bucketHasAny = bucketValues.some((entry) => !isEmptyCell(entry.raw));
    const bucketSum = bucketValues.reduce(
      (total, entry) => (Number.isFinite(entry.number) ? total + entry.number : total),
      0
    );
    const bucketHasNonZero = bucketValues.some((entry) => Number.isFinite(entry.number) && entry.number !== 0);

    const hasDueRaw = !isEmptyCell(dueRaw);
    const hasMappedAmountRaw = !isEmptyCell(amountRaw);

    // Detect company-only header rows
    if (!company && invoice && !hasDueRaw && !hasMappedAmountRaw && !bucketHasAny) {
      currentCompany = invoice;
      continue;
    }

    // Use current company if none specified
    if (!company && currentCompany) {
      company = currentCompany;
    }

    // Parse due date
    let dueDate = parseExcelOrISODate(dueRaw as any);
    const invoiceDate = parseExcelOrISODate(invoiceDateRaw as any);
    if (!dueDate) {
      const netDays = parseNetTerms(termsRaw);
      if (invoiceDate && netDays !== null && Number.isFinite(netDays)) {
        dueDate = addDays(invoiceDate, netDays);
      }
    }

    // Parse amount (use bucket sum if available and valid)
    let baseAmount = parseMoney(amountRaw);
    const hasMappedAmount = Number.isFinite(baseAmount) && baseAmount !== 0;
    const hasBucketAmount = bucketColumns.length > 0 && (bucketHasNonZero || (!hasMappedAmount && bucketHasAny));
    if (hasBucketAmount) {
      baseAmount = bucketSum;
    }

    // Skip invalid rows
    if (!company || !invoice || !dueDate || !Number.isFinite(baseAmount) || baseAmount === 0) {
      skipped += 1;
      continue;
    }

    const row: ARRow = {
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

    const sourceKey = makeSourceKey(company, invoice);
    row.sourceKey = sourceKey || undefined;
    if (sourceKey) {
      presentKeys.add(sourceKey);
      if (!dedup.has(sourceKey)) {
        dedup.set(sourceKey, row);
        keyOrder.push(sourceKey);
      } else {
        const current = dedup.get(sourceKey);
        const preferred = pickBetterDuplicate(current, row);
        if (preferred !== current) {
          dedup.set(sourceKey, preferred);
        }
        duplicatesRemoved += 1;
      }
    } else {
      noKeyRows.push(row);
    }
  }

  const keyedRows = keyOrder.map((key) => dedup.get(key)!).filter(Boolean);
  return { rows: [...keyedRows, ...noKeyRows], skipped, duplicatesRemoved, presentKeys };
};

/**
 * Parse an AR file (CSV or Excel).
 */
const parseARFile = (file: File): Promise<ParsedFileResult> =>
  new Promise((resolve, reject) => {
    if (!file) {
      resolve({ rows: [], headers: [] });
      return;
    }

    const ext = file.name?.split(".").pop()?.toLowerCase();

    // Parse CSV
    if (ext === "csv") {
      if (typeof Papa === "undefined") {
        reject(new Error("CSV parser unavailable"));
        return;
      }
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results: any) => {
          try {
            const headers = (results.meta?.fields || []).map((h: any) => String(h ?? "").trim());
            const firstField = headers[0];
            const rows = (results.data || [])
              .map((row: any) => {
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
        error: (err: any) => reject(err || new Error("Failed to parse CSV")),
      });
      return;
    }

    // Parse Excel
    if (ext === "xlsx" || ext === "xls") {
      if (typeof XLSX === "undefined") {
        reject(new Error("Excel parser unavailable"));
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        try {
          const data = new Uint8Array(ev.target!.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const rowsArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
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
              const values: Record<string, unknown> = {};
              headers.forEach((header, idx) => {
                values[header] = arr[idx];
              });
              return { values, firstCell: arr[0] };
            })
            .filter((row): row is RawARRow => row !== null);
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

/**
 * AR Controller Class
 */
export class ARController {
  private state: ARState;
  private globalState: any; // Reference to STATE from app.js
  private saveStateFn: (state: any) => void;
  private recalcAndRenderFn: () => void;

  constructor(
    globalState: any,
    saveStateFn: (state: any) => void,
    recalcAndRenderFn: () => void
  ) {
    this.globalState = globalState;
    this.saveStateFn = saveStateFn;
    this.recalcAndRenderFn = recalcAndRenderFn;

    // Load preferences
    const prefs = this.loadPreferences();

    // Initialize state
    this.state = {
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
      options: prefs.options,
      mappingOverrides: prefs.mapping,
      duplicatesRemoved: 0,
      presentKeys: new Set(),
    };
  }

  /**
   * Initialize AR importer UI and event handlers.
   */
  public init(): void {
    this.initFormControls();
    this.attachEventListeners();
  }

  /**
   * Initialize form controls with saved preferences.
   */
  private initFormControls(): void {
    const rollSelect = $<HTMLSelectElement>("#arRoll");
    const lagInput = $<HTMLInputElement>("#arLag");
    const confInput = $<HTMLInputElement>("#arConf");
    const categoryInput = $<HTMLInputElement>("#arCategory");
    const pruneInput = $<HTMLInputElement>("#arPrune");

    if (rollSelect) rollSelect.value = this.state.options.roll;
    if (lagInput) lagInput.value = String(this.state.options.lag ?? 0);
    if (confInput) confInput.value = String(this.state.options.conf ?? 100);
    if (categoryInput) categoryInput.value = this.state.options.category || "AR";
    if (pruneInput) pruneInput.checked = Boolean(this.state.options.prune);

    // Set mapping overrides
    const mappingFields: Array<[string, keyof ARMappingOverrides]> = [
      ["#colCompany", "company"],
      ["#colInvoice", "invoice"],
      ["#colDue", "due"],
      ["#colAmount", "amount"],
    ];

    for (const [selector, key] of mappingFields) {
      const input = $<HTMLInputElement>(selector);
      if (!input) continue;
      if (this.state.mappingOverrides[key]) {
        input.value = this.state.mappingOverrides[key];
      }
    }

    const importBtn = $<HTMLButtonElement>("#arImportBtn");
    if (importBtn) importBtn.dataset.baseLabel = importBtn.textContent || "Import";
  }

  /**
   * Attach all event listeners.
   */
  private attachEventListeners(): void {
    // Parse button
    $<HTMLButtonElement>("#arParseBtn")?.addEventListener("click", () => this.handleParse());

    // Recalc button
    $<HTMLButtonElement>("#arRecalcBtn")?.addEventListener("click", () => this.handleRecalc());

    // Import button
    $<HTMLButtonElement>("#arImportBtn")?.addEventListener("click", () => this.handleImport());

    // Select all checkbox
    $<HTMLInputElement>("#arSelectAll")?.addEventListener("change", (e) => this.handleSelectAll(e));

    // Preview table
    const previewTable = $("#arPreview");
    previewTable?.addEventListener("input", (e) => this.handleTableInput(e));
    previewTable?.addEventListener("change", (e) => this.handleTableChange(e));

    // Pagination
    $("#arPagination")?.addEventListener("click", (e) => this.handlePageClick(e));

    // Options
    this.attachOptionListeners();

    // Column mapping
    this.attachMappingListeners();
  }

  /**
   * Attach option change listeners.
   */
  private attachOptionListeners(): void {
    const rollSelect = $<HTMLSelectElement>("#arRoll");
    rollSelect?.addEventListener("change", (e) => {
      const val = (e.target as HTMLSelectElement).value || "forward";
      this.state.options.roll = ["forward", "back", "none"].includes(val as any) ? (val as any) : "forward";
      this.savePreferences();
      if (this.state.rows.length) {
        this.recalcRows();
        this.renderPreview();
      }
    });

    const lagInput = $<HTMLInputElement>("#arLag");
    lagInput?.addEventListener("change", () => {
      const val = Number(lagInput.value || 0);
      const normalized = Number.isFinite(val) ? Math.max(0, Math.trunc(val)) : 0;
      this.state.options.lag = normalized;
      lagInput.value = String(normalized);
      this.savePreferences();
      if (this.state.rows.length) {
        this.recalcRows();
        this.renderPreview();
      }
    });

    const confInput = $<HTMLInputElement>("#arConf");
    confInput?.addEventListener("change", () => {
      const val = Number(confInput.value || 0);
      const normalized = clamp(Number.isFinite(val) ? val : 0, 0, 100);
      this.state.options.conf = normalized;
      confInput.value = String(normalized);
      this.savePreferences();
      if (this.state.rows.length) {
        this.recalcRows();
        this.renderPreview();
      }
    });

    const categoryInput = $<HTMLInputElement>("#arCategory");
    categoryInput?.addEventListener("input", () => {
      this.state.options.category = categoryInput.value;
      this.savePreferences();
      if (this.state.rows.length) {
        this.recalcRows();
        this.renderPreview();
      }
    });

    const pruneInput = $<HTMLInputElement>("#arPrune");
    pruneInput?.addEventListener("change", () => {
      this.state.options.prune = pruneInput.checked;
      this.savePreferences();
    });
  }

  /**
   * Attach column mapping listeners.
   */
  private attachMappingListeners(): void {
    const mappingFields: Array<[string, keyof ARMappingOverrides]> = [
      ["#colCompany", "company"],
      ["#colInvoice", "invoice"],
      ["#colDue", "due"],
      ["#colAmount", "amount"],
    ];

    for (const [selector, key] of mappingFields) {
      const input = $<HTMLInputElement>(selector);
      if (!input) continue;
      input.addEventListener("change", () => {
        this.state.mappingOverrides[key] = input.value.trim();
        this.savePreferences();
      });
    }
  }

  /**
   * Load AR preferences from localStorage.
   */
  private loadPreferences(): ARPreferences {
    try {
      const raw = localStorage.getItem(AR_PREFS_STORAGE_KEY);
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
  }

  /**
   * Save AR preferences to localStorage.
   */
  private savePreferences(): void {
    try {
      const payload = {
        options: {
          roll: this.state.options.roll,
          lag: this.state.options.lag,
          conf: this.state.options.conf,
          category: this.state.options.category,
          prune: this.state.options.prune,
        },
        mapping: { ...this.state.mappingOverrides },
      };
      localStorage.setItem(AR_PREFS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures
    }
  }

  /**
   * Find a one-off transaction by source key.
   */
  private findOneOffBySourceKey(key: string | undefined): Transaction | undefined {
    if (!key) return undefined;
    return (this.globalState.oneOffs || []).find(
      (tx: Transaction) => tx && (tx as any).source === "AR" && (tx as any).sourceKey === key
    );
  }

  /**
   * Validate an AR row.
   */
  private validateRow(row: ARRow): boolean {
    if (!row) return false;
    const errors: Record<string, boolean> = {};
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
  }

  /**
   * Update the action for an AR row (add/update/same).
   */
  private updateRowAction(row: ARRow): void {
    if (!row) return;
    const preview = buildPreviewEntry(row, this.state.options);
    row.previewEntry = preview;
    const sourceKey = preview?.sourceKey || makeSourceKey(row.company, row.invoice);
    row.sourceKey = sourceKey || undefined;
    const existing = this.findOneOffBySourceKey(row.sourceKey);
    row.existing = existing || null;
    if (!row.sourceKey) {
      row.action = "add";
      return;
    }
    if (!existing) {
      row.action = "add";
      return;
    }
    row.action = preview && isAREntrySame(existing as any, preview) ? "same" : "update";
  }

  /**
   * Sync row selection based on action.
   */
  private syncRowSelection(row: ARRow): void {
    if (!row) return;
    if (!row.valid) {
      row.selected = false;
      return;
    }
    if (row.userSelected) return;
    row.selected = row.action !== "same";
  }

  /**
   * Refresh an AR row (recalculate expected date, amount, name).
   */
  private refreshRow(
    row: ARRow,
    options: {
      dueChanged?: boolean;
      forceExpected?: boolean;
      forceAmount?: boolean;
      forceName?: boolean;
    } = {}
  ): void {
    if (!row) return;
    if (options.dueChanged) row.manualExpected = false;
    const conf = clamp(Number(this.state.options.conf || 0), 0, 100);
    row.confidence = conf;

    if (options.forceExpected || options.dueChanged || (!row.manualExpected && row.dueDate)) {
      row.expectedDate = computeExpectedDate(row.dueDate, this.state.options);
    }
    if (options.forceAmount || (!row.manualAmount && Number.isFinite(row.baseAmount))) {
      row.amount = round2(row.baseAmount * (conf / 100));
    }
    if (options.forceName || (!row.manualName && row.company !== undefined)) {
      row.name = defaultARName(row.company, row.invoice);
    }
    const sourceKey = makeSourceKey(row.company, row.invoice);
    row.sourceKey = sourceKey || undefined;
    this.updateRowAction(row);
    this.validateRow(row);
    this.syncRowSelection(row);
  }

  /**
   * Recalculate all rows.
   */
  private recalcRows(options: { force?: boolean } = {}): void {
    if (!this.state.rows.length) return;
    for (const row of this.state.rows) {
      if (options.force) {
        row.manualExpected = false;
        row.manualAmount = false;
      }
      const shouldExpected = Boolean(options.force || (!row.manualExpected && row.dueDate));
      const shouldAmount = Boolean(options.force || (!row.manualAmount && Number.isFinite(row.baseAmount)));
      this.refreshRow(row, {
        forceExpected: shouldExpected,
        forceAmount: shouldAmount,
        forceName: false,
      });
    }
  }

  /**
   * Update select all checkbox state.
   */
  private updateSelectAllState(): void {
    const selectAll = $<HTMLInputElement>("#arSelectAll");
    if (!selectAll) return;
    const selectableRows = this.state.rows.filter((row) => row.valid && row.action !== "same");
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
  }

  /**
   * Update import button state.
   */
  private updateImportButton(): void {
    const btn = $<HTMLButtonElement>("#arImportBtn");
    if (!btn) return;
    const baseLabel = btn.dataset.baseLabel || btn.textContent || "Import";
    if (this.state.parsing) {
      btn.disabled = true;
      btn.textContent = baseLabel;
      return;
    }
    const selected = this.state.rows.filter((row) => row.valid && row.selected).length;
    btn.disabled = selected === 0;
    btn.textContent = selected > 0 ? `${baseLabel} (${selected})` : baseLabel;
  }

  /**
   * Update status message.
   */
  private updateStatus(message = "", kind: "error" | "success" | "" = ""): void {
    const el = $("#arStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("error", "success");
    if (kind) el.classList.add(kind);
  }

  /**
   * Apply row data to DOM element.
   */
  private applyRowToDOM(row: ARRow): void {
    const tbody = $("#arPreview tbody");
    if (!tbody) return;
    const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
    if (!tr) return;
    tr.classList.toggle("invalid", !row.valid);
    const checkbox = tr.querySelector<HTMLInputElement>('input[type="checkbox"][data-act="toggleRow"]');
    if (checkbox) {
      checkbox.disabled = !row.valid;
      checkbox.checked = Boolean(row.valid && row.selected);
    }
    tr.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
      const field = input.dataset.field as keyof ARRow;
      let value: string | number = row[field] as any;
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
        input.value = String(value);
      }
      const hasError = Boolean(row.errors?.[field as string]);
      input.classList.toggle("invalid", hasError);
      const cell = input.closest("td");
      if (cell) cell.classList.toggle("invalid-cell", hasError);
    });
    const badge = tr.querySelector("[data-badge]");
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
  }

  /**
   * Render pagination controls.
   */
  private renderPagination(): void {
    const container = $("#arPagination");
    if (!container) return;
    container.innerHTML = "";
    const total = this.state.rows.length;
    if (!total) return;
    const perPage = this.state.perPage || total;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const info = document.createElement("span");
    const start = Math.min(this.state.lastRange.start, total) || (total ? 1 : 0);
    const end = Math.min(this.state.lastRange.end, total);
    info.textContent = `Rows ${start}-${end} of ${total}`;

    const pageInfo = document.createElement("span");
    pageInfo.textContent = pages > 1 ? `Page ${this.state.page} of ${pages}` : "";

    const pager = document.createElement("div");
    pager.className = "pager";
    const prev = document.createElement("button");
    prev.textContent = "Prev";
    prev.disabled = this.state.page <= 1;
    prev.dataset.page = String(this.state.page - 1);
    const next = document.createElement("button");
    next.textContent = "Next";
    next.disabled = this.state.page >= pages;
    next.dataset.page = String(this.state.page + 1);
    pager.appendChild(prev);
    pager.appendChild(next);

    container.appendChild(info);
    if (pageInfo.textContent) container.appendChild(pageInfo);
    if (pages > 1) container.appendChild(pager);
  }

  /**
   * Render import summary.
   */
  private renderSummary(): void {
    const el = $("#arSummary");
    if (!el) return;
    if (!this.state.summary) {
      el.textContent = "";
      return;
    }
    const { added = 0, updated = 0, unchanged = 0, archived = 0, skipped = 0 } = this.state.summary;
    const parts = [
      `Added ${fmtCount(added)}`,
      `Updated ${fmtCount(updated)}`,
      `Unchanged ${fmtCount(unchanged)}`,
      `Archived ${fmtCount(archived)}`,
    ];
    if (skipped) parts.push(`Skipped ${fmtCount(skipped)}`);
    el.textContent = `Last import: ${parts.join(" • ")}`;
  }

  /**
   * Render row counters.
   */
  private renderCounters(): void {
    const el = $("#arCounters");
    if (!el) return;
    if (!this.state.rows.length) {
      el.textContent = "";
      return;
    }
    let add = 0;
    let update = 0;
    let same = 0;
    for (const row of this.state.rows) {
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
    if (this.state.duplicatesRemoved) {
      parts.push(`Duplicates removed ${fmtCount(this.state.duplicatesRemoved)}`);
    }
    el.textContent = parts.join(" • ");
  }

  /**
   * Render AR preview table.
   */
  private renderPreview(): void {
    const tbody = $("#arPreview tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const selectAll = $<HTMLInputElement>("#arSelectAll");
    if (selectAll) {
      selectAll.disabled = this.state.rows.length === 0;
      if (this.state.rows.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
    }
    if (!this.state.rows.length) {
      this.state.lastRange = { start: 0, end: 0 };
      this.updateImportButton();
      this.updateSelectAllState();
      this.renderPagination();
      this.renderSummary();
      this.renderCounters();
      return;
    }
    const perPage = this.state.perPage || this.state.rows.length;
    const totalPages = Math.max(1, Math.ceil(this.state.rows.length / perPage));
    if (this.state.page > totalPages) this.state.page = totalPages;
    const startIndex = (this.state.page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, this.state.rows.length);
    const pageRows = this.state.rows.slice(startIndex, endIndex);
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
      this.applyRowToDOM(row);
    }
    this.state.lastRange = { start: startIndex + 1, end: endIndex };
    this.updateImportButton();
    this.updateSelectAllState();
    this.renderPagination();
    this.renderSummary();
    this.renderCounters();
  }

  /**
   * Handle file parse.
   */
  private async handleParse(): Promise<void> {
    const fileInput = $<HTMLInputElement>("#arFile");
    const file = fileInput?.files?.[0];
    if (!file) {
      this.updateStatus("Choose a CSV/XLS(X) file to preview.", "error");
      return;
    }
    this.state.parsing = true;
    this.updateStatus("Parsing receivables…");
    this.updateImportButton();
    try {
      const { rows: rawRows, headers } = await parseARFile(file);
      if (!headers.length && !rawRows.length) {
        this.state.rows = [];
        this.renderPreview();
        this.updateStatus("No data rows found in file.", "error");
        return;
      }
      const detection = detectARColumns(headers);
      this.state.detection = detection;

      // Apply suggestions to mapping inputs
      const applySuggestion = (selector: string, suggestion: string) => {
        const input = $<HTMLInputElement>(selector);
        if (!input) return;
        if (!input.value && suggestion) input.value = suggestion;
      };
      applySuggestion("#colCompany", detection.mapping.company);
      applySuggestion("#colInvoice", detection.mapping.invoice);
      applySuggestion("#colDue", detection.mapping.due);
      applySuggestion("#colAmount", detection.mapping.amount);

      const mappingInput = {
        company: $<HTMLInputElement>("#colCompany")?.value?.trim() || "",
        invoice: $<HTMLInputElement>("#colInvoice")?.value?.trim() || "",
        due: $<HTMLInputElement>("#colDue")?.value?.trim() || "",
        amount: $<HTMLInputElement>("#colAmount")?.value?.trim() || "",
      };

      this.state.mappingOverrides = sanitizeARMapping(mappingInput);
      this.savePreferences();

      const resolvedMapping = {
        company: resolveColumnName(headers, mappingInput.company),
        invoice: resolveColumnName(headers, mappingInput.invoice),
        due: resolveColumnName(headers, mappingInput.due),
        amount: resolveColumnName(headers, mappingInput.amount),
      };

      const missing = Object.entries(resolvedMapping).filter(([, column]) => !column || !headers.includes(column));
      if (missing.length) {
        const fields = missing.map(([key]) => key).join(", ");
        this.updateStatus(`Column not found for: ${fields}`, "error");
        this.state.rows = [];
        this.renderPreview();
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
        this.state.rows = [];
        this.renderPreview();
        this.updateStatus("No valid invoice rows detected. Check your column mapping.", "error");
        return;
      }

      const limitedRows = normalizedRows.slice(0, 5000);
      this.state.rows = limitedRows;
      this.state.mapping = resolvedMapping;
      this.state.aux = resolvedAux;
      this.state.duplicatesRemoved = duplicatesRemoved;
      this.state.presentKeys = new Set(presentKeys || []);
      this.state.page = 1;
      this.state.perPage = limitedRows.length > 1000 ? 200 : Math.max(limitedRows.length, 1);
      this.state.summary = null;

      for (const row of this.state.rows) {
        row.manualAmount = false;
        row.manualExpected = false;
        row.manualName = false;
        row.userSelected = false;
        this.refreshRow(row, { dueChanged: true, forceExpected: true, forceAmount: true, forceName: true });
      }

      const validCount = this.state.rows.filter((row) => row.valid).length;
      const truncated = normalizedRows.length > limitedRows.length;
      const parts = [];
      parts.push(`${rawRows.length} rows parsed`);
      parts.push(`${validCount} ready`);
      if (skipped) parts.push(`${skipped} skipped`);
      if (truncated) parts.push(`showing first ${limitedRows.length}`);
      if (duplicatesRemoved) parts.push(`${duplicatesRemoved} duplicates merged`);
      const lowConfidence = Object.values(detection.scores || {}).some((score) => score < 2);
      if (lowConfidence) parts.push("check column mapping");

      this.renderPreview();
      this.updateStatus(parts.join(" · "));
    } catch (err: any) {
      const message = err?.message || String(err);
      this.updateStatus(`Failed to parse file: ${message}`, "error");
    } finally {
      this.state.parsing = false;
      this.updateImportButton();
    }
  }

  /**
   * Handle recalc button click.
   */
  private handleRecalc(): void {
    if (!this.state.rows.length) {
      this.updateStatus("Nothing to recalculate yet.", "error");
      return;
    }
    this.recalcRows({ force: true });
    this.renderPreview();
    this.updateStatus("Recalculated using current options.", "success");
  }

  /**
   * Handle select all checkbox.
   */
  private handleSelectAll(event: Event): void {
    const checked = Boolean((event.target as HTMLInputElement).checked);
    for (const row of this.state.rows) {
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
      tbody.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-act="toggleRow"]').forEach((checkbox) => {
        const id = checkbox.dataset.id;
        const row = this.state.rows.find((r) => r.id === id);
        if (!row) return;
        checkbox.checked = Boolean(row.valid && row.selected);
      });
    }
    this.updateImportButton();
    this.updateSelectAllState();
  }

  /**
   * Handle table input changes.
   */
  private handleTableInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (!target.matches("[data-field]")) return;
    const id = target.dataset.id;
    const field = target.dataset.field as keyof ARRow;
    const row = this.state.rows.find((r) => r.id === id);
    if (!row) return;
    const value = target.value;
    switch (field) {
      case "company":
        row.company = value;
        this.refreshRow(row, { forceName: !row.manualName });
        break;
      case "invoice":
        row.invoice = value;
        this.refreshRow(row, { forceName: !row.manualName });
        break;
      case "dueDate":
        row.dueDate = value;
        this.refreshRow(row, { dueChanged: true, forceExpected: true });
        break;
      case "expectedDate":
        row.expectedDate = value;
        row.manualExpected = true;
        this.updateRowAction(row);
        this.validateRow(row);
        this.syncRowSelection(row);
        break;
      case "amount":
        row.amount = Number.isFinite(Number(value)) ? round2(Number(value)) : (Number(value) as any);
        row.manualAmount = true;
        this.updateRowAction(row);
        this.validateRow(row);
        this.syncRowSelection(row);
        break;
      case "name":
        row.name = value;
        row.manualName = true;
        this.updateRowAction(row);
        this.validateRow(row);
        this.syncRowSelection(row);
        break;
      default:
        break;
    }
    this.applyRowToDOM(row);
    this.updateImportButton();
    this.updateSelectAllState();
    this.renderCounters();
  }

  /**
   * Handle table change events (checkboxes).
   */
  private handleTableChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.matches('input[type="checkbox"][data-act="toggleRow"]')) {
      const id = target.dataset.id;
      const row = this.state.rows.find((r) => r.id === id);
      if (!row) return;
      if (!row.valid) {
        target.checked = false;
        row.selected = false;
      } else {
        row.selected = target.checked;
        row.userSelected = true;
      }
      this.updateImportButton();
      this.updateSelectAllState();
      return;
    }
    if (target.matches("[data-field]")) {
      this.handleTableInput(event);
    }
  }

  /**
   * Handle pagination click.
   */
  private handlePageClick(event: Event): void {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (!btn) return;
    const page = Number(btn.dataset.page);
    if (!Number.isFinite(page)) return;
    if (page < 1) return;
    const perPage = this.state.perPage || this.state.rows.length;
    const totalPages = Math.max(1, Math.ceil(this.state.rows.length / perPage));
    if (page > totalPages) return;
    this.state.page = page;
    this.renderPreview();
  }

  /**
   * Handle import button click.
   */
  private handleImport(): void {
    const selectedRows = this.state.rows.filter((row) => row.valid && row.selected);
    if (!selectedRows.length) {
      this.updateStatus("No rows selected for import.", "error");
      return;
    }
    const timestamp = new Date().toISOString();
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let archived = 0;
    let skipped = 0;
    let changed = false;
    const touchedKeys = new Set<string>();

    for (const row of selectedRows) {
      const preview = row.previewEntry || buildPreviewEntry(row, this.state.options);
      if (!preview || !preview.sourceKey) {
        skipped += 1;
        row.selected = false;
        row.userSelected = false;
        continue;
      }
      const existing = this.findOneOffBySourceKey(preview.sourceKey);
      if (!existing) {
        const entry = {
          ...preview,
          id: uid(),
          lastSeenAt: timestamp,
          status: "pending",
          company: row.company || "",
          invoice: row.invoice || "",
          dueDate: row.dueDate || null,
          recurring: false,
          steps: [],
          escalatorPct: 0,
        };
        this.globalState.oneOffs.push(entry);
        added += 1;
        changed = true;
      } else {
        const same = row.action === "same" && (existing as any).status !== "archived" && isAREntrySame(existing as any, preview);
        Object.assign(existing, {
          ...preview,
          id: (existing as any).id,
          lastSeenAt: timestamp,
          status: "pending",
          company: row.company || (existing as any).company || "",
          invoice: row.invoice || (existing as any).invoice || "",
          dueDate: row.dueDate || (existing as any).dueDate || null,
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

    // Update lastSeenAt for unchanged rows
    for (const row of this.state.rows) {
      if (!row.previewEntry || !row.previewEntry.sourceKey) continue;
      const existing = this.findOneOffBySourceKey(row.previewEntry.sourceKey);
      if (!existing) continue;
      if (!touchedKeys.has(row.previewEntry.sourceKey) && row.action === "same") {
        (existing as any).lastSeenAt = timestamp;
        touchedKeys.add(row.previewEntry.sourceKey);
        changed = true;
      }
    }

    // Handle pruning
    if (this.state.options.prune && this.state.presentKeys && this.state.presentKeys.size) {
      for (const tx of this.globalState.oneOffs || []) {
        if (!tx || (tx as any).source !== "AR") continue;
        if (!this.state.presentKeys.has((tx as any).sourceKey)) {
          if ((tx as any).status !== "archived") {
            (tx as any).status = "archived";
            archived += 1;
            changed = true;
          }
        } else if ((tx as any).status === "archived") {
          (tx as any).status = "pending";
          changed = true;
        }
      }
    }

    if (changed) {
      this.saveStateFn(this.globalState);
      this.recalcAndRenderFn();
    }

    this.state.summary = { added, updated, unchanged, archived, skipped };
    for (const row of this.state.rows) {
      row.userSelected = false;
      row.selected = false;
      this.refreshRow(row);
    }

    this.renderPreview();

    if (added || updated || unchanged || archived) {
      const parts = [
        `Added ${fmtCount(added)}`,
        `Updated ${fmtCount(updated)}`,
        `Unchanged ${fmtCount(unchanged)}`,
      ];
      if (archived) parts.push(`Archived ${fmtCount(archived)}`);
      if (skipped) parts.push(`Skipped ${fmtCount(skipped)}`);
      this.updateStatus(`Import complete: ${parts.join(" • ")}.`, "success");
    } else {
      this.updateStatus(skipped ? `Nothing imported. ${fmtCount(skipped)} skipped.` : "Nothing to import.", "error");
    }
  }
}

/**
 * Initialize AR controller (called from app.js).
 */
export function initARController(
  globalState: any,
  saveStateFn: (state: any) => void,
  recalcAndRenderFn: () => void
): ARController {
  const controller = new ARController(globalState, saveStateFn, recalcAndRenderFn);
  controller.init();
  return controller;
}
