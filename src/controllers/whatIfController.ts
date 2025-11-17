/**
 * What-If Scenario Controller
 * Handles UI/DOM interactions for the What-If scenario tab
 */

import type {
  AppState,
  WhatIfState,
  GlobalTweak,
  StreamTweak,
  SaleEntry,
  ProjectionResult,
  YMDString,
} from '../types';
import {
  evaluateWhatIfStream,
  buildWhatIfOverrides,
  saveScenario,
} from '../modules/whatif';
import {
  sanitizeWhatIfState,
  cloneStateForSandbox,
  defaultState,
  clampPercent,
  clampCurrency,
} from '../modules/validation';
import { computeProjection, computeEffectiveAmount, round2, fmtMoney } from '../modules/calculations';
import { renderWhatIfChart } from '../utils/chartUtils';
import { estimateOccurrencesPerWeek } from '../modules/transactions';
import { toYMD, fromYMD, compareYMD, fmtDate } from '../modules/dateUtils';
import { isValidYMDString } from '../modules/validation';

/**
 * Sale entry UI state
 */
interface SaleUIState {
  isEditing: boolean;
  draft: SaleDraft;
}

/**
 * Sale entry draft for editing
 */
interface SaleDraft {
  name: string;
  pct: string;
  topup: string;
  startDate: YMDString;
  endDate: YMDString;
  businessDaysOnly: boolean;
  lastEdited: 'pct' | 'topup';
}

/**
 * Stream display info for rendering
 */
interface StreamDisplayInfo {
  id: string;
  stream: any;
  baseAmount: number;
  baseAfterGlobal: number;
  occurrences: number;
  entry: StreamTweak;
  finalAmount: number;
}

/**
 * Controller state
 */
let whatIfRenderPending = false;
const saleUIState = new Map<string, SaleUIState>();

/**
 * DOM utility functions
 */
const $ = <T extends HTMLElement = HTMLElement>(
  sel: string,
  ctx: Document | HTMLElement = document
): T | null => ctx.querySelector(sel);

const escapeHtml = (value: any): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const uid = (): string => Math.random().toString(36).slice(2, 9);

const todayYMD = toYMD(new Date());

/**
 * Format percentage as a labeled string
 */
const formatPercentLabel = (decimal: number): string => {
  const num = Number(decimal) * 100;
  if (!Number.isFinite(num) || Math.abs(num) < 0.05) return '0%';
  const abs = Math.abs(num);
  const formatted = Math.abs(abs % 1) < 0.05 ? abs.toFixed(0) : abs.toFixed(1);
  const sign = num > 0 ? '+' : '-';
  return `${sign}${formatted}%`;
};

/**
 * Format money delta with sign
 */
const formatMoneyDelta = (delta: number): string => {
  const num = Number(delta);
  if (!Number.isFinite(num) || Math.abs(num) < 0.005) return '$0.00';
  const abs = fmtMoney(Math.abs(num));
  return num > 0 ? `+${abs}` : `-${abs}`;
};

/**
 * Format number delta with sign
 */
const formatNumberDelta = (delta: number): string => {
  const num = Number(delta);
  if (!Number.isFinite(num) || Math.abs(num) < 0.5) return '0';
  const rounded = Math.round(num);
  return rounded > 0 ? `+${rounded}` : String(rounded);
};

/**
 * Apply delta CSS class based on value and direction
 */
const applyDeltaClass = (
  el: HTMLElement | null,
  delta: number,
  options: { positiveIsGood?: boolean } = {}
): void => {
  if (!el) return;
  const { positiveIsGood = true } = options;
  let className = 'delta-neutral';
  const num = Number(delta);

  if (!Number.isFinite(num)) {
    const isPositive = delta === Number.POSITIVE_INFINITY;
    const isGood = isPositive ? positiveIsGood : !positiveIsGood;
    className = isGood ? 'delta-positive' : 'delta-negative';
  } else if (Math.abs(num) >= 0.005) {
    const isPositive = num > 0;
    const isGood = isPositive ? positiveIsGood : !positiveIsGood;
    className = isGood ? 'delta-positive' : 'delta-negative';
  }

  el.classList.remove('delta-positive', 'delta-negative', 'delta-neutral');
  el.classList.add(className);
};

/**
 * Describe name and category of an entry
 */
const describeNameAndCategory = (entry: any, fallback: string): string => {
  if (!entry || typeof entry !== 'object') return fallback;
  const parts: string[] = [];
  if (entry.name) parts.push(entry.name);
  if (entry.category) parts.push(entry.category);
  if (!parts.length && entry.note) parts.push(entry.note);
  return parts.join(' – ') || fallback;
};

/**
 * Get stream by ID from state
 */
const getStreamById = (state: AppState, id: string): any | null => {
  if (!state || !Array.isArray(state.incomeStreams)) return null;
  return (
    state.incomeStreams.find(
      (stream) => stream && typeof stream.id === 'string' && stream.id === id
    ) || null
  );
};

/**
 * Get base amount for a stream
 */
const getStreamBaseAmount = (stream: any): number => {
  if (!stream || typeof stream !== 'object') return 0;
  return Math.abs(Number(stream.amount || 0)) || 0;
};

/**
 * Create a new sale entry
 */
const createSaleEntry = (startDate: YMDString): SaleEntry => {
  const safeStart = isValidYMDString(startDate) ? startDate : todayYMD;
  return {
    id: uid(),
    name: '',
    pct: 0,
    topup: 0,
    startDate: safeStart,
    endDate: safeStart,
    businessDaysOnly: true,
    lastEdited: 'pct',
  };
};

/**
 * Create a draft from a sale entry
 */
const createSaleDraftFromEntry = (entry: SaleEntry): SaleDraft => ({
  name: typeof entry.name === 'string' ? entry.name : '',
  pct: String(Math.round((Number(entry.pct) || 0) * 100)),
  topup: Number.isFinite(Number(entry.topup)) ? Number(entry.topup).toFixed(2) : '0.00',
  startDate: entry.startDate || '',
  endDate: entry.endDate || '',
  businessDaysOnly: Boolean(entry.businessDaysOnly),
  lastEdited: entry.lastEdited === 'topup' ? 'topup' : 'pct',
});

/**
 * Ensure sale UI state exists
 */
const ensureSaleUIState = (entry: SaleEntry): SaleUIState | null => {
  if (!entry || typeof entry.id !== 'string') return null;
  let state = saleUIState.get(entry.id);
  if (!state) {
    state = { isEditing: false, draft: createSaleDraftFromEntry(entry) };
    saleUIState.set(entry.id, state);
  } else if (!state.isEditing) {
    state.draft = createSaleDraftFromEntry(entry);
  }
  return state;
};

