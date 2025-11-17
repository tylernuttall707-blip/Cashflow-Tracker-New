import {
  defaultState,
  normalizeState,
  sanitizeWhatIfState,
  defaultAROptions,
  defaultARMappingOverrides,
  sanitizeAROptions,
  sanitizeARMapping,
} from "./validation";
import type { AppState, WhatIfState, ARPreferences } from "../types";

export const STORAGE_KEY = "cashflow2025_v1";
export const WHATIF_STORAGE_KEY = "cashflow2025_whatif_v1";
export const AR_PREFS_STORAGE_KEY = "cashflow2025_arPrefs_v1";

/**
 * Load the persisted primary application state from localStorage.
 */
export const loadState = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    return normalizeState(data, { strict: false });
  } catch {
    return defaultState();
  }
};

/**
 * Persist the primary application state to localStorage.
 */
export const saveState = (state: AppState): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

/**
 * Load the What-If sandbox state from localStorage.
 */
export const loadWhatIfState = (fallbackBase?: AppState): WhatIfState => {
  const fallback = fallbackBase || defaultState();
  try {
    const raw = localStorage.getItem(WHATIF_STORAGE_KEY);
    if (!raw) return sanitizeWhatIfState({ base: fallback }, fallback);
    const data = JSON.parse(raw);
    return sanitizeWhatIfState(data, fallback);
  } catch {
    return sanitizeWhatIfState({ base: fallback }, fallback);
  }
};

/**
 * Persist the What-If sandbox state to localStorage.
 */
export const saveWhatIfState = (sandbox: WhatIfState): void => {
  localStorage.setItem(WHATIF_STORAGE_KEY, JSON.stringify(sandbox));
};

/**
 * Load Accounts Receivable preferences from localStorage.
 */
export const loadARPreferences = (): ARPreferences => {
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
};

/**
 * Persist Accounts Receivable preferences to localStorage.
 */
export const saveARPreferences = (state?: any): void => {
  if (!state || typeof state !== "object") return;
  const options = state.options || {};
  const mapping = state.mappingOverrides || state.mapping || {};
  try {
    const payload = {
      options: {
        roll: options.roll,
        lag: options.lag,
        conf: options.conf,
        category: options.category,
        prune: options.prune,
      },
      mapping: { ...mapping },
    };
    localStorage.setItem(AR_PREFS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};
