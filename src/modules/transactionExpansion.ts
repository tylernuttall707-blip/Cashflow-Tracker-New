/**
 * Transaction Expansion & Override Utilities
 * Handles expanding recurring transactions and applying overrides
 */

import type { Transaction, IncomeStream, YMDString, AppState } from '../types';

/**
 * Expanded transaction instance
 */
export interface TransactionInstance {
  id: string;
  parentId: string;
  parentType: 'oneOff' | 'incomeStream';
  instanceDate: YMDString;
  name: string;
  category: string;
  amount: number;
  type: 'income' | 'expense';
  isRecurring: boolean;
  isModified: boolean;
  overrideId?: string;
}

/**
 * Transaction override definition
 */
export interface TransactionOverride {
  id: string;
  parentId: string;
  parentType: string;
  instanceDate: YMDString;
  modifications?: Partial<TransactionInstance>;
  deleted: boolean;
}

/**
 * Expands a recurring transaction into individual instances
 */
export function expandRecurringTransaction(
  transaction: Transaction | IncomeStream,
  viewStartDate: YMDString,
  viewEndDate: YMDString
): TransactionInstance[] {
  const transAsAny = transaction as any;

  if (!transAsAny.recurring && 'date' in transaction) {
    // One-time transaction - return as single instance
    return [{
      id: `${transaction.id}-${(transaction as any).date}`,
      parentId: transaction.id,
      parentType: 'oneOff',
      instanceDate: (transaction as any).date,
      name: transaction.name,
      category: transaction.category,
      amount: transaction.amount,
      type: (transaction as any).type || 'income',
      isRecurring: false,
      isModified: false
    }];
  }

  const instances: TransactionInstance[] = [];
  const start = new Date(Math.max(new Date(transAsAny.startDate).getTime(), new Date(viewStartDate).getTime()));
  const end = new Date(Math.min(new Date(transAsAny.endDate || viewEndDate).getTime(), new Date(viewEndDate).getTime()));

  switch (transAsAny.frequency) {
    case 'daily':
      generateDailyInstances(transAsAny, start, end, instances);
      break;
    case 'weekly':
      generateWeeklyInstances(transAsAny, start, end, instances);
      break;
    case 'biweekly':
      generateBiweeklyInstances(transAsAny, start, end, instances);
      break;
    case 'monthly':
      generateMonthlyInstances(transAsAny, start, end, instances);
      break;
  }

  return instances;
}

