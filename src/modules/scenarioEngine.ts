/**
 * Scenario Engine - Apply scenario changes to state and compute projections
 */

import { computeProjection } from './calculations';
import type {
  AppState,
  Scenario,
  ScenarioChange,
  ProjectionResult,
  ExpandedTransaction,
  ScenarioVersion,
  VersionDiff,
  ScenarioVersionHistory,
  Condition,
  AdvancedTemplate,
  DateRange,
} from '../types';

/**
 * Generate a unique ID
 */
const uid = (): string => crypto.randomUUID();

/**
 * Apply scenario changes to base state and compute projection
 * @param baseState - The baseline application state
 * @param scenario - The scenario with changes to apply
 * @returns Projection result for the scenario
 */
export function computeScenarioProjection(
  baseState: AppState,
  scenario: Scenario
): ProjectionResult {
  // Clone base state to avoid mutations
  const scenarioState = applyScenarioChanges(baseState, scenario);

  // Compute projection with modified state
  return computeProjection(scenarioState);
}

/**
 * Apply all changes from a scenario to create a modified state
 * @param baseState - The baseline application state
 * @param scenario - The scenario with changes to apply
 * @returns Modified state with all changes applied
 */
export function applyScenarioChanges(
  baseState: AppState,
  scenario: Scenario
): AppState {
  // Start with a deep clone of base state
  let modifiedState: AppState = JSON.parse(JSON.stringify(baseState));

  // Apply each change in sequence
  for (const change of scenario.changes) {
    modifiedState = applyChange(modifiedState, change);
  }

  return modifiedState;
}

/**
 * Apply a single change to state
 * @param state - Current state
 * @param change - The change to apply
 * @returns Modified state
 */
function applyChange(
  state: AppState,
  change: ScenarioChange
): AppState {
  switch (change.type) {
    case 'transaction_add':
      return applyTransactionAdd(state, change);
    case 'transaction_remove':
      return applyTransactionRemove(state, change);
    case 'transaction_modify':
      return applyTransactionModify(state, change);
    case 'bulk_adjustment':
      return applyBulkAdjustment(state, change);
    case 'income_adjust':
      return applyIncomeAdjust(state, change);
    case 'expense_adjust':
      return applyExpenseAdjust(state, change);
    case 'setting_override':
      return applySettingOverride(state, change);
    default:
      console.warn(`Unknown change type: ${(change as any).type}`);
      return state;
  }
}

/**
 * Add a new transaction to the state
 */
function applyTransactionAdd(
  state: AppState,
  change: ScenarioChange
): AppState {
  const { newTransaction } = change.changes;
  if (!newTransaction) {
    console.warn('transaction_add change missing newTransaction');
    return state;
  }

  // Create a complete ExpandedTransaction
  const transaction: ExpandedTransaction = {
    id: uid(),
    date: newTransaction.date || state.settings.startDate,
    type: newTransaction.type || 'expense',
    name: newTransaction.name || 'Unnamed',
    category: newTransaction.category || '',
    amount: newTransaction.amount || 0,
    note: newTransaction.note,
    sourceType: newTransaction.sourceType || 'one-off',
    parentId: newTransaction.parentId,
    parentName: newTransaction.parentName,
    isEdited: newTransaction.isEdited,
    originalAmount: newTransaction.originalAmount,
    source: newTransaction.source,
    status: newTransaction.status,
    company: newTransaction.company,
    invoice: newTransaction.invoice,
    dueDate: newTransaction.dueDate,
    confidencePct: newTransaction.confidencePct,
  };

  return {
    ...state,
    expandedTransactions: [...state.expandedTransactions, transaction],
  };
}

/**
 * Remove a transaction from the state
 */
function applyTransactionRemove(
  state: AppState,
  change: ScenarioChange
): AppState {
  const { targetId } = change;
  if (!targetId) {
    console.warn('transaction_remove change missing targetId');
    return state;
  }

  return {
    ...state,
    expandedTransactions: state.expandedTransactions.filter(
      (tx) => tx.id !== targetId
    ),
  };
}

/**
 * Modify an existing transaction
 */