/**
 * Schedule a What-If render using requestAnimationFrame
 */
export const scheduleWhatIfRender = (): void => {
  if (whatIfRenderPending) return;
  whatIfRenderPending = true;
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(cb, 0);
  raf(() => {
    whatIfRenderPending = false;
    renderWhatIf();
  });
};

/**
 * Ensure stream tweak exists for a given stream ID
 */
const ensureWhatIfStreamTweak = (
  scenario: WhatIfState,
  streamId: string
): StreamTweak => {
  if (!scenario.tweaks || typeof scenario.tweaks !== 'object') {
    scenario.tweaks = {
      global: { pct: 0, delta: 0, lastEdited: 'pct' },
      streams: {},
      sale: { enabled: false, entries: [] },
      startDate: '',
      endDate: '',
    };
  }
  if (!scenario.tweaks.streams || typeof scenario.tweaks.streams !== 'object') {
    scenario.tweaks.streams = {};
  }
  if (!scenario.tweaks.streams[streamId]) {
    scenario.tweaks.streams[streamId] = {
      pct: 0,
      delta: 0,
      effective: null,
      weeklyTarget: null,
      lastEdited: 'pct',
    };
  }
  return scenario.tweaks.streams[streamId];
};

/**
 * Main rendering function for the What-If tab
 */
export const renderWhatIf = (
  actualState: AppState,
  whatIfState: WhatIfState,
  saveCallback: (state: WhatIfState) => void
): void => {
  const panel = $('#whatif');
  if (!panel) return;

  // Sanitize the scenario
  const prevKeys =
    whatIfState?.tweaks?.streams && typeof whatIfState.tweaks.streams === 'object'
      ? Object.keys(whatIfState.tweaks.streams)
      : [];
  const sanitized = sanitizeWhatIfState(whatIfState, actualState);
  const nextKeys =
    sanitized?.tweaks?.streams && typeof sanitized.tweaks.streams === 'object'
      ? Object.keys(sanitized.tweaks.streams)
      : [];
  if (nextKeys.length !== prevKeys.length) {
    saveCallback(sanitized);
  }

  const tweaks = sanitized.tweaks || {
    global: { pct: 0, delta: 0, lastEdited: 'pct' as const },
    streams: {},
    sale: { enabled: false, entries: [] },
    startDate: '',
    endDate: '',
  };
  const baseState = cloneStateForSandbox(sanitized.base);
  const baseSettings = baseState.settings || defaultState().settings;
  const startDate = isValidYMDString(tweaks.startDate)
    ? tweaks.startDate
    : baseSettings.startDate;
  let endDate = isValidYMDString(tweaks.endDate) ? tweaks.endDate : baseSettings.endDate;
  if (compareYMD(startDate, endDate) > 0) endDate = startDate;
  baseState.settings = { ...baseSettings, startDate, endDate };

  const globalTweaks: GlobalTweak = tweaks.global || {
    pct: 0,
    delta: 0,
    lastEdited: 'pct',
  };
  globalTweaks.pct = clampPercent(globalTweaks.pct, { min: -1, max: 2, fallback: 0 });
  globalTweaks.delta = clampCurrency(globalTweaks.delta, 0);
  if (!['pct', 'delta', 'effective'].includes(globalTweaks.lastEdited)) {
    globalTweaks.lastEdited = 'pct';
  }

  const streamTweaks = tweaks.streams || {};
  const saleTweaks = tweaks.sale || { enabled: false, entries: [] };

  // Validate sale tweaks
  let saleMutated = false;
  if (!Array.isArray(saleTweaks.entries)) {
    saleTweaks.entries = [];
    saleMutated = true;
  }
  const validSaleEntries: SaleEntry[] = [];
  for (const entry of saleTweaks.entries) {
    if (!entry || typeof entry !== 'object') {
      saleMutated = true;
      continue;
    }
    if (typeof entry.id !== 'string') {
      entry.id = uid();
      saleMutated = true;
    }
    const pct = clampPercent(entry.pct, { min: -1, max: 5, fallback: 0 });
    if (pct !== entry.pct) {
      entry.pct = pct;
      saleMutated = true;
    }
    const topup = clampCurrency(entry.topup, 0);
    if (topup !== entry.topup) {
      entry.topup = topup;
      saleMutated = true;
    }
    if (!isValidYMDString(entry.startDate)) {
      entry.startDate = startDate;
      saleMutated = true;
    }
    if (!isValidYMDString(entry.endDate)) {
      entry.endDate = entry.startDate;
      saleMutated = true;
    }
    if (compareYMD(entry.startDate, entry.endDate) > 0) {
      entry.endDate = entry.startDate;
      saleMutated = true;
    }
    entry.businessDaysOnly = Boolean(entry.businessDaysOnly);
    if (entry.lastEdited !== 'topup' && entry.lastEdited !== 'pct') {
      entry.lastEdited = 'pct';
      saleMutated = true;
    }
    const name =
      typeof entry.name === 'string' ? entry.name.trim().slice(0, 120) : '';
    if (name !== entry.name) {
      entry.name = name;
      saleMutated = true;
    }
    validSaleEntries.push(entry);
  }
  if (validSaleEntries.length !== saleTweaks.entries.length) {
    saleMutated = true;
  }
  saleTweaks.entries = validSaleEntries;
  if (saleTweaks.enabled && !saleTweaks.entries.length) {
    saleTweaks.entries.push(createSaleEntry(startDate));
    saleMutated = true;
  }
  if (saleMutated) {
    saveCallback(sanitized);
  }

  const actualProjection = computeProjection(actualState);

  // Build stream info
  const streamInfo: StreamDisplayInfo[] = [];
  const streamMap = new Map<
    string,
    { entry: StreamTweak; occurrences: number; stream: any }
  >();
  let mutated = false;

  for (const stream of baseState.incomeStreams) {
    if (!stream || typeof stream !== 'object') continue;
    if (typeof stream.id !== 'string') stream.id = uid();
    const streamId = stream.id;
    if (!streamTweaks[streamId]) {
      streamTweaks[streamId] = {
        pct: 0,
        delta: 0,
        effective: null,
        weeklyTarget: null,
        lastEdited: 'pct',
      };
      mutated = true;
    }
    const entry = streamTweaks[streamId];
    entry.pct = clampPercent(entry.pct, { min: -1, max: 2, fallback: 0 });
    entry.delta = clampCurrency(entry.delta, 0);
    if (!['pct', 'delta', 'effective', 'weekly'].includes(entry.lastEdited)) {
      entry.lastEdited = 'pct';
      mutated = true;
    }
    if (entry.lastEdited !== 'effective' && entry.effective !== null) {
      entry.effective = null;
      mutated = true;
    } else if (entry.lastEdited === 'effective' && entry.effective !== null) {
      entry.effective = round2(entry.effective);
    }
    if (entry.lastEdited !== 'weekly' && entry.weeklyTarget !== null) {
      entry.weeklyTarget = null;
      mutated = true;
    } else if (entry.lastEdited === 'weekly') {
      if (!Number.isFinite(Number(entry.weeklyTarget))) {
        entry.weeklyTarget = null;
        entry.lastEdited = 'pct';
        mutated = true;
      } else {
        entry.weeklyTarget = round2(entry.weeklyTarget!);
      }
    }
    const baseAmount = Math.abs(Number(stream.amount || 0));
    const occurrences = estimateOccurrencesPerWeek(stream);
    if (entry.lastEdited === 'weekly' && (!occurrences || occurrences <= 0)) {
      entry.lastEdited = 'pct';
      entry.weeklyTarget = null;
      mutated = true;
    }

    const baseAfterGlobal = computeEffectiveAmount(
      baseAmount,
      globalTweaks.pct,
      globalTweaks.delta
    );
    let finalAmount = baseAfterGlobal;
    if (
      entry.lastEdited === 'weekly' &&
      entry.weeklyTarget !== null &&
      occurrences > 0
    ) {
      finalAmount = round2(entry.weeklyTarget / occurrences);
    } else if (entry.lastEdited === 'effective' && entry.effective !== null) {
      finalAmount = round2(entry.effective);
    } else {
      finalAmount = computeEffectiveAmount(baseAfterGlobal, entry.pct, entry.delta);
    }

    streamInfo.push({
      id: streamId,
      stream,
      baseAmount,
      baseAfterGlobal,
      occurrences,
      entry,
      finalAmount,
    });
    streamMap.set(streamId, { entry, occurrences, stream });
  }

  if (mutated) {
    saveCallback(sanitized);
  }

  // Render date inputs
  const startInput = $<HTMLInputElement>('#whatifStartDate');
  if (startInput && document.activeElement !== startInput)
    startInput.value = startDate || '';
  const endInput = $<HTMLInputElement>('#whatifEndDate');
  if (endInput && document.activeElement !== endInput) endInput.value = endDate || '';

  // Render global tweaks
  const pctInput = $<HTMLInputElement>('#whatifGlobalPct');
  if (pctInput && document.activeElement !== pctInput)
    pctInput.value = String(Math.round(globalTweaks.pct * 100));
  const pctSlider = $<HTMLInputElement>('#whatifGlobalPctSlider');
  if (pctSlider && document.activeElement !== pctSlider)
    pctSlider.value = String(Math.round(globalTweaks.pct * 100));
  const deltaInput = $<HTMLInputElement>('#whatifGlobalDelta');
  if (deltaInput && document.activeElement !== deltaInput)
    deltaInput.value = String(round2(globalTweaks.delta));
  const globalEffective = computeEffectiveAmount(100, globalTweaks.pct, globalTweaks.delta);
  const effectiveInput = $<HTMLInputElement>('#whatifGlobalEffective');
  if (effectiveInput && document.activeElement !== effectiveInput)
    effectiveInput.value = globalEffective.toFixed(2);
  const globalSummary = $('#whatifGlobalSummary');
  if (globalSummary) {
    const pctLabel = formatPercentLabel(globalTweaks.pct);
    globalSummary.textContent = `Applied before per-stream tweaks · ${pctLabel} & ${formatMoneyDelta(
      globalTweaks.delta
    )} per occurrence · $100 → ${fmtMoney(globalEffective)}`;
  }

  // Render streams
  renderStreams(streamInfo);

  // Render sale configuration
  renderSaleConfiguration(saleTweaks, startDate);

  // Compute projections
  const whatIfProjection = computeProjection(
    baseState,
    buildWhatIfOverrides(baseState, tweaks)
  );

  // Render KPIs
  renderKPIs(actualProjection, whatIfProjection);

  // Render chart
  renderChart(actualProjection, whatIfProjection);

  // Render calendar
  renderCalendar(whatIfProjection, startDate);
};

