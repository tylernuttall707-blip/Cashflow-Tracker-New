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
  TransactionType,
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
  templateName: 'conservative' | 'aggressive' | 'worst-case' | 'cost-cutting',
  baseState: AppState
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