function applyTransactionModify(
  state: AppState,
  change: ScenarioChange
): AppState {
  const { targetId } = change;
  if (!targetId) {
    console.warn('transaction_modify change missing targetId');
    return state;
  }

  const { amount, amountMultiplier, date, frequency } = change.changes;

  return {
    ...state,
    expandedTransactions: state.expandedTransactions.map((tx) => {
      if (tx.id !== targetId) return tx;

      const modified = { ...tx };

      // Apply amount changes
      if (amount !== undefined) {
        modified.amount = amount;
        modified.isEdited = true;
        if (!modified.originalAmount) {
          modified.originalAmount = tx.amount;
        }
      } else if (amountMultiplier !== undefined) {
        modified.amount = tx.amount * amountMultiplier;
        modified.isEdited = true;
        if (!modified.originalAmount) {
          modified.originalAmount = tx.amount;
        }
      }

      // Apply date changes
      if (date !== undefined) {
        modified.date = date;
      }

      // Note: frequency changes are complex - would need to re-expand recurring
      if (frequency !== undefined) {
        console.warn('Frequency changes not yet implemented in scenarios');
      }

      return modified;
    }),
  };
}

/**
 * Apply bulk adjustments to multiple transactions
 */
function applyBulkAdjustment(
  state: AppState,
  change: ScenarioChange
): AppState {
  const { categoryFilter, typeFilter, percentChange } = change.changes;

  if (percentChange === undefined) {
    console.warn('bulk_adjustment change missing percentChange');
    return state;
  }

  const multiplier = 1 + percentChange / 100;

  return {
    ...state,
    expandedTransactions: state.expandedTransactions.map((tx) => {
      // Check if transaction matches filters
      let matches = true;

      if (categoryFilter && tx.category !== categoryFilter) {
        matches = false;
      }

      if (typeFilter && tx.type !== typeFilter) {
        matches = false;
      }

      if (!matches) return tx;

      // Apply percentage change
      return {
        ...tx,
        amount: tx.amount * multiplier,
        isEdited: true,
        originalAmount: tx.originalAmount || tx.amount,
      };
    }),
  };
}

/**
 * Adjust income streams (affects expandedTransactions with sourceType: income-stream)
 */
function applyIncomeAdjust(
  state: AppState,
  change: ScenarioChange
): AppState {
  const { targetId, targetType } = change;
  const { amountMultiplier, percentChange } = change.changes;

  // Calculate the multiplier
  let multiplier = 1;
  if (amountMultiplier !== undefined) {
    multiplier = amountMultiplier;
  } else if (percentChange !== undefined) {
    multiplier = 1 + percentChange / 100;
  }

  return {
    ...state,
    expandedTransactions: state.expandedTransactions.map((tx) => {
      // Filter by income type
      if (tx.type !== 'income') return tx;

      // If targetId specified, only affect that specific parent
      if (targetId && tx.parentId !== targetId) return tx;

      // If targetType is income, affect all income
      if (targetType === 'income' || !targetId) {
        return {
          ...tx,
          amount: tx.amount * multiplier,
          isEdited: true,
          originalAmount: tx.originalAmount || tx.amount,
        };
      }

      return tx;
    }),
  };
}

/**
 * Adjust expenses (affects expandedTransactions with type: expense)
 */
function applyExpenseAdjust(
  state: AppState,
  change: ScenarioChange
): AppState {
  const { categoryFilter, percentChange } = change.changes;

  if (percentChange === undefined) {
    console.warn('expense_adjust change missing percentChange');
    return state;
  }

  const multiplier = 1 + percentChange / 100;

  return {
    ...state,
    expandedTransactions: state.expandedTransactions.map((tx) => {
      // Filter by expense type
      if (tx.type !== 'expense') return tx;

      // If category filter specified, only affect that category
      if (categoryFilter && tx.category !== categoryFilter) return tx;

      return {
        ...tx,
        amount: tx.amount * multiplier,
        isEdited: true,
        originalAmount: tx.originalAmount || tx.amount,
      };
    }),
  };
}