/**
 * Render stream adjustment UI
 */
const renderStreams = (streamInfo: StreamDisplayInfo[]): void => {
  const streamContainer = $('#whatifStreams');
  if (!streamContainer) return;

  if (!streamInfo.length) {
    streamContainer.innerHTML =
      '<p class="whatif-streams-empty">No recurring income streams in sandbox.</p>';
  } else {
    streamContainer.innerHTML = streamInfo
      .map(({ id, stream, baseAmount, baseAfterGlobal, occurrences, entry, finalAmount }) => {
        const name = escapeHtml(describeNameAndCategory(stream, 'Income Stream'));
        const pctValue = String(Math.round(entry.pct * 100));
        const deltaValue = entry.delta.toFixed(2);
        const effectiveValue = finalAmount.toFixed(2);
        const weeklyValue =
          entry.lastEdited === 'weekly' && entry.weeklyTarget !== null
            ? entry.weeklyTarget.toFixed(2)
            : '';
        const weeklyDisabled = !occurrences || occurrences <= 0;
        const weeklyLabel =
          occurrences && occurrences > 0 ? `${round2(occurrences)} / week` : 'n/a';
        const isLocked = entry.lastEdited === 'effective' || entry.lastEdited === 'weekly';
        const lockIcon = isLocked ? '🔒' : '🔗';
        const lockTitle = isLocked
          ? 'Unlock to use %/$ tweaks'
          : 'Lock current effective amount';
        const baseLabel =
          baseAmount === baseAfterGlobal
            ? `Base: ${fmtMoney(baseAmount)}`
            : `Base: ${fmtMoney(baseAmount)} · Post-global: ${fmtMoney(baseAfterGlobal)}`;
        return `
<div class="whatif-stream" data-stream="${id}">
  <div class="whatif-stream-head">
    <div class="whatif-stream-title">
      <div class="stream-name">${name}</div>
      <div class="stream-base">${escapeHtml(baseLabel)}</div>
    </div>
    <button type="button" class="whatif-lock" data-role="toggleLock" title="${lockTitle}">
      <span aria-hidden="true">${lockIcon}</span>
    </button>
  </div>
  <div class="whatif-stream-body">
    <label class="whatif-field whatif-field-pct">
      <span>% tweak</span>
      <div class="whatif-percent-inputs">
        <input type="number" class="whatif-number" data-role="pctInput" min="-100" max="200" step="1" value="${escapeHtml(
          pctValue
        )}" />
        <input type="range" class="whatif-slider" data-role="pctSlider" min="-100" max="200" step="1" value="${escapeHtml(
          pctValue
        )}" />
      </div>
    </label>
    <label class="whatif-field">
      <span>$ tweak</span>
      <input type="number" class="whatif-number" data-role="deltaInput" step="0.01" value="${escapeHtml(
        deltaValue
      )}" />
    </label>
    <label class="whatif-field">
      <span>Effective per occurrence</span>
      <input type="number" class="whatif-number" data-role="effectiveInput" step="0.01" value="${escapeHtml(
        effectiveValue
      )}" />
    </label>
    <label class="whatif-field">
      <span>Weekly target <small>(${weeklyLabel})</small></span>
      <input type="number" class="whatif-number" data-role="weeklyInput" step="0.01" value="${escapeHtml(
        weeklyValue
      )}" ${
          weeklyDisabled ? 'disabled' : ''
        } placeholder="${weeklyDisabled ? 'Not available' : 'Target per week'}" />
    </label>
    <div class="whatif-stream-actions">
      <button type="button" class="link" data-role="resetStream">Reset</button>
    </div>
  </div>
</div>`;
      })
      .join('');
  }
};

