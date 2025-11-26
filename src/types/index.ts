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
  // Optional AR metadata
  sourceKey?: string;
  company?: string;
  invoice?: string;
  dueDate?: YMDString | null;
  confidencePct?: number;
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
  scenarioVersions?: ScenarioVersion[];  // Phase 4: Version history for scenarios
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

  // Phase 4: Version history
  currentVersionNumber?: number;  // Current version number for this scenario

  // Phase 4: Conditional scenarios
  conditionalChanges?: ConditionalChange[];  // Changes that apply conditionally
  triggers?: ScenarioTrigger[];              // Auto-triggered changes

  // Phase 4: Date range (for time-bound scenarios)
  dateRange?: DateRange;
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
 * Scenario version snapshot
 * Captures the state of a scenario at a specific point in time
 */
export interface ScenarioVersion {
  id: string;                    // Unique version ID
  scenarioId: string;            // Reference to parent scenario
  timestamp: string;             // ISO timestamp when version was created
  versionNumber: number;         // Sequential version number (1, 2, 3, ...)
  name: string;                  // Scenario name at this version
  description?: string;          // Description at this version
  changes: ScenarioChange[];     // Snapshot of changes at this version
  notes?: string;                // Version-specific notes (e.g., "Before Q4 review")
  createdBy?: string;            // Optional user identifier
  tags?: string[];               // Tags at this version
}

/**
 * Difference between two scenario versions
 */
export interface VersionDiff {
  fromVersion: ScenarioVersion;
  toVersion: ScenarioVersion;

  // Changes analysis
  changesAdded: ScenarioChange[];       // Changes added in toVersion
  changesRemoved: ScenarioChange[];     // Changes removed from fromVersion
  changesModified: Array<{              // Changes that were modified
    changeId: string;
    oldChange: ScenarioChange;
    newChange: ScenarioChange;
  }>;

  // Metadata changes
  nameChanged: boolean;
  descriptionChanged: boolean;
  tagsChanged: boolean;
}

/**
 * Version history for a scenario
 */
export interface ScenarioVersionHistory {
  scenarioId: string;
  versions: ScenarioVersion[];
  currentVersionNumber: number;
}

/**
 * Date range for time-bound scenario changes
 */
export interface DateRange {
  startDate: YMDString;
  endDate: YMDString;
}

/**
 * Advanced template with date range support
 */
export interface AdvancedTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  changes: ScenarioChange[];
  dateRange?: DateRange;         // Optional time bounds for the template
  isSeasonal?: boolean;          // Indicates if this is a seasonal template
  seasonalPeriod?: string;       // e.g., "Q4", "Holiday", "Tax Season"
}

/**
 * Conditional logic operator
 */
export type ConditionalOperator = 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'greater_than_or_equal' | 'less_than_or_equal';

/**
 * Logical operator for combining conditions
 */
export type LogicalOperator = 'AND' | 'OR';

/**
 * Condition for conditional scenarios
 */
export interface Condition {
  id: string;
  type: 'balance' | 'income' | 'expense' | 'transaction_count' | 'date' | 'projection_day';
  operator: ConditionalOperator;
  value: number | string;        // Comparison value
  description?: string;          // Human-readable description
}

/**
 * Conditional change - applies ScenarioChange when conditions are met
 */
export interface ConditionalChange {
  id: string;
  conditions: Condition[];
  logicalOperator: LogicalOperator;  // How to combine multiple conditions
  change: ScenarioChange;            // The change to apply if conditions are met
  description?: string;              // Description of what this does
  enabled: boolean;                  // Can temporarily disable without removing
}

/**
 * Trigger-based scenario - monitors state and applies changes automatically
 */
export interface ScenarioTrigger {
  id: string;
  name: string;
  description?: string;
  conditions: Condition[];
  logicalOperator: LogicalOperator;
  actions: ScenarioChange[];         // Changes to apply when triggered
  triggerOnce: boolean;              // Only trigger the first time conditions are met
  enabled: boolean;
}

/**
 * AI-generated suggestion for scenario
 */
export interface ScenarioSuggestion {
  id: string;
  type: 'optimization' | 'risk_mitigation' | 'pattern_detected' | 'opportunity';
  title: string;
  description: string;
  reasoning: string;                 // Why this suggestion was made
  suggestedChanges: ScenarioChange[];
  priority: 'low' | 'medium' | 'high';
  estimatedImpact?: {
    endBalanceChange?: number;
    runwayChange?: number;
  };
  appliedToScenarioId?: string;      // If user applied this suggestion
  dismissedAt?: string;              // ISO timestamp if user dismissed
}

/**
 * Pattern detected in financial data
 */
export interface FinancialPattern {
  id: string;
  type: 'high_expenses' | 'low_income' | 'declining_balance' | 'irregular_income' | 'seasonal_variation';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  affectedCategory?: string;
  affectedDateRange?: DateRange;
  metrics: Record<string, number>;   // Supporting data for the pattern
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