/**
 * Override settings in the scenario
 */
function applySettingOverride(
  state: AppState,
  change: ScenarioChange
): AppState {
  const { startDate, endDate, startingBalance } = change.changes;

  return {
    ...state,
    settings: {
      ...state.settings,
      ...(startDate !== undefined && { startDate }),
      ...(endDate !== undefined && { endDate }),
      ...(startingBalance !== undefined && { startingBalance }),
    },
  };
}

/**
 * Create a scenario template with predefined changes
 */
export function createScenarioTemplate(
  templateName: 'conservative' | 'aggressive' | 'worst-case' | 'cost-cutting'
): Scenario {
  const now = new Date().toISOString();
  const id = uid();

  const templates = {
    conservative: {
      name: 'Conservative',
      description: 'Reduced income by 15%, increased expenses by 10%',
      color: '#F59E0B',
      changes: [
        {
          id: uid(),
          type: 'income_adjust' as const,
          description: 'Reduce all income by 15%',
          targetType: 'income' as const,
          changes: { percentChange: -15 },
        },
        {
          id: uid(),
          type: 'expense_adjust' as const,
          description: 'Increase all expenses by 10%',
          targetType: 'expense' as const,
          changes: { percentChange: 10 },
        },
      ],
    },
    aggressive: {
      name: 'Aggressive Growth',
      description: 'Increased income by 30%, increased expenses by 20%',
      color: '#10B981',
      changes: [
        {
          id: uid(),
          type: 'income_adjust' as const,
          description: 'Increase all income by 30%',
          targetType: 'income' as const,
          changes: { percentChange: 30 },
        },
        {
          id: uid(),
          type: 'expense_adjust' as const,
          description: 'Increase all expenses by 20%',
          targetType: 'expense' as const,
          changes: { percentChange: 20 },
        },
      ],
    },
    'worst-case': {
      name: 'Worst Case',
      description: 'Reduced income by 30%, increased expenses by 15%',
      color: '#EF4444',
      changes: [
        {
          id: uid(),
          type: 'income_adjust' as const,
          description: 'Reduce all income by 30%',
          targetType: 'income' as const,
          changes: { percentChange: -30 },
        },
        {
          id: uid(),
          type: 'expense_adjust' as const,
          description: 'Increase all expenses by 15%',
          targetType: 'expense' as const,
          changes: { percentChange: 15 },
        },
      ],
    },
    'cost-cutting': {
      name: 'Cost Cutting',
      description: 'Same income, reduced expenses by 25%',
      color: '#6366F1',
      changes: [
        {
          id: uid(),
          type: 'expense_adjust' as const,
          description: 'Reduce all expenses by 25%',
          targetType: 'expense' as const,
          changes: { percentChange: -25 },
        },
      ],
    },
  };

  const template = templates[templateName];

  return {
    id,
    name: template.name,
    description: template.description,
    color: template.color,
    createdAt: now,
    updatedAt: now,
    changes: template.changes,
    isArchived: false,
  };
}

/**
 * Validate a scenario change
 */