/**
 * Render sale configuration UI
 */
const renderSaleConfiguration = (
  saleTweaks: { enabled: boolean; entries: SaleEntry[] },
  startDate: YMDString
): void => {
  const saleEnabledEl = $<HTMLInputElement>('#whatifSaleEnabled');
  if (saleEnabledEl) saleEnabledEl.checked = Boolean(saleTweaks.enabled);
  const saleOptions = $('#whatifSaleOptions');
  if (saleOptions) saleOptions.hidden = !saleTweaks.enabled;
  const addSaleBtn = $<HTMLButtonElement>('#whatifAddSaleBtn');
  if (addSaleBtn) addSaleBtn.disabled = !saleTweaks.enabled;
  const saleList = $('#whatifSaleList');
  if (saleList) {
    const activeIds = new Set<string>();
    const fragments: string[] = [];
    for (const [idx, entry] of saleTweaks.entries.entries()) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
      activeIds.add(entry.id);
      const state = ensureSaleUIState(entry);
      const draft = state?.draft || createSaleDraftFromEntry(entry);
      const pctValue = draft.pct ?? String(Math.round(entry.pct * 100));
      const topupValue = draft.topup ?? entry.topup.toFixed(2);
      const startValue = draft.startDate ?? entry.startDate ?? '';
      const endValue = draft.endDate ?? entry.endDate ?? '';
      const modeSource = state?.isEditing ? draft.lastEdited : entry.lastEdited;
      const modeText =
        modeSource === 'topup' ? 'Mode: $ top-up per day' : 'Mode: % uplift';
      const displayName =
        entry.name && entry.name.trim() ? entry.name.trim() : `Sale window ${idx + 1}`;
      const rangeLabel = entry.startDate
        ? entry.endDate && entry.endDate !== entry.startDate
          ? `${fmtDate(entry.startDate)} → ${fmtDate(entry.endDate)}`
          : fmtDate(entry.startDate)
        : '';
      const rangeLabelHtml = rangeLabel
        ? `<span class="whatif-sale-entry-range">${escapeHtml(rangeLabel)}</span>`
        : '';
      if (state?.isEditing) {
        fragments.push(`
<div class="whatif-sale-entry is-editing" data-sale-id="${entry.id}">
  <div class="whatif-sale-entry-head">
    <div class="whatif-sale-entry-title">
      <label class="whatif-fields whatif-sale-name">
        <span>Window name <small>(optional)</small></span>
        <input type="text" data-role="saleName" placeholder="e.g. Holiday promo" value="${escapeHtml(
          draft.name || ''
        )}" />
      </label>
    </div>
    <button type="button" class="link" data-role="removeSale">Delete</button>
  </div>
  <div class="whatif-sale-grid">
    <label class="whatif-fields">
      <span>% uplift</span>
      <input type="number" data-role="salePct" min="-100" max="500" step="1" value="${escapeHtml(
        String(pctValue)
      )}" />
    </label>
    <label class="whatif-fields">
      <span>$ top-up per day</span>
      <input type="number" data-role="saleTopup" step="0.01" value="${escapeHtml(
        String(topupValue)
      )}" />
    </label>
  </div>
  <div class="whatif-sale-mode-label">${escapeHtml(modeText)}</div>
  <div class="whatif-inline">
    <div class="whatif-fields">
      <label>Start</label>
      <input type="date" data-role="saleStart" value="${escapeHtml(startValue)}" />
    </div>
    <div class="whatif-fields">
      <label>End</label>
      <input type="date" data-role="saleEnd" value="${escapeHtml(endValue)}" />
    </div>
  </div>
  <label class="whatif-toggle">
    <input type="checkbox" data-role="saleBusiness" ${
      draft.businessDaysOnly ? 'checked' : ''
    } />
    Only apply on business days
  </label>
  <div class="whatif-sale-actions">
    <button type="button" class="btn" data-role="applySale">Apply</button>
  </div>
</div>`);
      } else {
        fragments.push(`
<div class="whatif-sale-entry is-collapsed" data-sale-id="${entry.id}"${
          rangeLabel ? ` title="${escapeHtml(rangeLabel)}"` : ''
        }>
  <div class="whatif-sale-entry-head">
    <div class="whatif-sale-entry-title"><span class="whatif-sale-entry-name">${escapeHtml(
      displayName
    )}</span>${rangeLabelHtml}</div>
    <div class="whatif-sale-entry-actions">
      <button type="button" class="link" data-role="editSale">Edit</button>
      <button type="button" class="link" data-role="removeSale">Delete</button>
    </div>
  </div>
</div>`);
      }
    }
    for (const id of Array.from(saleUIState.keys())) {
      if (!activeIds.has(id)) saleUIState.delete(id);
    }
    if (!fragments.length) {
      saleList.innerHTML =
        '<p class="whatif-sale-empty">No sale windows configured.</p>';
    } else {
      saleList.innerHTML = fragments.join('');
    }
  }
};

/**
 * Render KPIs comparing actual vs What-If
 */
