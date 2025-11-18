/**
 * Zustand store for application state management
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, Settings, Adjustment, Transaction, IncomeStream, OneOffSortState, ExpandedTransaction, ExpandedSortState } from '../types';
import { loadState, saveState } from '../modules/storage';
import { performMigrationIfNeeded } from '../modules/migration';

interface AppStore extends AppState {
  // Actions for settings
  updateSettings: (settings: Partial<Settings>) => void;

  // Actions for adjustments
  addAdjustment: (adjustment: Adjustment) => void;
  removeAdjustment: (date: string) => void;

  // Actions for one-offs
  addOneOff: (transaction: Transaction) => void;
  updateOneOff: (id: string, transaction: Transaction) => void;
  removeOneOff: (id: string) => void;
  setOneOffs: (oneOffs: Transaction[]) => void;

  // Actions for income streams
  addIncomeStream: (stream: IncomeStream) => void;
  updateIncomeStream: (id: string, stream: IncomeStream) => void;
  removeIncomeStream: (id: string) => void;
  setIncomeStreams: (streams: IncomeStream[]) => void;

  // Actions for UI state
  setOneOffSort: (sort: OneOffSortState) => void;
  setExpandedSort: (sort: ExpandedSortState) => void;

  // Actions for expanded transactions
  addExpandedTransaction: (transaction: ExpandedTransaction) => void;
  updateExpandedTransaction: (id: string, transaction: ExpandedTransaction) => void;
  removeExpandedTransaction: (id: string) => void;
  removeExpandedTransactions: (ids: string[]) => void;  // Bulk delete
  setExpandedTransactions: (transactions: ExpandedTransaction[]) => void;

  // Global actions
  importData: (data: Partial<AppState>) => void;
  resetToDefaults: () => void;
}

// Default state
const getDefaultState = (): AppState => {
  const today = new Date().toISOString().slice(0, 10);
  const endOfYear = new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10);

  return {
    settings: {
      startDate: today,
      endDate: endOfYear,
      startingBalance: 0,
    },
    adjustments: [],
    oneOffs: [],
    incomeStreams: [],
    expandedTransactions: [],
    ui: {
      oneOffSort: {
        key: 'date',
        direction: 'asc',
      },
      expandedSort: {
        key: 'date',
        direction: 'asc',
      },
    },
  };
};

// Try to load existing state or use defaults
const getInitialState = (): AppState => {
  try {
    const loaded = loadState();
    if (loaded) {
      const merged = {
        ...getDefaultState(),
        ...loaded,
      };
      // Perform migration if needed
      const migrated = performMigrationIfNeeded(merged);
      // Save the migrated state if migration occurred
      if (migrated.expandedTransactions.length > 0 && migrated !== merged) {
        saveState(migrated);
      }
      return migrated;
    }
  } catch (err) {
    console.warn('Failed to load state from storage:', err);
  }
  return getDefaultState();
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...getInitialState(),

      // Settings actions
      updateSettings: (settings) => {
        set((state) => {
          const newState = {
            ...state,
            settings: { ...state.settings, ...settings },
          };
          saveState(newState);
          return newState;
        });
      },

      // Adjustment actions
      addAdjustment: (adjustment) => {
        set((state) => {
          const newState = {
            ...state,
            adjustments: [...state.adjustments, adjustment],
          };
          saveState(newState);
          return newState;
        });
      },

      removeAdjustment: (date) => {
        set((state) => {
          const newState = {
            ...state,
            adjustments: state.adjustments.filter((adj) => adj.date !== date),
          };
          saveState(newState);
          return newState;
        });
      },

      // One-off actions
      addOneOff: (transaction) => {
        set((state) => {
          const newState = {
            ...state,
            oneOffs: [...state.oneOffs, transaction],
          };
          saveState(newState);
          return newState;
        });
      },

      updateOneOff: (id, transaction) => {
        set((state) => {
          const newState = {
            ...state,
            oneOffs: state.oneOffs.map((t) => (t.id === id ? transaction : t)),
          };
          saveState(newState);
          return newState;
        });
      },

      removeOneOff: (id) => {
        set((state) => {
          const newState = {
            ...state,
            oneOffs: state.oneOffs.filter((t) => t.id !== id),
          };
          saveState(newState);
          return newState;
        });
      },

      setOneOffs: (oneOffs) => {
        set((state) => {
          const newState = {
            ...state,
            oneOffs,
          };
          saveState(newState);
          return newState;
        });
      },

      // Income stream actions
      addIncomeStream: (stream) => {
        set((state) => {
          const newState = {
            ...state,
            incomeStreams: [...state.incomeStreams, stream],
          };
          saveState(newState);
          return newState;
        });
      },

      updateIncomeStream: (id, stream) => {
        set((state) => {
          const newState = {
            ...state,
            incomeStreams: state.incomeStreams.map((s) => (s.id === id ? stream : s)),
          };
          saveState(newState);
          return newState;
        });
      },

      removeIncomeStream: (id) => {
        set((state) => {
          const newState = {
            ...state,
            incomeStreams: state.incomeStreams.filter((s) => s.id !== id),
          };
          saveState(newState);
          return newState;
        });
      },

      setIncomeStreams: (streams) => {
        set((state) => {
          const newState = {
            ...state,
            incomeStreams: streams,
          };
          saveState(newState);
          return newState;
        });
      },

      // UI actions
      setOneOffSort: (sort) => {
        set((state) => ({
          ...state,
          ui: { ...state.ui, oneOffSort: sort },
        }));
      },

      setExpandedSort: (sort) => {
        set((state) => ({
          ...state,
          ui: { ...state.ui, expandedSort: sort },
        }));
      },

      // Expanded transaction actions
      addExpandedTransaction: (transaction) => {
        set((state) => {
          const newState = {
            ...state,
            expandedTransactions: [...state.expandedTransactions, transaction],
          };
          saveState(newState);
          return newState;
        });
      },

      updateExpandedTransaction: (id, transaction) => {
        set((state) => {
          const newState = {
            ...state,
            expandedTransactions: state.expandedTransactions.map((t) =>
              t.id === id ? transaction : t
            ),
          };
          saveState(newState);
          return newState;
        });
      },

      removeExpandedTransaction: (id) => {
        set((state) => {
          const newState = {
            ...state,
            expandedTransactions: state.expandedTransactions.filter((t) => t.id !== id),
          };
          saveState(newState);
          return newState;
        });
      },

      removeExpandedTransactions: (ids) => {
        set((state) => {
          const newState = {
            ...state,
            expandedTransactions: state.expandedTransactions.filter((t) => !ids.includes(t.id)),
          };
          saveState(newState);
          return newState;
        });
      },

      setExpandedTransactions: (transactions) => {
        set((state) => {
          const newState = {
            ...state,
            expandedTransactions: transactions,
          };
          saveState(newState);
          return newState;
        });
      },

      // Global actions
      importData: (data) => {
        set((state) => {
          const newState = {
            ...state,
            ...data,
          };
          saveState(newState);
          return newState;
        });
      },

      resetToDefaults: () => {
        const defaultState = getDefaultState();
        set(defaultState);
        saveState(defaultState);
      },
    }),
    {
      name: 'cashflow-tracker-storage',
    }
  )
);
