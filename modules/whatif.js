"use strict";

import { computeEffectiveAmount, computeProjection, round2 } from "./calculations.js";
import { fromYMD } from "./dateUtils.js";
import { loadWhatIfState, saveWhatIfState } from "./storage.js";
import {
  cloneStateForSandbox,
  defaultState,
  sanitizeWhatIfState,
} from "./validation.js";
import { estimateOccurrencesPerWeek } from "./transactions.js";

/**
 * Prepare a sanitized What-If scenario payload.
 * @param {object} rawScenario - Raw scenario object containing base/tweaks.
 * @param {object} [fallbackBase=defaultState()] - Fallback base state when missing.
 * @returns {{base: object, tweaks: object}} Sanitized scenario object.
 */
export const prepareScenario = (rawScenario, fallbackBase = defaultState()) =>
  sanitizeWhatIfState(rawScenario, fallbackBase);

/**
 * Create a new What-If scenario from a base state and optional tweaks.
 * @param {object} baseState - Application state to clone for the scenario.
 * @param {object} [tweaks={}] - Initial tweak payload.
 * @returns {{base: object, tweaks: object}} Prepared What-If scenario.
 */
export const createScenario = (baseState, tweaks = {}) =>
  prepareScenario({ base: baseState, tweaks }, baseState);

/**
 * Load a What-If scenario from persistence.
 * @param {object} [fallbackBase] - Optional fallback base state when none stored.
 * @returns {{base: object, tweaks: object}} Sanitized scenario payload.
 */
export const loadScenario = (fallbackBase) => loadWhatIfState(fallbackBase);

/**
 * Persist a What-If scenario to storage.
 * @param {{base: object, tweaks: object}} scenario - Scenario payload to save.
 * @returns {void}
 */
export const saveScenario = (scenario) => {
  if (!scenario || typeof scenario !== "object") return;
  saveWhatIfState(scenario);
};

/**
 * Evaluate the effective per-occurrence amount for a stream under What-If tweaks.
 * @param {object} stream - Stream definition.
 * @param {object} tweak - Stream tweak entry.
 * @param {number} baseAmount - Base occurrence amount before tweaks.
 * @param {{pct: number, delta: number}} globalTweaks - Global tweak settings.
 * @returns {number} Adjusted amount for the occurrence.
 */
export const evaluateWhatIfStream = (stream, tweak, baseAmount, globalTweaks) => {
  const occurrenceBase = Math.abs(Number(baseAmount || 0));
  const globalAdjusted = computeEffectiveAmount(occurrenceBase, globalTweaks.pct, globalTweaks.delta);
  if (tweak.lastEdited === "weekly" && tweak.weeklyTarget !== null) {
    const occurrences = estimateOccurrencesPerWeek(stream);
    if (occurrences > 0) {
      return round2(tweak.weeklyTarget / occurrences);
    }
  }
  if (tweak.lastEdited === "effective" && tweak.effective !== null) {
    return round2(tweak.effective);
  }
  return computeEffectiveAmount(globalAdjusted, tweak.pct, tweak.delta);
};

/**
 * Build a computeProjection override payload for a sanitized What-If scenario.
 * @param {object} baseState - Scenario base state with normalized streams.
 * @param {object} tweaks - Scenario tweaks section.
 * @returns {{transformStreamAmount: Function, sale: object}} Projection overrides.
 */
export const buildWhatIfOverrides = (baseState, tweaks) => {
  const globalTweaks = tweaks?.global || { pct: 0, delta: 0, lastEdited: "pct" };
  const streamTweaks = tweaks?.streams || {};
  const streamMap = new Map();

  for (const stream of baseState?.incomeStreams || []) {
    if (!stream || typeof stream !== "object") continue;
    const streamId = typeof stream.id === "string" ? stream.id : String(stream.id || "");
    const entry = streamTweaks[streamId] || {
      pct: 0,
      delta: 0,
      effective: null,
      weeklyTarget: null,
      lastEdited: "pct",
    };
    const occurrences = estimateOccurrencesPerWeek(stream);
    streamMap.set(streamId, { entry, occurrences, stream });
  }

  const transformStreamAmount = ({ stream, baseAmount }) => {
    const streamId = typeof stream?.id === "string" ? stream.id : String(stream?.id || "");
    const info = streamMap.get(streamId);
    const occurrenceBase = Math.abs(Number(baseAmount || 0));
    const baseAfterGlobal = computeEffectiveAmount(occurrenceBase, globalTweaks.pct, globalTweaks.delta);
    if (!info) return baseAfterGlobal;
    const { entry, occurrences } = info;
    if (entry.lastEdited === "weekly" && entry.weeklyTarget !== null && occurrences > 0) {
      return round2(entry.weeklyTarget / occurrences);
    }
    if (entry.lastEdited === "effective" && entry.effective !== null) {
      return round2(entry.effective);
    }
    return computeEffectiveAmount(baseAfterGlobal, entry.pct, entry.delta);
  };

  const saleTweaks = tweaks?.sale || { enabled: false, entries: [] };
  const saleEntries = Array.isArray(saleTweaks.entries)
    ? saleTweaks.entries.map((entry) => ({ ...entry }))
    : [];

  return {
    transformStreamAmount,
    sale: {
      enabled: Boolean(saleTweaks.enabled),
      entries: saleEntries,
    },
  };
};