const renderKPIs = (
  actualProjection: ProjectionResult,
  whatIfProjection: ProjectionResult
): void => {
  // End Balance
  const whatIfEndBalanceEl = $('#whatifEndBalance');
  if (whatIfEndBalanceEl)
    whatIfEndBalanceEl.textContent = fmtMoney(whatIfProjection.endBalance);
  const endActualEl = $('#whatifEndBalanceActual');
  if (endActualEl)
    endActualEl.textContent = `Actual: ${fmtMoney(actualProjection.endBalance)}`;
  const endDelta = whatIfProjection.endBalance - actualProjection.endBalance;
  const endDeltaEl = $('#whatifEndBalanceDelta');
  if (endDeltaEl) {
    endDeltaEl.textContent = formatMoneyDelta(endDelta);
    applyDeltaClass(endDeltaEl, endDelta, { positiveIsGood: true });
  }

  // Total Income
  const whatIfIncomeEl = $('#whatifTotalIncome');
  if (whatIfIncomeEl)
    whatIfIncomeEl.textContent = fmtMoney(whatIfProjection.totalIncome);
  const incomeActualEl = $('#whatifTotalIncomeActual');
  if (incomeActualEl)
    incomeActualEl.textContent = `Actual: ${fmtMoney(actualProjection.totalIncome)}`;

  // Weekly Income
  const whatIfWeeklyEl = $('#whatifWeeklyIncome');
  if (whatIfWeeklyEl)
    whatIfWeeklyEl.textContent = fmtMoney(whatIfProjection.projectedWeeklyIncome);
  const weeklyActualEl = $('#whatifWeeklyIncomeActual');
  if (weeklyActualEl)
    weeklyActualEl.textContent = `Actual: ${fmtMoney(
      actualProjection.projectedWeeklyIncome
    )}`;

  // Total Expenses
  const whatIfExpensesEl = $('#whatifTotalExpenses');
  if (whatIfExpensesEl)
    whatIfExpensesEl.textContent = fmtMoney(whatIfProjection.totalExpenses);
  const expensesActualEl = $('#whatifTotalExpensesActual');
  if (expensesActualEl)
    expensesActualEl.textContent = `Actual: ${fmtMoney(actualProjection.totalExpenses)}`;

  // Lowest Balance
  const whatIfLowestEl = $('#whatifLowestBalance');
  if (whatIfLowestEl)
    whatIfLowestEl.textContent = fmtMoney(whatIfProjection.lowestBalance);
  const lowestActualEl = $('#whatifLowestBalanceActual');
  if (lowestActualEl)
    lowestActualEl.textContent = `Actual: ${fmtMoney(actualProjection.lowestBalance)}`;
  const lowestDelta = whatIfProjection.lowestBalance - actualProjection.lowestBalance;
  const lowestDeltaEl = $('#whatifLowestBalanceDelta');
  if (lowestDeltaEl) {
    lowestDeltaEl.textContent = formatMoneyDelta(lowestDelta);
    applyDeltaClass(lowestDeltaEl, lowestDelta, { positiveIsGood: true });
  }

  // Peak Balance
  const whatIfPeakEl = $('#whatifPeakBalance');
  if (whatIfPeakEl) whatIfPeakEl.textContent = fmtMoney(whatIfProjection.peakBalance);
  const peakActualEl = $('#whatifPeakBalanceActual');
  if (peakActualEl)
    peakActualEl.textContent = `Actual: ${fmtMoney(actualProjection.peakBalance)}`;

  // Negative Days
  const whatIfNegDaysEl = $('#whatifNegativeDays');
  if (whatIfNegDaysEl)
    whatIfNegDaysEl.textContent = String(whatIfProjection.negativeDays);
  const negActualEl = $('#whatifNegativeDaysActual');
  if (negActualEl)
    negActualEl.textContent = `Actual: ${actualProjection.negativeDays}`;
  const negDeltaEl = $('#whatifNegativeDaysDelta');
  const negDelta = whatIfProjection.negativeDays - actualProjection.negativeDays;
  if (negDeltaEl) {
    negDeltaEl.textContent = formatNumberDelta(negDelta);
    applyDeltaClass(negDeltaEl, negDelta, { positiveIsGood: false });
  }

  // First Negative
  const firstNegativeEl = $('#whatifFirstNegative');
  if (firstNegativeEl)
    firstNegativeEl.textContent = whatIfProjection.firstNegativeDate
      ? fmtDate(whatIfProjection.firstNegativeDate)
      : '—';
  const firstActualEl = $('#whatifFirstNegativeActual');
  if (firstActualEl)
    firstActualEl.textContent = `Actual: ${
      actualProjection.firstNegativeDate
        ? fmtDate(actualProjection.firstNegativeDate)
        : '—'
    }`;
  const firstDeltaEl = $('#whatifFirstNegativeDelta');
  if (firstDeltaEl) {
    if (!whatIfProjection.firstNegativeDate && !actualProjection.firstNegativeDate) {
      firstDeltaEl.textContent = '—';
      firstDeltaEl.className = 'delta delta-neutral';
    } else if (!whatIfProjection.firstNegativeDate && actualProjection.firstNegativeDate) {
      firstDeltaEl.textContent = 'Cleared';
      firstDeltaEl.className = 'delta delta-positive';
    } else if (whatIfProjection.firstNegativeDate && !actualProjection.firstNegativeDate) {
      firstDeltaEl.textContent = 'New';
      firstDeltaEl.className = 'delta delta-negative';
    } else {
      const deltaDays =
        (fromYMD(whatIfProjection.firstNegativeDate!).getTime() -
          fromYMD(actualProjection.firstNegativeDate!).getTime()) /
        (1000 * 60 * 60 * 24);
      firstDeltaEl.textContent = formatNumberDelta(deltaDays);
      applyDeltaClass(firstDeltaEl, deltaDays, { positiveIsGood: true });
    }
  }
};

/**
 * Render the What-If comparison chart
 */
const renderChart = (
  actualProjection: ProjectionResult,
  whatIfProjection: ProjectionResult
): void => {
  const chartCanvas = $<HTMLCanvasElement>('#whatifChart');
  if (chartCanvas) {
    renderWhatIfChart(chartCanvas, actualProjection, whatIfProjection);
  }
};

/**
 * Render the calendar grid
 */
