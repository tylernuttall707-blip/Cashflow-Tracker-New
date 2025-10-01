"use strict";

import {
  defaultState,
  normalizeState,
  sanitizeWhatIfState,
  defaultAROptions,
  defaultARMappingOverrides,
  sanitizeAROptions,
  sanitizeARMapping,
} from "./validation.js";

export const STORAGE_KEY = "cashflow2025_v1";
export const WHATIF_STORAGE_KEY = "cashflow2025_whatif_v1";
export const AR_PREFS_STORAGE_KEY = "cashflow2025_arPrefs_v1";

/**
 * Load the persisted primary application state from localStorage.
 * @returns {object} The hydrated application state.
 */
export const loadState = () => {
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
 * @param {object} state - The state tree to persist.
 * @returns {void}
 */
export const saveState = (state) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

/**
 * Load the What-If sandbox state from localStorage.
 * @param {object} [fallbackBase] - Optional fallback base state.
 * @returns {{base: object, tweaks: object}} Sanitized What-If state.
 */
export const loadWhatIfState = (fallbackBase) => {
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
 * @param {{base: object, tweaks: object}} sandbox - The sandbox payload to save.
 * @returns {void}
 */
export const saveWhatIfState = (sandbox) => {
  localStorage.setItem(WHATIF_STORAGE_KEY, JSON.stringify(sandbox));
};

/**
 * Load Accounts Receivable preferences from localStorage.
 * @returns {{options: object, mapping: object}} Sanitized AR preferences.
 */
export const loadARPreferences = () => {
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
 * @param {{options?: object, mappingOverrides?: object, mapping?: object}} [state=globalThis?.arState] -
 *   The AR state slice to persist. Defaults to the global `arState` when available.
 * @returns {void}
 */
export const saveARPreferences = (state = globalThis?.arState) => {
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