/**
 * Compare key metrics between actual and What-If projections.
 * @param {object} actual - Projection summary from the actual state.
 * @param {object} scenario - Projection summary from the scenario state.
 * @returns {{
 *   endBalance: number,
 *   totalIncome: number,
 *   totalExpenses: number,
 *   lowestBalance: number,
 *   peakBalance: number,
 *   negativeDays: number,
 *   firstNegative: { actual: string|null, scenario: string|null, deltaDays: number|null, status: string }
 * }} Comparison payload with delta metrics.
 */
export const compareProjections = (actual, scenario) => {
  const diffMoney = (key) =>
    round2(Number(scenario?.[key] || 0) - Number(actual?.[key] || 0));
  const negativeDays = Number(scenario?.negativeDays || 0) - Number(actual?.negativeDays || 0);

  const actualFirst = actual?.firstNegativeDate || null;
  const scenarioFirst = scenario?.firstNegativeDate || null;

  let status = "none";
  let deltaDays = null;
  if (!scenarioFirst && !actualFirst) {
    status = "none";
    deltaDays = 0;
  } else if (!scenarioFirst && actualFirst) {
    status = "cleared";
  } else if (scenarioFirst && !actualFirst) {
    status = "new";
  } else if (scenarioFirst && actualFirst) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const diff = fromYMD(scenarioFirst).getTime() - fromYMD(actualFirst).getTime();
    deltaDays = Math.round(diff / msPerDay);
    status = deltaDays === 0 ? "unchanged" : deltaDays > 0 ? "later" : "sooner";
  }

  return {
    endBalance: diffMoney("endBalance"),
    totalIncome: diffMoney("totalIncome"),
    totalExpenses: diffMoney("totalExpenses"),
    lowestBalance: diffMoney("lowestBalance"),
    peakBalance: diffMoney("peakBalance"),
    negativeDays,
    firstNegative: {
      actual: actualFirst,
      scenario: scenarioFirst,
      deltaDays,
      status,
    },
  };
};

/**
 * Internal helper to construct the sandbox state for a scenario.
 * @param {{base: object, tweaks: object}} scenario - Sanitized scenario payload.
 * @returns {object} Cloned state ready for projection.
 */
const buildScenarioState = (scenario) => {
  const baseState = cloneStateForSandbox(scenario.base);
  const baseSettings = baseState.settings || defaultState().settings;
  const startDate = scenario.tweaks?.startDate || baseSettings.startDate;
  const endDate = scenario.tweaks?.endDate || baseSettings.endDate;
  baseState.settings = { ...baseSettings, startDate, endDate };
  return baseState;
};

/**
 * Evaluate a What-If scenario against the provided actual state.
 * @param {object} actualState - Current application state.
 * @param {{base: object, tweaks: object}} scenario - Sanitized What-If scenario.
 * @returns {{ actual: object, sandbox: object, comparison: object }} Projection results.
 */
export const evaluateScenario = (actualState, scenario) => {
  const sanitizedScenario = prepareScenario(scenario, actualState);
  const scenarioState = buildScenarioState(sanitizedScenario);
  const overrides = buildWhatIfOverrides(scenarioState, sanitizedScenario.tweaks);
  const actualProjection = computeProjection(actualState);
  const sandboxProjection = computeProjection(scenarioState, overrides);
  return {
    actual: actualProjection,
    sandbox: sandboxProjection,
    comparison: compareProjections(actualProjection, sandboxProjection),
  };
};

/**
 * Lightweight manager around What-If scenario persistence and evaluation.
 */
export class WhatIfManager {
  /**
   * @param {{ loader?: Function, saver?: Function }} [options] - Optional I/O hooks.
   */
  constructor({ loader = loadScenario, saver = saveScenario } = {}) {
    this._loader = loader;
    this._saver = saver;
    this._scenario = null;
    this._fallbackBase = defaultState();
  }

  /**
   * Load the scenario from persistence, using the supplied base state as fallback.
   * @param {object} baseState - Base state to fall back to when none stored.
   * @returns {{base: object, tweaks: object}} Sanitized scenario.
   */
  load(baseState) {
    this._fallbackBase = cloneStateForSandbox(baseState || defaultState());
    this._scenario = prepareScenario(this._loader(this._fallbackBase), this._fallbackBase);
    return this._scenario;
  }

  /**
   * Get the current scenario, creating a default one when necessary.
   * @returns {{base: object, tweaks: object}} Active scenario payload.
   */
  getScenario() {
    if (!this._scenario) {
      this._scenario = createScenario(this._fallbackBase);
    }
    return this._scenario;
  }

  /**
   * Replace the current scenario with a new payload.
   * @param {{base: object, tweaks: object}} nextScenario - Scenario to set.
   * @returns {{base: object, tweaks: object}} Sanitized scenario payload.
   */
  setScenario(nextScenario) {
    const fallback = this._fallbackBase || defaultState();
    this._scenario = prepareScenario(nextScenario, fallback);
    return this._scenario;
  }

  /**
   * Persist the current scenario using the configured saver.
   * @returns {void}
   */
  save() {
    if (!this._scenario) return;
    this._saver(this._scenario);
  }

  /**
   * Evaluate the active scenario against a supplied actual state.
   * @param {object} actualState - Actual application state to compare against.
   * @returns {{ actual: object, sandbox: object, comparison: object }} Evaluation payload.
   */
  evaluate(actualState) {
    const scenario = this.getScenario();
    const preparedScenario = prepareScenario(scenario, actualState);
    return evaluateScenario(actualState, preparedScenario);
  }
}