const renderCalendar = (projection: ProjectionResult, startDate: YMDString): void => {
  const calendarGrid = $('#whatifCalendar');
  if (!calendarGrid) return;

  const rows = (projection.cal || [])
    .filter((row) => compareYMD(row.date, startDate) >= 0)
    .slice(0, 30);

  if (!rows.length) {
    calendarGrid.classList.add('whatif-calendar-grid--empty');
    calendarGrid.innerHTML =
      '<div class="whatif-calendar-empty">No projection data available.</div>';
  } else {
    calendarGrid.classList.remove('whatif-calendar-grid--empty');
    calendarGrid.innerHTML = '';
    const rowMap = new Map(rows.map((row) => [row.date, row]));
    const activeStart = rows[0].date;
    const activeEnd = rows[rows.length - 1].date;
    const startDateObj = fromYMD(activeStart);
    const endDateObj = fromYMD(activeEnd);
    const calendarStart = new Date(startDateObj);
    calendarStart.setDate(calendarStart.getDate() - calendarStart.getDay());
    const calendarEnd = new Date(endDateObj);
    calendarEnd.setDate(calendarEnd.getDate() + (6 - calendarEnd.getDay()));

    const createMetric = (label: string, value: string, className = ''): HTMLElement => {
      const el = document.createElement('div');
      el.className = `whatif-calendar-metric ${className}`.trim();
      el.innerHTML = `<span>${label}</span><span>${value}</span>`;
      return el;
    };

    for (
      let cursor = new Date(calendarStart);
      cursor <= calendarEnd;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const ymd = toYMD(cursor);
      const row = rowMap.get(ymd);
      const isInRange =
        compareYMD(ymd, activeStart) >= 0 && compareYMD(ymd, activeEnd) <= 0;
      const cell = document.createElement('div');
      cell.className = 'whatif-calendar-cell';
      if (!isInRange) cell.classList.add('is-outside');
      if (!row && isInRange) cell.classList.add('no-data');

      const dateEl = document.createElement('div');
      dateEl.className = 'whatif-calendar-date';
      dateEl.textContent = fmtDate(ymd);
      cell.appendChild(dateEl);

      if (isInRange) {
        const income = row ? row.income : 0;
        const expenses = row ? row.expenses : 0;
        const net = row ? row.net : income - expenses;
        const running = row ? row.running : 0;

        const incomeMetric = createMetric('Income', fmtMoney(income), 'income');
        if (income > 0) incomeMetric.classList.add('positive');
        cell.appendChild(incomeMetric);

        const expenseMetric = createMetric('Expenses', fmtMoney(expenses), 'expenses');
        if (expenses > 0) expenseMetric.classList.add('negative');
        cell.appendChild(expenseMetric);

        const netMetric = createMetric('Net', fmtMoney(net), 'net');
        if (net > 0) netMetric.classList.add('positive');
        else if (net < 0) netMetric.classList.add('negative');
        cell.appendChild(netMetric);

        const runningMetric = createMetric('Running', fmtMoney(running), 'running');
        if (running > 0) runningMetric.classList.add('positive');
        else if (running < 0) runningMetric.classList.add('negative');
        cell.appendChild(runningMetric);
      }

      calendarGrid.appendChild(cell);
    }
  }
  const tableStartLabel = $('#whatifTableStart');
  if (tableStartLabel)
    tableStartLabel.textContent = startDate ? fmtDate(startDate) : '—';
};

/**
 * Event binding for the What-If tab
 */
