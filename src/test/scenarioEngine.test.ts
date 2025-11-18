/**
 * Tests for scenario engine
 */

import { describe, it, expect } from 'vitest';
import {
  computeScenarioProjection,
  applyScenarioChanges,
  createScenarioTemplate,
  validateScenarioChange,
} from '../modules/scenarioEngine';
import type { AppState, Scenario, ScenarioChange } from '../types';

// Helper to create a minimal valid AppState for testing
function createTestState(): AppState {
  const today = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // 90 days from now

  return {
    settings: {
      startDate: today,
      endDate: endDate,
      startingBalance: 10000,
    },
    adjustments: [],
    oneOffs: [],
    incomeStreams: [],
    expandedTransactions: [
      {
        id: 'tx-1',
        date: today,
        type: 'income',
        name: 'Salary',
        category: 'Employment',
        amount: 5000,
        sourceType: 'income-stream',
      },
      {
        id: 'tx-2',
        date: today,
        type: 'expense',
        name: 'Rent',
        category: 'Housing',
        amount: 2000,
        sourceType: 'recurring',
      },
      {
        id: 'tx-3',
        date: today,
        type: 'expense',
        name: 'Groceries',
        category: 'Food',
        amount: 500,
        sourceType: 'one-off',
      },
    ],
    ui: {
      oneOffSort: { key: 'date', direction: 'asc' },
      expandedSort: { key: 'date', direction: 'asc' },
    },
    scenarios: [],
    activeScenarioId: null,
  };
}

