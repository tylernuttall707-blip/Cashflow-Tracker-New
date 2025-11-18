/**
 * Core type definitions for the Cashflow Tracker application
 */

/** YYYY-MM-DD formatted date string */
export type YMDString = string;

/** Weekend rolling policy */
export type WeekendRollPolicy = "forward" | "back" | "none";

/** Transaction type */
export type TransactionType = "income" | "expense";

/** Recurrence frequency */
export type Frequency = "once" | "daily" | "weekly" | "biweekly" | "monthly";

/** Monthly recurrence mode */
export type MonthlyMode = "day" | "nth";

/** Nth week descriptor */
export type NthWeek = "1" | "2" | "3" | "4" | "5" | "last";

/** Sort direction */
export type SortDirection = "asc" | "desc";

/** Sort key for one-off entries */
export type OneOffSortKey = "date" | "schedule" | "type" | "name" | "category" | "next";

/** Sort key for expanded transactions */
export type ExpandedSortKey = "date" | "type" | "name" | "category" | "amount" | "sourceType";

/** Last edited field for What-If scenarios */
export type LastEdited = "pct" | "delta" | "effective" | "weekly" | "topup";

/**
 * Step adjustment for recurring amounts
 */
export interface Step {
  effectiveFrom: YMDString;
  amount: number;
}

/**
 * Base transaction structure
 */
export interface BaseTransaction {
  id: string;
  name: string;
  category: string;
  amount: number;
  note?: string;
}

/**
 * One-time transaction
 */
export interface OneOffTransaction extends BaseTransaction {
  type: TransactionType;
  date: YMDString;
  recurring: false;
  steps: never[];
  escalatorPct: 0;
  source?: string;
  status?: string;
}

/**
 * Recurring transaction
 */
export interface RecurringTransaction extends BaseTransaction {
  type: TransactionType;
  recurring: true;
  frequency: Frequency;
  startDate: YMDString;
  endDate: YMDString;
  onDate?: YMDString;
  skipWeekends?: boolean;
  steps: Step[];
  escalatorPct: number;
  dayOfWeek?: number[];
  monthlyMode?: MonthlyMode;
  dayOfMonth?: number;
  nthWeek?: NthWeek;
  nthWeekday?: number;
  source?: string;
  status?: string;
}

/**
 * Union type for all transactions
 */
export type Transaction = OneOffTransaction | RecurringTransaction;

/**
 * Source type for expanded transactions
 */
export type ExpandedSourceType = "one-off" | "recurring" | "income-stream" | "adjustment";

/**
 * Expanded transaction - represents a single instance of a transaction
 * This is the source of truth for all transactions in the master table
 */
export interface ExpandedTransaction {
  id: string;
  date: YMDString;
  type: TransactionType;
  name: string;
  category: string;
  amount: number;
  note?: string;

  // Metadata for traceability
  sourceType: ExpandedSourceType;
  parentId?: string;           // ID of original recurring definition (if applicable)
  parentName?: string;          // Name of recurring series
  isEdited?: boolean;           // Has this instance been modified from original?
  originalAmount?: number;      // Original amount before manual editing

  // AR-specific fields
  source?: string;              // e.g., 'AR'
  status?: string;              // e.g., 'active', 'archived'
  company?: string;             // AR company name
  invoice?: string;             // AR invoice number
  dueDate?: YMDString;          // AR original due date
  confidencePct?: number;       // AR confidence percentage
}

/**
 * Income stream definition
 */
export interface IncomeStream {
  id: string;
  name: string;
  category: string;
  amount: number;
  frequency: Frequency;
  startDate: YMDString;
  endDate: YMDString;
  onDate: YMDString | null;
  skipWeekends: boolean;
  steps: Step[];
  escalatorPct: number;
  dayOfWeek?: number[];
  monthlyMode?: MonthlyMode;
  dayOfMonth?: number;
  nthWeek?: NthWeek;
  nthWeekday?: number;
}

/**
 * Balance adjustment entry
 */
export interface Adjustment {
  date: YMDString;
  amount: number;
  note?: string;
}

/**
 * Application settings
 */
export interface Settings {
  startDate: YMDString;
  endDate: YMDString;
  startingBalance: number;
}

/**
 * One-off sort state
 */
export interface OneOffSortState {
  key: OneOffSortKey;
  direction: SortDirection;
}

/**
 * Expanded transactions sort state
 */
export interface ExpandedSortState {
  key: ExpandedSortKey;
  direction: SortDirection;
}

/**
 * UI state
 */
export interface UIState {
  oneOffSort: OneOffSortState;
  expandedSort: ExpandedSortState;
}

/**
 * Main application state
 */
export interface AppState {
  settings: Settings;
  adjustments: Adjustment[];
  oneOffs: Transaction[];              // Legacy - kept for backward compatibility
  incomeStreams: IncomeStream[];       // Legacy - kept for backward compatibility
  expandedTransactions: ExpandedTransaction[];  // New source of truth
  ui: UIState;
  scenarios?: Scenario[];              // Optional for backward compatibility
  activeScenarioId?: string | null;   // null = baseline/actual, undefined = not initialized
}

/**
 * Transaction detail for calendar rows
 */
export interface TransactionDetail {
  source: string;
  amount: number;
}

/**
 * Calendar row for cash flow projection
 */
export interface CalendarRow {
  date: YMDString;
  income: number;
  expenses: number;
  net: number;
  running: number;
  incomeDetails: TransactionDetail[];
  expenseDetails: TransactionDetail[];
}