function generateDailyInstances(transaction: any, start: Date, end: Date, instances: TransactionInstance[]): void {
  let currentDate = new Date(start);

  while (currentDate <= end) {
    if (!transaction.skipWeekends || !isWeekend(currentDate)) {
      instances.push(createInstance(transaction, currentDate));
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function generateWeeklyInstances(transaction: any, start: Date, end: Date, instances: TransactionInstance[]): void {
  const startDate = new Date(transaction.startDate);
  let currentDate = new Date(start);

  // Find the first occurrence on or after start date
  const dayOfWeek = transaction.dayOfWeek?.[0] || startDate.getDay();
  while (currentDate.getDay() !== dayOfWeek && currentDate <= end) {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  while (currentDate <= end) {
    instances.push(createInstance(transaction, currentDate));
    currentDate.setDate(currentDate.getDate() + 7);
  }
}

function generateBiweeklyInstances(transaction: any, start: Date, end: Date, instances: TransactionInstance[]): void {
  const startDate = new Date(transaction.startDate);
  let currentDate = new Date(startDate);

  // Fast forward to first occurrence in view range
  while (currentDate < start) {
    currentDate.setDate(currentDate.getDate() + 14);
  }

  while (currentDate <= end) {
    instances.push(createInstance(transaction, currentDate));
    currentDate.setDate(currentDate.getDate() + 14);
  }
}

function generateMonthlyInstances(transaction: any, start: Date, end: Date, instances: TransactionInstance[]): void {
  let currentDate = new Date(start);

  // Adjust to the correct day of month
  if (transaction.monthlyMode === 'day' && transaction.dayOfMonth) {
    currentDate.setDate(transaction.dayOfMonth);
    if (currentDate < start) {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  }

  while (currentDate <= end) {
    instances.push(createInstance(transaction, currentDate));
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
}

function createInstance(transaction: any, date: Date): TransactionInstance {
  const dateStr = formatDate(date);
  const amount = getAmountForDate(transaction, dateStr);

  return {
    id: `${transaction.id}-${dateStr}`,
    parentId: transaction.id,
    parentType: transaction.type === 'income' || !transaction.type ? 'incomeStream' : 'oneOff',
    instanceDate: dateStr,
    name: transaction.name,
    category: transaction.category,
    amount: amount,
    type: transaction.type || 'income',
    isRecurring: true,
    isModified: false
  };
}

/**
 * Gets the amount for a transaction on a specific date, considering step changes
 */
function getAmountForDate(transaction: any, date: YMDString): number {
  if (!transaction.steps || transaction.steps.length === 0) {
    return transaction.amount;
  }

  // Find the most recent step that applies
  const applicableSteps = transaction.steps
    .filter((step: any) => step.effectiveFrom <= date)
    .sort((a: any, b: any) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  return applicableSteps.length > 0
    ? applicableSteps[0].amount
    : transaction.amount;
}

/**
 * Applies overrides to expanded transaction instances
 */
export function applyOverrides(
  instances: TransactionInstance[],
  overrides: TransactionOverride[]
): TransactionInstance[] {
  const overrideMap = new Map<string, TransactionOverride>();

  // Create lookup map for fast access
  overrides.forEach(override => {
    const key = `${override.parentId}-${override.instanceDate}`;
    overrideMap.set(key, override);
  });

  return instances
    .map(instance => {
      const key = `${instance.parentId}-${instance.instanceDate}`;
      const override = overrideMap.get(key);

      if (!override) {
        return instance;
      }

      if (override.deleted) {
        return null; // Mark for filtering
      }

      // Apply modifications
      return {
        ...instance,
        ...override.modifications,
        isModified: true,
        overrideId: override.id
      };
    })
    .filter((instance): instance is TransactionInstance => instance !== null);
}

/**
 * Expands all transactions from the full data structure
 */
export function expandAllTransactions(data: AppState & { transactionOverrides?: TransactionOverride[] }): TransactionInstance[] {
  const { settings, oneOffs, incomeStreams } = data;
  const allInstances: TransactionInstance[] = [];

  // Expand one-offs (both recurring and one-time)
  oneOffs.forEach(transaction => {
    const instances = expandRecurringTransaction(
      transaction,
      settings.startDate,
      settings.endDate
    );
    allInstances.push(...instances);
  });

  // Expand income streams
  incomeStreams.forEach(stream => {
    const transaction = {
      ...stream,
      recurring: true,
      type: 'income' as const
    };
    const instances = expandRecurringTransaction(
      transaction,
      settings.startDate,
      settings.endDate
    );
    allInstances.push(...instances);
  });

  return allInstances;
}

/**
 * Gets the master transaction table data (expanded + overrides applied)
 */
export function getMasterTransactionTable(data: AppState & { transactionOverrides?: TransactionOverride[] }): TransactionInstance[] {
  const expanded = expandAllTransactions(data);
  const withOverrides = applyOverrides(expanded, data.transactionOverrides || []);

  // Sort by date
  return withOverrides.sort((a, b) =>
    a.instanceDate.localeCompare(b.instanceDate)
  );
}

/**
 * Saves an override for a specific transaction instance
 */
export function saveOverride(
  data: AppState & { transactionOverrides?: TransactionOverride[] },
  parentId: string,
  instanceDate: YMDString,
  modifications: Partial<TransactionInstance>
): AppState & { transactionOverrides: TransactionOverride[] } {
  if (!data.transactionOverrides) {
    data.transactionOverrides = [];
  }

  // Check if override already exists
  const existingIndex = data.transactionOverrides.findIndex(
    o => o.parentId === parentId && o.instanceDate === instanceDate
  );

  const override: TransactionOverride = {
    id: existingIndex >= 0
      ? data.transactionOverrides[existingIndex].id
      : generateId(),
    parentId,
    parentType: 'oneOff', // You'd determine this from the actual parent
    instanceDate,
    modifications,
    deleted: false
  };

  if (existingIndex >= 0) {
    // Update existing override
    data.transactionOverrides[existingIndex] = override;
  } else {
    // Add new override
    data.transactionOverrides.push(override);
  }

  return data as AppState & { transactionOverrides: TransactionOverride[] };
}

/**
 * Marks a transaction instance as deleted
 */
export function deleteInstance(
  data: AppState & { transactionOverrides?: TransactionOverride[] },
  parentId: string,
  instanceDate: YMDString
): AppState & { transactionOverrides: TransactionOverride[] } {
  if (!data.transactionOverrides) {
    data.transactionOverrides = [];
  }

  const override: TransactionOverride = {
    id: generateId(),
    parentId,
    parentType: 'oneOff',
    instanceDate,
    deleted: true
  };

  data.transactionOverrides.push(override);
  return data as AppState & { transactionOverrides: TransactionOverride[] };
}

/**
 * Removes an override, reverting to the original recurring rule
 */
export function revertOverride(
  data: AppState & { transactionOverrides?: TransactionOverride[] },
  overrideId: string
): AppState & { transactionOverrides?: TransactionOverride[] } {
  if (!data.transactionOverrides) {
    return data;
  }

  data.transactionOverrides = data.transactionOverrides.filter(
    o => o.id !== overrideId
  );

  return data;
}

// Helper functions

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function formatDate(date: Date): YMDString {
  return date.toISOString().split('T')[0];
}

function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}
