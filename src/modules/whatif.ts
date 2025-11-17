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
import type {
  AppState,
  WhatIfState,
  WhatIfTweaks,
  StreamTweak,
  GlobalTweak,
  IncomeStream,
  ProjectionResult,
  ProjectionOverrides,
  YMDString,
} from "../types/index.js";

/**
 * Prepare a sanitized What-If scenario payload.
 */
export const prepareScenario = (
  rawScenario: Partial<WhatIfState>,
  fallbackBase: AppState = defaultState()
): WhatIfState => sanitizeWhatIfState(rawScenario, fallbackBase);

/**
 * Create a new What-If scenario from a base state and optional tweaks.
 */
export const createScenario = (
  baseState: AppState,
  tweaks: Partial<WhatIfTweaks> = {}
): WhatIfState =>
  prepareScenario({ base: baseState, tweaks: tweaks as WhatIfTweaks }, baseState);

/**
 * Load a What-If scenario from persistence.
 */
export const loadScenario = (fallbackBase?: AppState): WhatIfState =>
  loadWhatIfState(fallbackBase);

/**
 * Persist a What-If scenario to storage.
 */
export const saveScenario = (scenario: WhatIfState): void => {
  if (!scenario || typeof scenario !== "object") return;
  saveWhatIfState(scenario);
};

/**
 * Evaluate the effective per-occurrence amount for a stream under What-If tweaks.
 */
export const evaluateWhatIfStream = (
  stream: IncomeStream,
  tweak: StreamTweak,
  baseAmount: number,
  globalTweaks: GlobalTweak
): number => {
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
 */
export const buildWhatIfOverrides = (
  baseState: AppState,
  tweaks: WhatIfTweaks
): ProjectionOverrides => {
  const globalTweaks: GlobalTweak = tweaks?.global || { pct: 0, delta: 0, lastEdited: "pct" };
  const streamTweaks: Record<string, StreamTweak> = tweaks?.streams || {};
  const streamMap = new Map<string, { entry: StreamTweak; occurrences: number; stream: IncomeStream }>();

  for (const stream of baseState?.incomeStreams || []) {
    if (!stream || typeof stream !== "object") continue;
    const streamId = typeof stream.id === "string" ? stream.id : String(stream.id || "");
    const entry: StreamTweak = streamTweaks[streamId] || {
      pct: 0,
      delta: 0,
      effective: null,
      weeklyTarget: null,
      lastEdited: "pct",
    };
    const occurrences = estimateOccurrencesPerWeek(stream);
    streamMap.set(streamId, { entry, occurrences, stream });
  }

  const transformStreamAmount = ({ stream, baseAmount }: {
    stream: IncomeStream;
    baseAmount: number;
  }): number => {
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

interface FirstNegativeComparison {
  actual: YMDString | null;
  scenario: YMDString | null;
  deltaDays: number | null;
  status: "none" | "cleared" | "new" | "unchanged" | "later" | "sooner";
}

interface ProjectionComparison {
  endBalance: number;
  totalIncome: number;
  totalExpenses: number;
  lowestBalance: number;
  peakBalance: number;
  negativeDays: number;
  firstNegative: FirstNegativeComparison;
}

/**
 * Compare key metrics between actual and What-If projections.
 */
export const compareProjections = (
  actual: ProjectionResult,
  scenario: ProjectionResult
): ProjectionComparison => {
  const diffMoney = (key: keyof ProjectionResult): number =>
    round2(Number(scenario?.[key] || 0) - Number(actual?.[key] || 0));
  const negativeDays = Number(scenario?.negativeDays || 0) - Number(actual?.negativeDays || 0);

  const actualFirst = actual?.firstNegativeDate || null;
  const scenarioFirst = scenario?.firstNegativeDate || null;

  let status: "none" | "cleared" | "new" | "unchanged" | "later" | "sooner" = "none";
  let deltaDays: number | null = null;
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
 */
const buildScenarioState = (scenario: WhatIfState): AppState => {
  const baseState = cloneStateForSandbox(scenario.base);
  const baseSettings = baseState.settings || defaultState().settings;
  const startDate = scenario.tweaks?.startDate || baseSettings.startDate;
  const endDate = scenario.tweaks?.endDate || baseSettings.endDate;
  baseState.settings = { ...baseSettings, startDate, endDate };
  return baseState;
};

interface EvaluationResult {
  actual: ProjectionResult;
  sandbox: ProjectionResult;
  comparison: ProjectionComparison;
}

/**
 * Evaluate a What-If scenario against the provided actual state.
 */
export const evaluateScenario = (
  actualState: AppState,
  scenario: WhatIfState
): EvaluationResult => {
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

interface WhatIfManagerOptions {
  loader?: (fallbackBase?: AppState) => WhatIfState;
  saver?: (scenario: WhatIfState) => void;
}

/**
 * Lightweight manager around What-If scenario persistence and evaluation.
 */
export class WhatIfManager {
  private _loader: (fallbackBase?: AppState) => WhatIfState;
  private _saver: (scenario: WhatIfState) => void;
  private _scenario: WhatIfState | null;
  private _fallbackBase: AppState;

  constructor({ loader = loadScenario, saver = saveScenario }: WhatIfManagerOptions = {}) {
    this._loader = loader;
    this._saver = saver;
    this._scenario = null;
    this._fallbackBase = defaultState();
  }

  /**
   * Load the scenario from persistence, using the supplied base state as fallback.
   */
  load(baseState: AppState): WhatIfState {
    this._fallbackBase = cloneStateForSandbox(baseState || defaultState());
    this._scenario = prepareScenario(this._loader(this._fallbackBase), this._fallbackBase);
    return this._scenario;
  }

  /**
   * Get the current scenario, creating a default one when necessary.
   */
  getScenario(): WhatIfState {
    if (!this._scenario) {
      this._scenario = createScenario(this._fallbackBase);
    }
    return this._scenario;
  }

  /**
   * Replace the current scenario with a new payload.
   */
  setScenario(nextScenario: WhatIfState): WhatIfState {
    const fallback = this._fallbackBase || defaultState();
    this._scenario = prepareScenario(nextScenario, fallback);
    return this._scenario;
  }

  /**
   * Persist the current scenario using the configured saver.
   */
  save(): void {
    if (!this._scenario) return;
    this._saver(this._scenario);
  }

  /**
   * Evaluate the active scenario against a supplied actual state.
   */
  evaluate(actualState: AppState): EvaluationResult {
    const scenario = this.getScenario();
    const preparedScenario = prepareScenario(scenario, actualState);
    return evaluateScenario(actualState, preparedScenario);
  }
}