export function validateScenarioChange(
  change: ScenarioChange,
  state: AppState
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate based on change type
  switch (change.type) {
    case 'transaction_add':
      if (!change.changes.newTransaction) {
        errors.push('New transaction data is required');
      }
      break;

    case 'transaction_remove':
    case 'transaction_modify':
      if (!change.targetId) {
        errors.push('Target transaction ID is required');
      } else {
        const exists = state.expandedTransactions.some(
          (tx) => tx.id === change.targetId
        );
        if (!exists) {
          errors.push(`Transaction with ID ${change.targetId} not found`);
        }
      }
      break;

    case 'bulk_adjustment':
    case 'expense_adjust':
      if (change.changes.percentChange === undefined) {
        errors.push('Percentage change is required');
      }
      break;

    case 'setting_override':
      if (
        !change.changes.startDate &&
        !change.changes.endDate &&
        change.changes.startingBalance === undefined
      ) {
        errors.push('At least one setting override is required');
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * ========================================================================
 * PHASE 4: VERSION TRACKING & HISTORY
 * ========================================================================
 */

/**
 * Create a version snapshot of a scenario
 * @param scenario - The scenario to snapshot
 * @param versionNotes - Optional notes for this version
 * @returns ScenarioVersion snapshot
 */
export function createScenarioVersion(
  scenario: Scenario,
  versionNotes?: string
): ScenarioVersion {
  const versionNumber = (scenario.currentVersionNumber || 0) + 1;

  return {
    id: uid(),
    scenarioId: scenario.id,
    timestamp: new Date().toISOString(),
    versionNumber,
    name: scenario.name,
    description: scenario.description,
    changes: JSON.parse(JSON.stringify(scenario.changes)), // Deep clone
    notes: versionNotes,
    tags: scenario.tags ? [...scenario.tags] : undefined,
  };
}

/**
 * Restore a scenario from a version snapshot
 * @param currentScenario - The current scenario to update
 * @param version - The version to restore from
 * @returns Updated scenario
 */
export function restoreScenarioFromVersion(
  currentScenario: Scenario,
  version: ScenarioVersion
): Scenario {
  return {
    ...currentScenario,
    name: version.name,
    description: version.description,
    changes: JSON.parse(JSON.stringify(version.changes)), // Deep clone
    tags: version.tags ? [...version.tags] : currentScenario.tags,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Compare two scenario versions and generate a diff
 * @param fromVersion - The earlier version
 * @param toVersion - The later version
 * @returns VersionDiff showing changes between versions
 */
export function compareVersions(
  fromVersion: ScenarioVersion,
  toVersion: ScenarioVersion
): VersionDiff {
  // Find changes that were added
  const changesAdded: ScenarioChange[] = toVersion.changes.filter(
    (toChange) => !fromVersion.changes.some((fromChange) => fromChange.id === toChange.id)
  );

  // Find changes that were removed
  const changesRemoved: ScenarioChange[] = fromVersion.changes.filter(
    (fromChange) => !toVersion.changes.some((toChange) => toChange.id === fromChange.id)
  );

  // Find changes that were modified
  const changesModified: Array<{
    changeId: string;
    oldChange: ScenarioChange;
    newChange: ScenarioChange;
  }> = [];

  fromVersion.changes.forEach((fromChange) => {
    const toChange = toVersion.changes.find((tc) => tc.id === fromChange.id);
    if (toChange && JSON.stringify(fromChange) !== JSON.stringify(toChange)) {
      changesModified.push({
        changeId: fromChange.id,
        oldChange: fromChange,
        newChange: toChange,
      });
    }
  });

  return {
    fromVersion,
    toVersion,
    changesAdded,
    changesRemoved,
    changesModified,
    nameChanged: fromVersion.name !== toVersion.name,
    descriptionChanged: fromVersion.description !== toVersion.description,
    tagsChanged: JSON.stringify(fromVersion.tags || []) !== JSON.stringify(toVersion.tags || []),
  };
}

/**
 * Get a summary of changes in a version diff
 * @param diff - The version diff
 * @returns Human-readable summary
 */
export function getVersionDiffSummary(diff: VersionDiff): string {
  const parts: string[] = [];

  if (diff.nameChanged) {
    parts.push(`Name changed from "${diff.fromVersion.name}" to "${diff.toVersion.name}"`);
  }

  if (diff.changesAdded.length > 0) {
    parts.push(`${diff.changesAdded.length} change(s) added`);
  }

  if (diff.changesRemoved.length > 0) {
    parts.push(`${diff.changesRemoved.length} change(s) removed`);
  }

  if (diff.changesModified.length > 0) {
    parts.push(`${diff.changesModified.length} change(s) modified`);
  }

  if (diff.descriptionChanged) {
    parts.push('Description updated');
  }

  if (diff.tagsChanged) {
    parts.push('Tags updated');
  }

  return parts.length > 0 ? parts.join(', ') : 'No changes';
}

/**
 * Initialize version history for a scenario
 * @param scenario - The scenario
 * @returns ScenarioVersionHistory
 */
export function initializeVersionHistory(scenario: Scenario): ScenarioVersionHistory {
  // Create initial version
  const initialVersion = createScenarioVersion(scenario, 'Initial version');

  return {
    scenarioId: scenario.id,
    versions: [initialVersion],
    currentVersionNumber: 1,
  };
}

/**
 * ========================================================================
 * PHASE 4: CONDITIONAL SCENARIOS
 * ========================================================================
 */

/**
 * Evaluate a condition against current state
 * @param condition - The condition to evaluate
 * @param state - Current app state
 * @param currentBalance - Current balance for the projection day
 * @param projectionDay - Current day in projection (0-based)
 * @returns true if condition is met
 */
export function evaluateCondition(
  condition: Condition,
  state: AppState,
  currentBalance?: number,
  projectionDay?: number
): boolean {
  const { type, operator, value } = condition;
  let actualValue: number | string | undefined;

  // Get the actual value based on condition type
  switch (type) {
    case 'balance':
      actualValue = currentBalance;
      break;

    case 'income': {
      const totalIncome = state.expandedTransactions
        .filter((tx) => tx.amount > 0)
        .reduce((sum, tx) => sum + tx.amount, 0);
      actualValue = totalIncome;
      break;
    }

    case 'expense': {
      const totalExpense = state.expandedTransactions
        .filter((tx) => tx.amount < 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
      actualValue = totalExpense;
      break;
    }

    case 'transaction_count':
      actualValue = state.expandedTransactions.length;
      break;

    case 'projection_day':
      actualValue = projectionDay;
      break;

    case 'date':
      actualValue = new Date().toISOString().split('T')[0];
      break;

    default:
      return false;
  }

  if (actualValue === undefined) {
    return false;
  }

  // Perform comparison based on operator
  switch (operator) {
    case 'equals':
      return actualValue === value;
    case 'not_equals':
      return actualValue !== value;
    case 'greater_than':
      return typeof actualValue === 'number' && typeof value === 'number' && actualValue > value;
    case 'less_than':
      return typeof actualValue === 'number' && typeof value === 'number' && actualValue < value;
    case 'greater_than_or_equal':
      return typeof actualValue === 'number' && typeof value === 'number' && actualValue >= value;
    case 'less_than_or_equal':
      return typeof actualValue === 'number' && typeof value === 'number' && actualValue <= value;
    default:
      return false;
  }
}

/**
 * Evaluate multiple conditions with logical operator
 * @param conditions - Array of conditions
 * @param logicalOperator - AND or OR
 * @param state - Current app state
 * @param currentBalance - Current balance
 * @param projectionDay - Current projection day
 * @returns true if conditions are met
 */
export function evaluateConditions(
  conditions: Condition[],
  logicalOperator: 'AND' | 'OR',
  state: AppState,
  currentBalance?: number,
  projectionDay?: number
): boolean {
  if (conditions.length === 0) {
    return false;
  }

  const results = conditions.map((condition) =>
    evaluateCondition(condition, state, currentBalance, projectionDay)
  );

  if (logicalOperator === 'AND') {
    return results.every((result) => result);
  } else {
    return results.some((result) => result);
  }
}

/**
 * Apply conditional changes to a scenario during projection
 * @param baseState - Base state
 * @param scenario - Scenario with conditional changes
 * @param currentBalance - Current balance in projection
 * @param projectionDay - Current day in projection
 * @returns Modified state with conditional changes applied
 */
export function applyConditionalChanges(
  baseState: AppState,
  scenario: Scenario,
  currentBalance?: number,
  projectionDay?: number
): AppState {
  if (!scenario.conditionalChanges || scenario.conditionalChanges.length === 0) {
    return baseState;
  }

  let modifiedState = baseState;

  for (const conditionalChange of scenario.conditionalChanges) {
    if (!conditionalChange.enabled) {
      continue;
    }

    const conditionsMet = evaluateConditions(
      conditionalChange.conditions,
      conditionalChange.logicalOperator,
      baseState,
      currentBalance,
      projectionDay
    );

    if (conditionsMet) {
      modifiedState = applyChange(modifiedState, conditionalChange.change);
    }
  }

  return modifiedState;
}

/**
 * ========================================================================
 * PHASE 4: ADVANCED TEMPLATES
 * ========================================================================
 */

/**
 * Create seasonal templates with date ranges
 * @returns Array of seasonal templates
 */
export function getSeasonalTemplates(): AdvancedTemplate[] {
  const currentYear = new Date().getFullYear();

  return [
    {
      id: uid(),
      name: 'Holiday Season',
      description: 'Increased expenses during Q4 holiday season',
      color: '#DC2626',
      isSeasonal: true,
      seasonalPeriod: 'Q4',
      dateRange: {
        startDate: `${currentYear}-11-01`,
        endDate: `${currentYear}-12-31`,
      },
      changes: [
        {
          id: uid(),
          type: 'expense_adjust',
          description: 'Increase expenses by 30% for holiday shopping',
          targetType: 'expense',
          changes: { percentChange: 30 },
        },
      ],
    },
    {
      id: uid(),
      name: 'Tax Season',
      description: 'Tax payment and preparation expenses',
      color: '#7C3AED',
      isSeasonal: true,
      seasonalPeriod: 'Q1',
      dateRange: {
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-04-15`,
      },
      changes: [
        {
          id: uid(),
          type: 'transaction_add',
          description: 'Tax preparation fee',
          changes: {
            newTransaction: {
              id: uid(),
              name: 'Tax preparation',
              amount: -500,
              date: `${currentYear}-03-15`,
              category: 'Services',
              type: 'expense',
            },
          },
        },
      ],
    },
    {
      id: uid(),
      name: 'Summer Vacation',
      description: 'Increased travel and leisure expenses',
      color: '#F59E0B',
      isSeasonal: true,
      seasonalPeriod: 'Summer',
      dateRange: {
        startDate: `${currentYear}-06-01`,
        endDate: `${currentYear}-08-31`,
      },
      changes: [
        {
          id: uid(),
          type: 'transaction_add',
          description: 'Vacation expenses',
          changes: {
            newTransaction: {
              id: uid(),
              name: 'Summer vacation',
              amount: -3000,
              date: `${currentYear}-07-15`,
              category: 'Travel',
              type: 'expense',
            },
          },
        },
      ],
    },
    {
      id: uid(),
      name: 'Back to School',
      description: 'School-related expenses in fall',
      color: '#10B981',
      isSeasonal: true,
      seasonalPeriod: 'Fall',
      dateRange: {
        startDate: `${currentYear}-08-01`,
        endDate: `${currentYear}-09-30`,
      },
      changes: [
        {
          id: uid(),
          type: 'transaction_add',
          description: 'School supplies and fees',
          changes: {
            newTransaction: {
              id: uid(),
              name: 'School expenses',
              amount: -800,
              date: `${currentYear}-08-15`,
              category: 'Education',
              type: 'expense',
            },
          },
        },
      ],
    },
  ];
}

/**
 * Create time-bound scenario template
 * @param name - Template name
 * @param description - Template description
 * @param dateRange - Date range for the template
 * @param changes - Changes to apply
 * @param color - Color for visualization
 * @returns AdvancedTemplate
 */
export function createTimeBoundTemplate(
  name: string,
  description: string,
  dateRange: DateRange,
  changes: ScenarioChange[],
  color: string = '#6366F1'
): AdvancedTemplate {
  return {
    id: uid(),
    name,
    description,
    color,
    changes,
    dateRange,
    isSeasonal: false,
  };
}

/**
 * Convert an advanced template to a scenario
 * @param template - The advanced template
 * @returns Scenario
 */
export function templateToScenario(template: AdvancedTemplate): Scenario {
  const now = new Date().toISOString();

  return {
    id: uid(),
    name: template.name,
    description: template.description,
    color: template.color,
    createdAt: now,
    updatedAt: now,
    changes: JSON.parse(JSON.stringify(template.changes)), // Deep clone
    dateRange: template.dateRange,
    tags: template.isSeasonal ? [template.seasonalPeriod || 'seasonal'] : undefined,
    currentVersionNumber: 1,
  };
}