/**
 * Cash flow projection result
 */
export interface ProjectionResult {
  cal: CalendarRow[];
  totalIncome: number;
  totalExpenses: number;
  endBalance: number;
  projectedWeeklyIncome: number;
  lowestBalance: number;
  lowestBalanceDate: YMDString;
  peakBalance: number;
  peakBalanceDate: YMDString;
  firstNegativeDate: YMDString | null;
  negativeDays: number;
}

/**
 * Sale entry for What-If scenarios
 */
export interface SaleEntry {
  id: string;
  name: string;
  pct: number;
  topup: number;
  startDate: YMDString;
  endDate: YMDString;
  businessDaysOnly: boolean;
  lastEdited: "pct" | "topup";
}

/**
 * Sale configuration for What-If scenarios
 */
export interface SaleConfig {
  enabled: boolean;
  entries: SaleEntry[];
}

/**
 * Stream tweak for What-If scenarios
 */
export interface StreamTweak {
  pct: number;
  delta: number;
  effective: number | null;
  weeklyTarget: number | null;
  lastEdited: LastEdited;
}

/**
 * Global tweak for What-If scenarios
 */
export interface GlobalTweak {
  pct: number;
  delta: number;
  lastEdited: "pct" | "delta" | "effective";
}

/**
 * What-If scenario tweaks
 */
export interface WhatIfTweaks {
  global: GlobalTweak;
  streams: Record<string, StreamTweak>;
  sale: SaleConfig;
  startDate: YMDString;
  endDate: YMDString;
}

/**
 * What-If state structure
 */
export interface WhatIfState {
  base: AppState;
  tweaks: WhatIfTweaks;
}

/**
 * Scenario change types - what can be modified in a scenario
 */
export type ScenarioChangeType =
  | "transaction_add"      // Add new transaction
  | "transaction_remove"   // Remove existing transaction
  | "transaction_modify"   // Modify amount/date/frequency
  | "income_adjust"        // Adjust income stream
  | "expense_adjust"       // Adjust expense categories
  | "setting_override"     // Override settings (dates, starting balance)
  | "bulk_adjustment";     // Percentage adjustment to category/type

/**
 * Target type for scenario changes
 */
export type ScenarioTargetType = "transaction" | "income" | "expense" | "category" | "setting";

/**
 * Individual change within a scenario
 */
export interface ScenarioChange {
  id: string;
  type: ScenarioChangeType;
  description: string;      // Human-readable: "Increase rent by 10%"

  // Reference to what's being changed
  targetId?: string;         // Transaction/stream ID being affected
  targetType?: ScenarioTargetType;

  // Change details (flexible object based on type)
  changes: {
    // For transaction modifications
    amount?: number;
    amountMultiplier?: number;  // 1.1 = +10%
    date?: YMDString;
    frequency?: Frequency;

    // For new transactions
    newTransaction?: Partial<ExpandedTransaction>;

    // For bulk adjustments
    categoryFilter?: string;
    typeFilter?: TransactionType;
    percentChange?: number;

    // For setting overrides
    startDate?: YMDString;
    endDate?: YMDString;
    startingBalance?: number;
  };
}

/**
 * Scenario definition
 */
export interface Scenario {
  id: string;
  name: string;
  description?: string;
  color: string;            // For visual distinction in charts

  // Timestamps
  createdAt: string;        // ISO timestamp
  updatedAt: string;        // ISO timestamp

  // Changes from baseline
  changes: ScenarioChange[];

  // Cached projection (optional, for performance)
  cachedProjection?: ProjectionResult;
  lastCalculated?: string;  // ISO timestamp

  // Metadata
  tags?: string[];          // e.g., ["best-case", "Q4-2025"]
  isArchived?: boolean;
  notes?: string;           // Markdown supported
}

/**
 * Scenario comparison result
 */
export interface ScenarioComparison {
  scenarios: Scenario[];
  projections: Record<string, ProjectionResult>;  // scenario.id -> projection

  // Comparative metrics
  comparativeMetrics: {
    endBalanceRange: [number, number];
    avgEndBalance: number;
    lowestBalanceRange: [number, number];
    runwayRange: [number | null, number | null];
  };
}

/**
 * AR (Accounts Receivable) options
 */
export interface AROptions {
  roll: WeekendRollPolicy;
  lag: number;
  conf: number;
  category: string;
  prune: boolean;
}

/**
 * AR column mapping overrides
 */
export interface ARMappingOverrides {
  company: string;
  invoice: string;
  due: string;
  amount: string;
}

/**
 * AR preferences
 */
export interface ARPreferences {
  options: AROptions;
  mapping: ARMappingOverrides;
}

/**
 * AR invoice entry
 */
export interface ARInvoice {
  id: string;
  company: string;
  invoice: string;
  due: YMDString;
  amount: number;
  conf: number;
  status?: string;
}

/**
 * Clamp options
 */
export interface ClampOptions {
  min?: number;
  max?: number;
  fallback?: number;
}

/**
 * Projection override hooks
 */
export interface ProjectionOverrides {
  getStreamMultiplier?: (stream: IncomeStream, baseAmount: number, date: YMDString) => number;
  transformStreamAmount?: (args: {
    stream: IncomeStream;
    baseAmount: number;
    date: YMDString;
  }) => number;
  sale?: SaleConfig;
}