export const bindWhatIf = (
  getState: () => AppState,
  getScenario: () => WhatIfState,
  setScenario: (scenario: WhatIfState) => void,
  saveCallback: (scenario: WhatIfState) => void
): void => {
  // Pull from actual
  $('#whatifPullBtn')?.addEventListener('click', () => {
    const state = getState();
    const newScenario = sanitizeWhatIfState({ base: state }, state);
    setScenario(newScenario);
    saveCallback(newScenario);
    scheduleWhatIfRender();
  });

  // Export scenario
  $('#whatifExportBtn')?.addEventListener('click', () => {
    const scenario = getScenario();
    const blob = new Blob([JSON.stringify(scenario, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cashflow-whatif.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import scenario
  const importDialog = $<HTMLDialogElement>('#whatifImportDialog');
  $('#whatifImportBtn')?.addEventListener('click', () => importDialog?.showModal());
  $('#confirmWhatifImportBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      const textarea = $<HTMLTextAreaElement>('#whatifImportText');
      if (!textarea) return;
      const payload = JSON.parse(textarea.value);
      const state = getState();
      const newScenario = sanitizeWhatIfState(payload, state);
      setScenario(newScenario);
      saveCallback(newScenario);
      importDialog?.close();
      scheduleWhatIfRender();
    } catch (err) {
      const message = err && (err as Error).message ? (err as Error).message : String(err);
      alert('Import failed: ' + message);
    }
  });
  importDialog?.addEventListener('close', () => {
    const field = $<HTMLTextAreaElement>('#whatifImportText');
    if (field) field.value = '';
  });

  // Date range controls
  const startInput = $<HTMLInputElement>('#whatifStartDate');
  startInput?.addEventListener('change', (e) => {
    const scenario = getScenario();
    const value = (e.target as HTMLInputElement).value;
    if (!isValidYMDString(value)) {
      (e.target as HTMLInputElement).value = scenario.tweaks.startDate || '';
      return;
    }
    scenario.tweaks.startDate = value;
    if (
      !isValidYMDString(scenario.tweaks.endDate) ||
      compareYMD(scenario.tweaks.startDate, scenario.tweaks.endDate) > 0
    ) {
      scenario.tweaks.endDate = scenario.tweaks.startDate;
    }
    saveCallback(scenario);
    scheduleWhatIfRender();
  });

  const endInput = $<HTMLInputElement>('#whatifEndDate');
  endInput?.addEventListener('change', (e) => {
    const scenario = getScenario();
    const value = (e.target as HTMLInputElement).value;
    if (!isValidYMDString(value)) {
      (e.target as HTMLInputElement).value = scenario.tweaks.endDate || '';
      return;
    }
    scenario.tweaks.endDate = value;
    if (
      isValidYMDString(scenario.tweaks.startDate) &&
      compareYMD(scenario.tweaks.startDate, scenario.tweaks.endDate) > 0
    ) {
      scenario.tweaks.startDate = scenario.tweaks.endDate;
    }
    saveCallback(scenario);
    scheduleWhatIfRender();
  });

  // Global percentage/delta adjustments
  const getGlobalTweaks = (): GlobalTweak => {
    const scenario = getScenario();
    if (!scenario.tweaks.global || typeof scenario.tweaks.global !== 'object') {
      scenario.tweaks.global = { pct: 0, delta: 0, lastEdited: 'pct' };
    }
    return scenario.tweaks.global;
  };

  const updateGlobalPct = (raw: string): void => {
    const scenario = getScenario();
    const value = clampPercent(Number(raw) / 100, {
      min: -1,
      max: 2,
      fallback: getGlobalTweaks().pct,
    });
    const global = getGlobalTweaks();
    global.pct = value;
    global.lastEdited = 'pct';
    saveCallback(scenario);
    scheduleWhatIfRender();
  };

  const pctNumber = $<HTMLInputElement>('#whatifGlobalPct');
  pctNumber?.addEventListener('input', (e) =>
    updateGlobalPct((e.target as HTMLInputElement).value)
  );
  const pctSlider = $<HTMLInputElement>('#whatifGlobalPctSlider');
  pctSlider?.addEventListener('input', (e) =>
    updateGlobalPct((e.target as HTMLInputElement).value)
  );

  const deltaInput = $<HTMLInputElement>('#whatifGlobalDelta');
  deltaInput?.addEventListener('change', (e) => {
    const scenario = getScenario();
    const global = getGlobalTweaks();
    const value = clampCurrency((e.target as HTMLInputElement).value, global.delta);
    global.delta = value;
    global.lastEdited = 'delta';
    saveCallback(scenario);
    scheduleWhatIfRender();
  });

  const effectiveInput = $<HTMLInputElement>('#whatifGlobalEffective');
  effectiveInput?.addEventListener('change', (e) => {
    const scenario = getScenario();
    const global = getGlobalTweaks();
    const value = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) {
      scheduleWhatIfRender();
      return;
    }
    const pct = clampPercent(global.pct, { min: -1, max: 2, fallback: 0 });
    global.pct = pct;
    global.delta = round2(value - 100 * (1 + pct));
    global.lastEdited = 'effective';
    saveCallback(scenario);
    scheduleWhatIfRender();
  });

  // Stream-level tweaks
  const streamContainer = $('#whatifStreams');
  const handleStreamValue = (event: Event): void => {
    const target = event.target as HTMLElement;
    const role = target?.getAttribute?.('data-role');
    if (!role) return;
    if (
      (role === 'effectiveInput' || role === 'weeklyInput') &&
      event.type !== 'change'
    )
      return;
    const wrapper = target.closest('[data-stream]') as HTMLElement;
    if (!wrapper) return;
    const streamId = wrapper.getAttribute('data-stream');
    if (!streamId) return;
    const scenario = getScenario();
    const entry = ensureWhatIfStreamTweak(scenario, streamId);
    const stream =
      getStreamById(scenario.base, streamId) || getStreamById(getState(), streamId);
    const global = getGlobalTweaks();
    let changed = false;
    if (role === 'pctInput' || role === 'pctSlider') {
      const pct = clampPercent(Number((target as HTMLInputElement).value) / 100, {
        min: -1,
        max: 2,
        fallback: entry.pct,
      });
      entry.pct = pct;
      entry.lastEdited = 'pct';
      entry.effective = null;
      entry.weeklyTarget = null;
      changed = true;
    } else if (role === 'deltaInput') {
      const delta = clampCurrency((target as HTMLInputElement).value, entry.delta);
      entry.delta = delta;
      entry.lastEdited = 'delta';
      entry.effective = null;
      entry.weeklyTarget = null;
      changed = true;
    } else if (role === 'effectiveInput') {
      const value = Number((target as HTMLInputElement).value);
      if (!Number.isFinite(value)) {
        scheduleWhatIfRender();
        return;
      }
      entry.effective = round2(value);
      entry.lastEdited = 'effective';
      entry.weeklyTarget = null;
      changed = true;
    } else if (role === 'weeklyInput') {
      const raw = (target as HTMLInputElement).value.trim();
      if (!raw) {
        entry.weeklyTarget = null;
        entry.lastEdited = 'pct';
      } else {
        const value = Number(raw);
        const occurrences = estimateOccurrencesPerWeek(stream || {});
        if (!Number.isFinite(value) || occurrences <= 0) {
          entry.weeklyTarget = null;
          entry.lastEdited = 'pct';
        } else {
          entry.weeklyTarget = round2(value);
          entry.lastEdited = 'weekly';
          entry.effective = null;
        }
      }
      changed = true;
    }
    if (changed) {
      saveCallback(scenario);
      scheduleWhatIfRender();
    }
  };
  streamContainer?.addEventListener('input', handleStreamValue);
  streamContainer?.addEventListener('change', handleStreamValue);

  const handleStreamClick = (event: Event): void => {
    const target = (event.target as HTMLElement).closest('[data-role]') as HTMLElement;
    if (!target) return;
    const role = target.getAttribute('data-role');
    const wrapper = target.closest('[data-stream]') as HTMLElement;
    if (!wrapper) return;
    const streamId = wrapper.getAttribute('data-stream');
    if (!streamId) return;
    const scenario = getScenario();
    const entry = ensureWhatIfStreamTweak(scenario, streamId);
    const stream =
      getStreamById(scenario.base, streamId) || getStreamById(getState(), streamId);
    const global = getGlobalTweaks();
    if (role === 'resetStream') {
      entry.pct = 0;
      entry.delta = 0;
      entry.effective = null;
      entry.weeklyTarget = null;
      entry.lastEdited = 'pct';
      saveCallback(scenario);
      scheduleWhatIfRender();
    } else if (role === 'toggleLock') {
      if (!stream) return;
      if (entry.lastEdited === 'effective' || entry.lastEdited === 'weekly') {
        entry.lastEdited = 'pct';
        entry.effective = null;
        entry.weeklyTarget = null;
      } else {
        const baseAmount = getStreamBaseAmount(stream);
        const amount = evaluateWhatIfStream(stream, entry, baseAmount, global);
        entry.effective = round2(amount);
        entry.weeklyTarget = null;
        entry.lastEdited = 'effective';
      }
      saveCallback(scenario);
      scheduleWhatIfRender();
    }
  };
  streamContainer?.addEventListener('click', handleStreamClick);

  // Sales entries management
  const getSaleTweaks = () => {
    const scenario = getScenario();
    if (!scenario.tweaks.sale || typeof scenario.tweaks.sale !== 'object') {
      scenario.tweaks.sale = { enabled: false, entries: [] };
    }
    if (!Array.isArray(scenario.tweaks.sale.entries)) {
      scenario.tweaks.sale.entries = [];
    }
    return scenario.tweaks.sale;
  };

  const getSaleDefaultStart = (): YMDString => {
    const scenario = getScenario();
    const sandboxStart = scenario.tweaks.startDate;
    if (isValidYMDString(sandboxStart)) return sandboxStart;
    const baseSettings = scenario.base?.settings || defaultState().settings;
    if (isValidYMDString(baseSettings.startDate)) return baseSettings.startDate;
    return todayYMD;
  };

  const saleEnabled = $<HTMLInputElement>('#whatifSaleEnabled');
  saleEnabled?.addEventListener('change', (e) => {
    const scenario = getScenario();
    const sale = getSaleTweaks();
    sale.enabled = Boolean((e.target as HTMLInputElement).checked);
    if (sale.enabled && !sale.entries.length) {
      const entry = createSaleEntry(getSaleDefaultStart());
      sale.entries.push(entry);
      saleUIState.set(entry.id, {
        isEditing: true,
        draft: createSaleDraftFromEntry(entry),
      });
    }
    saveCallback(scenario);
    scheduleWhatIfRender();
  });

  const addSaleBtn = $<HTMLButtonElement>('#whatifAddSaleBtn');
  addSaleBtn?.addEventListener('click', () => {
    const scenario = getScenario();
    const sale = getSaleTweaks();
    const entry = createSaleEntry(getSaleDefaultStart());
    sale.entries.push(entry);
    saleUIState.set(entry.id, {
      isEditing: true,
      draft: createSaleDraftFromEntry(entry),
    });
    saveCallback(scenario);
    scheduleWhatIfRender();
  });

  const saleList = $('#whatifSaleList');
  const handleSaleInput = (event: Event): void => {
    const target = event.target as HTMLElement;
    const role = target?.getAttribute?.('data-role');
    if (!role) return;
    if (role === 'salePct' || role === 'saleTopup' || role === 'saleName') {
      if (event.type !== 'input' && event.type !== 'change') return;
    } else if (event.type !== 'change') {
      return;
    }
    const wrapper = target.closest('[data-sale-id]') as HTMLElement;
    if (!wrapper) return;
    const id = wrapper.getAttribute('data-sale-id');
    if (!id) return;
    const state = saleUIState.get(id);
    if (!state || !state.isEditing) return;
    const draft = state.draft;
    if (!draft) return;
    if (role === 'salePct') {
      draft.pct = (target as HTMLInputElement).value;
      draft.lastEdited = 'pct';
      const label = wrapper.querySelector('.whatif-sale-mode-label');
      if (label) label.textContent = 'Mode: % uplift';
    } else if (role === 'saleTopup') {
      draft.topup = (target as HTMLInputElement).value;
      draft.lastEdited = 'topup';
      const label = wrapper.querySelector('.whatif-sale-mode-label');
      if (label) label.textContent = 'Mode: $ top-up per day';
    } else if (role === 'saleStart') {
      const value = (target as HTMLInputElement).value;
      if (!isValidYMDString(value)) {
        (target as HTMLInputElement).value = draft.startDate || '';
        return;
      }
      draft.startDate = value;
      if (
        isValidYMDString(draft.endDate) &&
        compareYMD(draft.startDate, draft.endDate) > 0
      ) {
        draft.endDate = draft.startDate;
        const endInput = wrapper.querySelector(
          "[data-role='saleEnd']"
        ) as HTMLInputElement;
        if (endInput) endInput.value = draft.endDate;
      }
    } else if (role === 'saleEnd') {
      const value = (target as HTMLInputElement).value;
      if (!isValidYMDString(value)) {
        (target as HTMLInputElement).value = draft.endDate || '';
        return;
      }
      draft.endDate = value;
      if (
        isValidYMDString(draft.startDate) &&
        compareYMD(draft.startDate, draft.endDate) > 0
      ) {
        draft.startDate = draft.endDate;
        const startInput = wrapper.querySelector(
          "[data-role='saleStart']"
        ) as HTMLInputElement;
        if (startInput) startInput.value = draft.startDate;
      }
    } else if (role === 'saleBusiness') {
      draft.businessDaysOnly = Boolean((target as HTMLInputElement).checked);
    } else if (role === 'saleName') {
      draft.name = (target as HTMLInputElement).value.slice(0, 120);
    }
  };
  saleList?.addEventListener('input', handleSaleInput);
  saleList?.addEventListener('change', handleSaleInput);
  saleList?.addEventListener('click', (event: Event) => {
    const control = (event.target as HTMLElement).closest(
      '[data-role]'
    ) as HTMLElement;
    if (!control) return;
    const role = control.getAttribute('data-role');
    if (!role) return;
    const wrapper = control.closest('[data-sale-id]') as HTMLElement;
    if (!wrapper) return;
    const id = wrapper.getAttribute('data-sale-id');
    if (!id) return;
    const scenario = getScenario();
    const sale = getSaleTweaks();
    if (role === 'removeSale') {
      sale.entries = sale.entries.filter((entry) => entry && entry.id !== id);
      saleUIState.delete(id);
      saveCallback(scenario);
      scheduleWhatIfRender();
    } else if (role === 'editSale') {
      const entry = sale.entries.find((item) => item && item.id === id);
      if (!entry) return;
      const state = ensureSaleUIState(entry);
      if (!state) return;
      state.isEditing = true;
      state.draft = createSaleDraftFromEntry(entry);
      scheduleWhatIfRender();
    } else if (role === 'applySale') {
      const entry = sale.entries.find((item) => item && item.id === id);
      const state = saleUIState.get(id);
      if (!entry || !state) return;
      const draft = state.draft || createSaleDraftFromEntry(entry);
      const pct = clampPercent(Number(draft.pct) / 100, {
        min: -1,
        max: 5,
        fallback: entry.pct,
      });
      const topup = clampCurrency(draft.topup, entry.topup);
      let startDate = isValidYMDString(draft.startDate)
        ? draft.startDate
        : entry.startDate;
      if (!isValidYMDString(startDate)) startDate = entry.startDate;
      let endDate = isValidYMDString(draft.endDate) ? draft.endDate : startDate;
      if (!isValidYMDString(endDate)) endDate = startDate;
      if (
        isValidYMDString(startDate) &&
        isValidYMDString(endDate) &&
        compareYMD(startDate, endDate) > 0
      ) {
        endDate = startDate;
      }
      entry.name = (draft.name || '').trim().slice(0, 120);
      entry.pct = pct;
      entry.topup = topup;
      entry.startDate = startDate;
      entry.endDate = endDate;
      entry.businessDaysOnly = Boolean(draft.businessDaysOnly);
      entry.lastEdited = draft.lastEdited === 'topup' ? 'topup' : 'pct';
      state.isEditing = false;
      state.draft = createSaleDraftFromEntry(entry);
      saveCallback(scenario);
      scheduleWhatIfRender();
    }
  });
};
