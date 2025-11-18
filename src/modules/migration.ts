/**
 * Migration utilities to convert legacy transaction format to expanded transactions
 */

import { fromYMD, toYMD } from './dateUtils';
import { shouldApplyStreamOn, resolveRecurringAmount } from './transactions';
import type {
  Transaction,
  IncomeStream,
  ExpandedTransaction,
  AppState,
  YMDString,
} from '../types';

/**
 * Convert a one-off transaction to an expanded transaction
 */
export const convertOneOffToExpanded = (
  transaction: Transaction
): ExpandedTransaction | null => {
  if (transaction.recurring) {
    return null; // This function only handles one-off transactions
  }

  return {
    id: transaction.id,
    date: transaction.date,
    type: transaction.type,
    name: transaction.name,
    category: transaction.category,
    amount: Math.abs(transaction.amount),
    note: transaction.note,
    sourceType: 'one-off',
    source: transaction.source,
    status: transaction.status,
  };
};

/**
 * Expand a recurring transaction into individual instances
 */
export const expandRecurringTransaction = (
  transaction: Transaction,
  startDate: YMDString,
  endDate: YMDString
): ExpandedTransaction[] => {
  if (!transaction.recurring) {
    return []; // This function only handles recurring transactions
  }

  const results: ExpandedTransaction[] = [];
  const start = fromYMD(startDate);
  const end = fromYMD(endDate);
  const txStart = fromYMD(transaction.startDate);
  const txEnd = fromYMD(transaction.endDate);

  // Use the overlap of the transaction range and the projection range
  const effectiveStart = start > txStart ? start : txStart;
  const effectiveEnd = end < txEnd ? end : txEnd;

  if (effectiveStart > effectiveEnd) {
    return []; // No overlap
  }

  let previousOccurrence: Date | null = null;

  // Iterate through each day in the effective range
  for (
    let cursor = new Date(effectiveStart.getTime());
    cursor <= effectiveEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    if (!shouldApplyStreamOn(cursor, transaction)) {
      continue;
    }

    const amount = resolveRecurringAmount(transaction, cursor, previousOccurrence);
    const dateYMD = toYMD(cursor);

    results.push({
      id: `${transaction.id}-${dateYMD}`,
      date: dateYMD,
      type: transaction.type,
      name: transaction.name,
      category: transaction.category,
      amount: Math.abs(amount),
      note: transaction.note,
      sourceType: 'recurring',
      parentId: transaction.id,
      parentName: transaction.name,
      source: transaction.source,
      status: transaction.status,
    });

    previousOccurrence = new Date(cursor.getTime());
  }

  return results;
};

/**
 * Expand an income stream into individual instances
 */
export const expandIncomeStream = (
  stream: IncomeStream,
  startDate: YMDString,
  endDate: YMDString
): ExpandedTransaction[] => {
  const results: ExpandedTransaction[] = [];
  const start = fromYMD(startDate);
  const end = fromYMD(endDate);
  const streamStart = fromYMD(stream.startDate);
  const streamEnd = fromYMD(stream.endDate);

  // Use the overlap of the stream range and the projection range
  const effectiveStart = start > streamStart ? start : streamStart;
  const effectiveEnd = end < streamEnd ? end : streamEnd;

  if (effectiveStart > effectiveEnd) {
    return []; // No overlap
  }

  let previousOccurrence: Date | null = null;

  // Iterate through each day in the effective range
  for (
    let cursor = new Date(effectiveStart.getTime());
    cursor <= effectiveEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    if (!shouldApplyStreamOn(cursor, stream)) {
      continue;
    }

    const amount = resolveRecurringAmount(stream, cursor, previousOccurrence);
    const dateYMD = toYMD(cursor);

    results.push({
      id: `${stream.id}-${dateYMD}`,
      date: dateYMD,
      type: 'income',
      name: stream.name,
      category: stream.category,
      amount: Math.abs(amount),
      sourceType: 'income-stream',
      parentId: stream.id,
      parentName: stream.name,
    });

    previousOccurrence = new Date(cursor.getTime());
  }

  return results;
};

/**
 * Migrate all transactions to expanded format
 */
export const migrateToExpandedTransactions = (state: AppState): ExpandedTransaction[] => {
  const expanded: ExpandedTransaction[] = [];

  // Process one-off and recurring transactions
  for (const transaction of state.oneOffs) {
    if (transaction.recurring) {
      // Expand recurring transaction
      const instances = expandRecurringTransaction(
        transaction,
        state.settings.startDate,
        state.settings.endDate
      );
      expanded.push(...instances);
    } else {
      // Convert one-off transaction
      const converted = convertOneOffToExpanded(transaction);
      if (converted) {
        expanded.push(converted);
      }
    }
  }

  // Process income streams
  for (const stream of state.incomeStreams) {
    const instances = expandIncomeStream(
      stream,
      state.settings.startDate,
      state.settings.endDate
    );
    expanded.push(...instances);
  }

  // Sort by date
  expanded.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    // Secondary sort by name for consistent ordering
    return a.name.localeCompare(b.name);
  });

  return expanded;
};

/**
 * Check if migration is needed (i.e., expandedTransactions is empty but legacy data exists)
 */
export const needsMigration = (state: AppState): boolean => {
  return (
    state.expandedTransactions.length === 0 &&
    (state.oneOffs.length > 0 || state.incomeStreams.length > 0)
  );
};

/**
 * Perform migration if needed
 */
export const performMigrationIfNeeded = (state: AppState): AppState => {
  if (!needsMigration(state)) {
    return state;
  }

  console.log('Migrating legacy transactions to expanded format...');
  const expandedTransactions = migrateToExpandedTransactions(state);
  console.log(`Migrated ${expandedTransactions.length} expanded transactions`);

  return {
    ...state,
    expandedTransactions,
  };
};
