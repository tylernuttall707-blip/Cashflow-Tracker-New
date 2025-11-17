/**
 * Zustand store for application state management
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, Settings, Adjustment, Transaction, IncomeStream, OneOffSortState } from '../types';
import { loadState, saveState } from '../modules/storage';

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
    ui: {
      oneOffSort: {
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
      return {
        ...getDefaultState(),
        ...loaded,
      };
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