describe('Scenario Engine', () => {
  describe('applyScenarioChanges', () => {
    it('should apply transaction_add change', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'transaction_add',
            description: 'Add new expense',
            changes: {
              newTransaction: {
                type: 'expense',
                name: 'New Subscription',
                category: 'Software',
                amount: 100,
                date: baseState.settings.startDate,
                sourceType: 'one-off',
              },
            },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      expect(modifiedState.expandedTransactions).toHaveLength(4);
      expect(
        modifiedState.expandedTransactions.find((tx) => tx.name === 'New Subscription')
      ).toBeDefined();
    });

    it('should apply transaction_remove change', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'transaction_remove',
            description: 'Remove groceries',
            targetId: 'tx-3',
            changes: {},
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      expect(modifiedState.expandedTransactions).toHaveLength(2);
      expect(
        modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-3')
      ).toBeUndefined();
    });

    it('should apply transaction_modify change with amount', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'transaction_modify',
            description: 'Increase rent',
            targetId: 'tx-2',
            changes: {
              amount: 2500,
            },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      const rent = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-2');
      expect(rent?.amount).toBe(2500);
      expect(rent?.isEdited).toBe(true);
      expect(rent?.originalAmount).toBe(2000);
    });

    it('should apply transaction_modify change with multiplier', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'transaction_modify',
            description: 'Increase rent by 10%',
            targetId: 'tx-2',
            changes: {
              amountMultiplier: 1.1,
            },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      const rent = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-2');
      expect(rent?.amount).toBe(2200);
    });

    it('should apply bulk_adjustment change', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'bulk_adjustment',
            description: 'Increase all expenses by 10%',
            targetType: 'expense',
            changes: {
              typeFilter: 'expense',
              percentChange: 10,
            },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      const rent = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-2');
      const groceries = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-3');
      const salary = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-1');

      expect(rent?.amount).toBe(2200); // 2000 * 1.1
      expect(groceries?.amount).toBe(550); // 500 * 1.1
      expect(salary?.amount).toBe(5000); // unchanged (income)
    });

    it('should apply income_adjust change', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'income_adjust',
            description: 'Reduce income by 15%',
            targetType: 'income',
            changes: {
              percentChange: -15,
            },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      const salary = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-1');
      expect(salary?.amount).toBe(4250); // 5000 * 0.85
    });

    it('should apply expense_adjust change', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'expense_adjust',
            description: 'Reduce expenses by 25%',
            changes: {
              percentChange: -25,
            },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      const rent = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-2');
      const groceries = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-3');

      expect(rent?.amount).toBe(1500); // 2000 * 0.75
      expect(groceries?.amount).toBe(375); // 500 * 0.75
    });

    it('should apply setting_override change', () => {
      const baseState = createTestState();
      const newBalance = 15000;

      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'setting_override',
            description: 'Start with higher balance',
            changes: {
              startingBalance: newBalance,
            },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      expect(modifiedState.settings.startingBalance).toBe(newBalance);
    });

    it('should apply multiple changes in sequence', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'income_adjust',
            description: 'Reduce income by 10%',
            targetType: 'income',
            changes: { percentChange: -10 },
          },
          {
            id: 'change-2',
            type: 'expense_adjust',
            description: 'Increase expenses by 5%',
            changes: { percentChange: 5 },
          },
          {
            id: 'change-3',
            type: 'setting_override',
            description: 'Lower starting balance',
            changes: { startingBalance: 8000 },
          },
        ],
      };

      const modifiedState = applyScenarioChanges(baseState, scenario);

      const salary = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-1');
      const rent = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-2');
      const groceries = modifiedState.expandedTransactions.find((tx) => tx.id === 'tx-3');

      expect(salary?.amount).toBe(4500); // 5000 * 0.9
      expect(rent?.amount).toBe(2100); // 2000 * 1.05
      expect(groceries?.amount).toBe(525); // 500 * 1.05
      expect(modifiedState.settings.startingBalance).toBe(8000);
    });
  });

  describe('createScenarioTemplate', () => {
    it('should create conservative template', () => {
      const baseState = createTestState();
      const scenario = createScenarioTemplate('conservative', baseState);

      expect(scenario.name).toBe('Conservative');
      expect(scenario.changes).toHaveLength(2);
      expect(scenario.color).toBe('#F59E0B');
    });

    it('should create aggressive template', () => {
      const baseState = createTestState();
      const scenario = createScenarioTemplate('aggressive', baseState);

      expect(scenario.name).toBe('Aggressive Growth');
      expect(scenario.changes).toHaveLength(2);
      expect(scenario.color).toBe('#10B981');
    });

    it('should create worst-case template', () => {
      const baseState = createTestState();
      const scenario = createScenarioTemplate('worst-case', baseState);

      expect(scenario.name).toBe('Worst Case');
      expect(scenario.changes).toHaveLength(2);
      expect(scenario.color).toBe('#EF4444');
    });

    it('should create cost-cutting template', () => {
      const baseState = createTestState();
      const scenario = createScenarioTemplate('cost-cutting', baseState);

      expect(scenario.name).toBe('Cost Cutting');
      expect(scenario.changes).toHaveLength(1);
      expect(scenario.color).toBe('#6366F1');
    });
  });

  describe('validateScenarioChange', () => {
    it('should validate transaction_add with newTransaction', () => {
      const baseState = createTestState();
      const change: ScenarioChange = {
        id: 'change-1',
        type: 'transaction_add',
        description: 'Add transaction',
        changes: {
          newTransaction: {
            type: 'expense',
            name: 'Test',
            amount: 100,
            category: 'Test',
            sourceType: 'one-off',
          },
        },
      };

      const result = validateScenarioChange(change, baseState);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should invalidate transaction_add without newTransaction', () => {
      const baseState = createTestState();
      const change: ScenarioChange = {
        id: 'change-1',
        type: 'transaction_add',
        description: 'Add transaction',
        changes: {},
      };

      const result = validateScenarioChange(change, baseState);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should invalidate transaction_modify with non-existent targetId', () => {
      const baseState = createTestState();
      const change: ScenarioChange = {
        id: 'change-1',
        type: 'transaction_modify',
        description: 'Modify transaction',
        targetId: 'non-existent-id',
        changes: { amount: 100 },
      };

      const result = validateScenarioChange(change, baseState);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('computeScenarioProjection', () => {
    it('should compute projection for modified state', () => {
      const baseState = createTestState();
      const scenario: Scenario = {
        id: 'scenario-1',
        name: 'Test',
        color: '#000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        changes: [
          {
            id: 'change-1',
            type: 'income_adjust',
            description: 'Increase income by 20%',
            targetType: 'income',
            changes: { percentChange: 20 },
          },
        ],
      };

      const projection = computeScenarioProjection(baseState, scenario);

      expect(projection).toBeDefined();
      expect(projection.totalIncome).toBeGreaterThan(0);
      expect(projection.totalExpenses).toBeGreaterThan(0);
      expect(projection.endBalance).toBeDefined();
    });
  });
});
