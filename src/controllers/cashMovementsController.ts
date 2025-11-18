/**
 * Cash Movements Controller
 * Handles the Cash Movements tab including one-off and recurring transactions
 */

import type {
  AppState,
  OneOffSortKey,
  OneOffSortState,
  SortDirection,
} from '../types';
import { fmtMoney, round2 } from '../modules/calculations';
import { compareYMD, todayYMD } from '../modules/dateUtils';
import { clamp } from '../modules/validation';
import {
  getNextOccurrence,
  normalizeNth,
  firstWeekday,
  toWeekdayArray,
} from '../modules/transactions';
import { detectDuplicateCashMovements } from '../modules/ar';

/**
 * Valid sort keys for one-off entries
 */
const ONE_OFF_SORT_KEYS: OneOffSortKey[] = ['date', 'schedule', 'type', 'name', 'category', 'next'];

/**
 * Day of week labels
 */
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Editing state - tracks the ID of the transaction being edited
 */
let editingOneOffId: string | null = null;

// ========== DOM UTILITIES ==========

/**
 * Query selector helper for single element
 */
function $(sel: string, ctx: Document | HTMLElement = document): HTMLElement | null {
  return ctx.querySelector(sel);
}

/**
 * Query selector helper for multiple elements
 */
function $$(sel: string, ctx: Document | HTMLElement = document): HTMLElement[] {
  return Array.from(ctx.querySelectorAll(sel));
}

/**
 * Generate unique ID
 */
function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

// ========== FORMATTING HELPERS ==========

/**
 * Format a count value with locale formatting
 */
function fmtCount(value: number): string {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}

/**
 * Compare two text values case-insensitively
 */
function compareText(a: unknown, b: unknown): number {
  const aStr = String(a ?? '');
  const bStr = String(b ?? '');
  return (
    aStr.localeCompare(bStr, undefined, { sensitivity: 'base' }) ||
    aStr.localeCompare(bStr)
  );
}

/**
 * Get day of week label from numeric index
 */
function getDOWLabel(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return DOW_LABELS[0];
  const idx = ((n % 7) + 7) % 7;
  return DOW_LABELS[idx] ?? DOW_LABELS[0];
}

/**
 * Format ordinal suffix for numbers (1st, 2nd, 3rd, etc.)
 */
function ordinal(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1:
      return `${num}st`;
    case 2:
      return `${num}nd`;
    case 3:
      return `${num}rd`;
    default:
      return `${num}th`;
  }
}

/**
 * Describe nth occurrence (1st, 2nd, last, etc.)
 */
function describeNth(nth: unknown): string {
  const n = normalizeNth(nth);
  return n === 'last' ? 'last' : ordinal(Number(n));
}

/**
 * Read selected weekdays from a multi-select element
 */
function readWeekdaySelections(selectEl: HTMLSelectElement | null): number[] {
  if (!selectEl) return [];
  const values = Array.from(selectEl.selectedOptions || []).map((opt) => opt.value);
  return toWeekdayArray(values);
}

/**
 * Populate weekday selections in a multi-select element
 */
function populateWeekdaySelections(selectEl: HTMLSelectElement | null, values: unknown): void {
  if (!selectEl) return;
  const normalized = toWeekdayArray(values);
  const lookup = new Set(normalized.map((value) => String(value)));
  const options = Array.from(selectEl.options || []);
  if (!lookup.size) {
    options.forEach((option) => {
      option.selected = option.defaultSelected;
    });
    return;
  }
  options.forEach((option) => {
    option.selected = lookup.has(option.value);
  });
}

// ========== SCHEDULE DESCRIPTION HELPERS ==========

/**
 * Describe a monthly schedule configuration
 */
export function describeMonthlySchedule(item: any): string {
  if (!item || typeof item !== 'object') return 'Monthly';
  if (item.monthlyMode === 'nth') {
    const nth = normalizeNth(item.nthWeek);
    const nthLabel = describeNth(nth);
    const weekday = firstWeekday(item.nthWeekday ?? item.dayOfWeek ?? 0, 0);
    return `Monthly on the ${nthLabel} ${getDOWLabel(weekday)}`;
  }
  const day = clamp(Number(item.dayOfMonth ?? 1), 1, 31);
  return `Monthly on day ${day}`;
}

/**
 * Describe the schedule for a transaction (one-off or recurring)
 */
export function describeTransactionSchedule(tx: any): string {
  if (!tx || typeof tx !== 'object') return '—';

  const repeats = Boolean(tx.repeats ?? tx.recurring ?? tx.frequency);
  if (!repeats) return '—';

  const frequency = tx.frequency;
  if (!frequency) return 'Repeats';

  const start = tx.startDate || tx.date || null;
  const end = tx.endDate || tx.date || null;
  const range = start && end ? ` (${start} → ${end})` : '';

  let desc = '';
  switch (frequency) {
    case 'daily':
      desc = `Daily${tx.skipWeekends ? ' (M–F)' : ''}${range}`;
      break;
    case 'weekly':
      desc = `Weekly on ${getDOWLabel(tx.dayOfWeek)}${range}`;
      break;
    case 'biweekly':
      desc = `Every 2 weeks on ${getDOWLabel(tx.dayOfWeek)}${range}`;
      break;
    case 'monthly': {
      const day = clamp(Number(tx.dayOfMonth ?? 1), 1, 31);
      desc = `Monthly on day ${day}${range}`;
      break;
    }
    case 'once': {
      const when = tx.onDate || tx.date || start;
      desc = when ? `On ${when}` : 'Once';
      break;
    }
    default:
      desc = `Repeats${range}`;
      break;
  }

  const extras = [];
  if (Array.isArray(tx.steps) && tx.steps.length) extras.push('stepped');
  const escalator = Number(tx.escalatorPct || 0);
  if (escalator) extras.push(`${escalator}% escalator`);
  if (extras.length) desc += ` [${extras.join(', ')}]`;

  return desc;
}

// ========== SORT STATE MANAGEMENT ==========

/**
 * Get the current one-off sort state from app state
 */
function getOneOffSortState(STATE: AppState): OneOffSortState {
  if (!STATE.ui || typeof STATE.ui !== 'object') {
    STATE.ui = {
      oneOffSort: { key: 'date', direction: 'asc' },
      expandedSort: { key: 'date', direction: 'asc' },
    };
    return STATE.ui.oneOffSort;
  }

  // Sanitize the sort state
  const current = STATE.ui.oneOffSort;
  if (!current || typeof current !== 'object') {
    STATE.ui.oneOffSort = { key: 'date', direction: 'asc' };
    return STATE.ui.oneOffSort;
  }

  const validKey = ONE_OFF_SORT_KEYS.includes(current.key) ? current.key : 'date';
  const validDirection: SortDirection = current.direction === 'desc' ? 'desc' : 'asc';

  if (current.key !== validKey || current.direction !== validDirection) {
    STATE.ui.oneOffSort = { key: validKey, direction: validDirection };
  }

  return STATE.ui.oneOffSort;
}

/**
 * Update the one-off sort state
 * @returns true if the state changed
 */
export function updateOneOffSortState(STATE: AppState, key: string): boolean {
  if (!key || !ONE_OFF_SORT_KEYS.includes(key as OneOffSortKey)) return false;

  const sortState = getOneOffSortState(STATE);
  const prevKey = sortState.key;
  let changed = false;

  if (prevKey === key) {
    const nextDirection: SortDirection = sortState.direction === 'asc' ? 'desc' : 'asc';
    if (nextDirection !== sortState.direction) {
      sortState.direction = nextDirection;
      changed = true;
    }
  } else {
    sortState.key = key as OneOffSortKey;
    sortState.direction = 'asc';
    changed = true;
  }

  return changed;
}

/**
 * Compare two one-off table rows by a specific key
 */
export function compareOneOffRows(a: any, b: any, key: OneOffSortKey): number {
  switch (key) {
    case 'date':
      return compareYMD(
        (a.tx as any)?.date || (a.tx as any)?.startDate,
        (b.tx as any)?.date || (b.tx as any)?.startDate
      );
    case 'schedule':
      return compareText(a.schedule, b.schedule);
    case 'type':
      return compareText(a.tx?.type, b.tx?.type);
    case 'name':
      return compareText(a.tx?.name, b.tx?.name);
    case 'category':
      return compareText(a.tx?.category, b.tx?.category);
    case 'next': {
      const nextA = a.next;
      const nextB = b.next;
      if (nextA && nextB) {
        const byDate = compareYMD(nextA.date, nextB.date);
        if (byDate) return byDate;
        const amtA = Number(nextA.amount);
        const amtB = Number(nextB.amount);
        const hasAmtA = Number.isFinite(amtA);
        const hasAmtB = Number.isFinite(amtB);
        if (hasAmtA && hasAmtB) {
          if (amtA === amtB) return 0;
          return amtA < amtB ? -1 : 1;
        }
        if (hasAmtA) return -1;
        if (hasAmtB) return 1;
        return 0;
      }
      if (nextA) return -1;
      if (nextB) return 1;
      return 0;
    }
    default:
      return 0;
  }
}

/**
 * Update sort indicators in the table header
 */
export function updateOneOffSortIndicators(STATE: AppState): void {
  const { key, direction } = getOneOffSortState(STATE);
  $$('#oneOffTable thead th[data-sort]').forEach((th) => {
    if (th.dataset.sort === key) {
      th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  });
}

// ========== RENDERING ==========

/**
 * Render the one-off transactions table
 */
export function renderOneOffs(STATE: AppState): void {
  const tbody = $('#oneOffTable tbody') as HTMLTableSectionElement | null;
  if (!tbody) return;

  tbody.innerHTML = '';

  const rows = [...(STATE.oneOffs || [])]
    .filter((tx) => tx && typeof tx === 'object')
    .map((tx) => ({
      tx,
      schedule: describeTransactionSchedule(tx),
      next: getNextOccurrence(tx, todayYMD),
    }));

  const sortState = getOneOffSortState(STATE);
  const direction = sortState.direction === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const primary = compareOneOffRows(a, b, sortState.key);
    if (primary) return primary * direction;
    const fallbackDate = compareYMD(
      (a.tx as any).date || (a.tx as any).startDate,
      (b.tx as any).date || (b.tx as any).startDate
    );
    if (fallbackDate) return fallbackDate * direction;
    return compareText(a.tx?.name, b.tx?.name) * direction;
  });

  for (const row of rows) {
    const { tx, schedule, next } = row;
    const nextLabel = next ? `${fmtMoney(next.amount)} (${next.date})` : '—';
    const tr = document.createElement('tr');
    const displayDate = (tx as any).date || (tx as any).startDate || '';
    tr.innerHTML = `
      <td>${displayDate}</td>
      <td>${schedule}</td>
      <td>${tx.type || ''}</td>
      <td>${tx.name || ''}</td>
      <td>${tx.category || ''}</td>
      <td class="num">${nextLabel}</td>
      <td>
        <button class="link" data-id="${tx.id}" data-act="editOneOff">Edit</button>
        <span aria-hidden="true">·</span>
        <button class="link" data-id="${tx.id}" data-act="delOneOff">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  updateOneOffSortIndicators(STATE);
}

// ========== FORM VISIBILITY HELPERS ==========

/**
 * Apply visibility for monthly mode (day vs nth weekday)
 */
export function applyMonthlyModeVisibility(select: HTMLSelectElement | null): void {
  if (!select) return;
  const form = select.closest('form');
  if (!form) return;
  const mode = select.value === 'nth' ? 'nth' : 'day';
  form.querySelectorAll('.monthly-mode').forEach((el) => el.classList.add('hidden'));
  form
    .querySelectorAll(`.monthly-mode-${mode}`)
    .forEach((el) => el.classList.remove('hidden'));
}

/**
 * Show/hide transaction frequency-specific form blocks
 */
export function showTransactionFreqBlocks(): void {
  const form = $('#oneOffForm') as HTMLFormElement | null;
  if (!form) return;

  const repeatsToggle = $('#ooRepeats') as HTMLInputElement | null;
  const repeats = repeatsToggle?.checked ?? false;

  const recurringFields = $$('.tx-recurring-only', form);
  const freqFields = $$('.tx-freq-only', form);

  if (!repeats) {
    recurringFields.forEach((el) => el.classList.add('hidden'));
    freqFields.forEach((el) => el.classList.add('hidden'));
    return;
  }

  recurringFields.forEach((el) => el.classList.remove('hidden'));
  freqFields.forEach((el) => el.classList.add('hidden'));

  const freqSelect = $('#ooFreq') as HTMLSelectElement | null;
  const freq = freqSelect?.value || '';
  $$('.tx-freq-' + freq, form).forEach((el) => el.classList.remove('hidden'));

  if (freq === 'monthly') {
    const monthlyModeSelect = $('#ooMonthlyMode') as HTMLSelectElement | null;
    applyMonthlyModeVisibility(monthlyModeSelect);
  }

  const dateInput = $('#ooDate') as HTMLInputElement | null;
  const baseDate = dateInput?.value || '';
  if (baseDate) {
    const startInput = $('#ooStart') as HTMLInputElement | null;
    const endInput = $('#ooEnd') as HTMLInputElement | null;
    if (startInput && !startInput.value) startInput.value = baseDate;
    if (endInput && !endInput.value) endInput.value = baseDate;
  }
}

// ========== STEP EDITOR FUNCTIONS ==========

/**
 * Add a step row to the step editor table
 */
export function addStepRow(root: HTMLElement | null, data: any = {}): void {
  if (!root) return;
  const tbody = root.querySelector('tbody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.className = 'step-row';
  const effectiveFrom = typeof data.effectiveFrom === 'string' ? data.effectiveFrom : '';
  const amountValue = data.amount !== undefined && data.amount !== null ? Number(data.amount) : '';

  tr.innerHTML = `
    <td><input type="date" class="step-date" value="${effectiveFrom}" /></td>
    <td class="num"><input type="number" class="step-amount" step="0.01" value="${amountValue === '' ? '' : amountValue}" /></td>
    <td><button type="button" class="link" data-act="removeStep">Remove</button></td>
  `;
  tbody.appendChild(tr);
}

/**
 * Collect step data from step editor table
 */
export function collectStepRows(root: HTMLElement | null): any[] {
  if (!root) return [];
  const rows = $$('.step-row', root);
  return rows
    .map((row) => {
      const dateInput = $('.step-date', row) as HTMLInputElement | null;
      const amountInput = $('.step-amount', row) as HTMLInputElement | null;
      const date = dateInput?.value;
      const amountRaw = amountInput?.value;
      if (!date || amountRaw === undefined || amountRaw === null || amountRaw === '') return null;
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount)) return null;
      return { effectiveFrom: date, amount: Math.abs(amount) };
    })
    .filter((step) => step !== null)
    .sort((a, b) => compareYMD(a!.effectiveFrom, b!.effectiveFrom));
}

/**
 * Clear all step rows from the step editor
 */
export function clearStepRows(root: HTMLElement | null): void {
  if (!root) return;
  const tbody = root.querySelector('tbody');
  if (tbody) tbody.innerHTML = '';
}

/**
 * Initialize the step editor with event handlers
 */
export function initStepEditor(root: HTMLElement | null): void {
  if (!root) return;
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const removeBtn = target.closest("button[data-act='removeStep']") as HTMLButtonElement | null;
    if (removeBtn) {
      removeBtn.closest('.step-row')?.remove();
      return;
    }
    const addBtn = target.closest("button[data-act='addStep']") as HTMLButtonElement | null;
    if (addBtn) {
      addStepRow(root);
    }
  });
}

// ========== FORM MANAGEMENT ==========

/**
 * Update form UI based on editing state
 */
function updateOneOffFormEditingState(): void {
  const submitBtn = $('#ooSubmitBtn');
  const cancelBtn = $('#ooCancelEdit');
  if (!submitBtn || !cancelBtn) return;

  if (editingOneOffId) {
    submitBtn.textContent = 'Save Changes';
    cancelBtn.classList.remove('hidden');
  } else {
    submitBtn.textContent = 'Add';
    cancelBtn.classList.add('hidden');
  }
}

/**
 * Reset the one-off form to initial state
 */
export function resetOneOffForm(): void {
  const form = $('#oneOffForm') as HTMLFormElement | null;
  if (!form) return;

  form.reset();
  editingOneOffId = null;

  const stepEditor = $('#ooStepEditor');
  clearStepRows(stepEditor);

  const escalatorInput = $('#ooEscalator') as HTMLInputElement | null;
  if (escalatorInput) escalatorInput.value = '';

  showTransactionFreqBlocks();
  updateOneOffFormEditingState();
}

/**
 * Populate the form with transaction data for editing
 */
export function populateOneOffForm(STATE: AppState, id: string): void {
  const form = $('#oneOffForm') as HTMLFormElement | null;
  if (!form) return;

  const tx = (STATE.oneOffs || []).find((item) => item && item.id === id);
  if (!tx) return;

  editingOneOffId = tx.id;

  const dateInput = $('#ooDate') as HTMLInputElement | null;
  if (dateInput) dateInput.value = (tx as any).date || (tx as any).startDate || '';

  const typeInput = $('#ooType') as HTMLSelectElement | null;
  if (typeInput) typeInput.value = tx.type || 'expense';

  const nameInput = $('#ooName') as HTMLInputElement | null;
  if (nameInput) nameInput.value = tx.name || '';

  const categoryInput = $('#ooCategory') as HTMLInputElement | null;
  if (categoryInput) categoryInput.value = tx.category || '';

  const amountInput = $('#ooAmount') as HTMLInputElement | null;
  if (amountInput) amountInput.value = String(tx.amount ?? '');

  const repeatsToggle = $('#ooRepeats') as HTMLInputElement | null;
  const isRecurring = Boolean((tx as any).repeats || tx.recurring);
  if (repeatsToggle) repeatsToggle.checked = isRecurring;

  if (tx.recurring) {
    const freqSelect = $('#ooFreq') as HTMLSelectElement | null;
    if (freqSelect) freqSelect.value = tx.frequency || 'monthly';

    const startInput = $('#ooStart') as HTMLInputElement | null;
    if (startInput) startInput.value = tx.startDate || '';

    const endInput = $('#ooEnd') as HTMLInputElement | null;
    if (endInput) endInput.value = tx.endDate || '';

    const skipWeekends = $('#ooSkipWeekends') as HTMLInputElement | null;
    if (skipWeekends) skipWeekends.checked = Boolean(tx.skipWeekends);

    const monthlyModeSel = $('#ooMonthlyMode') as HTMLSelectElement | null;
    if (monthlyModeSel) {
      monthlyModeSel.value = tx.monthlyMode === 'nth' ? 'nth' : 'day';
    }

    showTransactionFreqBlocks();

    const dowSelect = $('#ooDOW') as HTMLSelectElement | null;
    populateWeekdaySelections(dowSelect, tx.dayOfWeek || []);

    const monthlyMode = monthlyModeSel ? monthlyModeSel.value : 'day';
    if (monthlyMode === 'nth') {
      const nthWeekSel = $('#ooNthWeek') as HTMLSelectElement | null;
      if (nthWeekSel) nthWeekSel.value = normalizeNth(tx.nthWeek);
      const nthWeekdaySel = $('#ooNthWeekday') as HTMLSelectElement | null;
      if (nthWeekdaySel) {
        const normalizedDOW = clamp(Number(tx.nthWeekday ?? 0), 0, 6);
        nthWeekdaySel.value = String(normalizedDOW);
      }
    } else {
      const domInput = $('#ooDOM') as HTMLInputElement | null;
      if (domInput) {
        const domValue = clamp(Number(tx.dayOfMonth || domInput.value || 1), 1, 31);
        domInput.value = String(domValue);
      }
    }

    const stepEditor = $('#ooStepEditor');
    clearStepRows(stepEditor);
    if (stepEditor && Array.isArray(tx.steps) && tx.steps.length) {
      tx.steps.forEach((step) => addStepRow(stepEditor, step));
    }

    const escalatorInput = $('#ooEscalator') as HTMLInputElement | null;
    if (escalatorInput) {
      const esc = Number(tx.escalatorPct);
      escalatorInput.value = Number.isFinite(esc) && esc !== 0 ? String(esc) : '';
    }
  } else {
    showTransactionFreqBlocks();
  }

  updateOneOffFormEditingState();
  dateInput?.focus?.();
}

// ========== EVENT BINDING ==========

/**
 * Bind all event handlers for the one-off transactions form and table
 */
export function bindOneOffs(
  STATE: AppState,
  saveState: (state: AppState) => void,
  recalcAndRender: () => void
): void {
  const form = $('#oneOffForm') as HTMLFormElement | null;
  const freqSel = $('#ooFreq') as HTMLSelectElement | null;
  const repeatsToggle = $('#ooRepeats') as HTMLInputElement | null;
  if (!form || !freqSel || !repeatsToggle) return;

  initStepEditor($('#ooStepEditor'));

  resetOneOffForm();

  repeatsToggle.addEventListener('change', showTransactionFreqBlocks);
  freqSel.addEventListener('change', showTransactionFreqBlocks);

  const monthlyModeSelect = $('#ooMonthlyMode') as HTMLSelectElement | null;
  monthlyModeSelect?.addEventListener('change', (e) => {
    applyMonthlyModeVisibility(e.target as HTMLSelectElement);
  });

  const cancelBtn = $('#ooCancelEdit');
  cancelBtn?.addEventListener('click', () => {
    resetOneOffForm();
  });

  const dateInput = $('#ooDate') as HTMLInputElement | null;
  dateInput?.addEventListener('change', () => {
    if (!repeatsToggle.checked) return;
    const baseDate = dateInput.value;
    if (!baseDate) return;
    const startInput = $('#ooStart') as HTMLInputElement | null;
    const endInput = $('#ooEnd') as HTMLInputElement | null;
    if (startInput && !startInput.value) startInput.value = baseDate;
    if (endInput && !endInput.value) endInput.value = baseDate;
  });

  showTransactionFreqBlocks();

  // Dedupe button handler
  const dedupeBtn = $('#dedupeCashBtn');
  dedupeBtn?.addEventListener('click', () => {
    const { removal } = detectDuplicateCashMovements(STATE.oneOffs || []);
    const removalCount = Array.isArray(removal) ? removal.length : 0;
    if (!removalCount) {
      alert('No duplicate AR invoices detected.');
      return;
    }
    const confirmMessage = `Remove ${fmtCount(removalCount)} duplicate ${removalCount === 1 ? 'entry' : 'entries'}?`;
    if (!window.confirm(confirmMessage)) return;

    const removalSet = new Set(removal);
    STATE.oneOffs = (STATE.oneOffs || []).filter((entry) => !removalSet.has(entry));
    saveState(STATE);
    recalcAndRender();
    alert(`${fmtCount(removalCount)} duplicate ${removalCount === 1 ? 'entry' : 'entries'} removed.`);
  });

  // Form submit handler
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const editingId = editingOneOffId;
    const isEditing = Boolean(editingId);
    const repeats = repeatsToggle.checked;
    const date = (($('#ooDate') as HTMLInputElement | null)?.value || '');
    const type = (($('#ooType') as HTMLSelectElement | null)?.value || 'expense');
    const name = (($('#ooName') as HTMLInputElement | null)?.value || '').trim();
    const category = (($('#ooCategory') as HTMLInputElement | null)?.value || '').trim();
    const amountRaw = Number(($('#ooAmount') as HTMLInputElement | null)?.value || 0);
    if (!date || !name || Number.isNaN(amountRaw)) return;

    const entry: any = {
      id: isEditing ? editingId : uid(),
      date,
      type,
      name,
      category,
      amount: type === 'expense' ? Math.abs(amountRaw) : round2(amountRaw),
    };

    if (repeats) {
      const frequency = (($('#ooFreq') as HTMLSelectElement | null)?.value || '');
      const startDate = (($('#ooStart') as HTMLInputElement | null)?.value || '');
      const endDate = (($('#ooEnd') as HTMLInputElement | null)?.value || '');
      if (!frequency || !startDate || !endDate) return;

      entry.repeats = true;
      entry.recurring = true;
      entry.frequency = frequency;
      entry.startDate = startDate;
      entry.endDate = endDate;
      entry.skipWeekends = ($('#ooSkipWeekends') as HTMLInputElement | null)?.checked ?? false;

      if (frequency === 'weekly' || frequency === 'biweekly') {
        const weekdays = readWeekdaySelections($('#ooDOW') as HTMLSelectElement | null);
        if (!weekdays.length) return;
        entry.dayOfWeek = weekdays;
      }
      if (frequency === 'monthly') {
        const modeSel = $('#ooMonthlyMode') as HTMLSelectElement | null;
        const mode = modeSel && modeSel.value === 'nth' ? 'nth' : 'day';
        entry.monthlyMode = mode;
        if (mode === 'nth') {
          entry.nthWeek = normalizeNth(($('#ooNthWeek') as HTMLSelectElement | null)?.value);
          entry.nthWeekday = clamp(Number(($('#ooNthWeekday') as HTMLSelectElement | null)?.value || 0), 0, 6);
        } else {
          entry.dayOfMonth = clamp(Number(($('#ooDOM') as HTMLInputElement | null)?.value || 1), 1, 31);
        }
      }

      entry.steps = collectStepRows($('#ooStepEditor'));
      const escalatorRaw = Number(($('#ooEscalator') as HTMLInputElement | null)?.value || 0);
      entry.escalatorPct = Number.isFinite(escalatorRaw) ? escalatorRaw : 0;
    } else {
      entry.steps = [];
      entry.escalatorPct = 0;
    }

    if (isEditing) {
      const idx = STATE.oneOffs.findIndex((tx) => tx && tx.id === editingId);
      if (idx >= 0) {
        const prev = STATE.oneOffs[idx];
        if (prev && typeof prev === 'object') {
          // Preserve AR-related fields
          if ((prev as any).source) entry.source = (prev as any).source;
          if ((prev as any).sourceKey) entry.sourceKey = (prev as any).sourceKey;
          if ((prev as any).status) entry.status = (prev as any).status;
          if ((prev as any).lastSeenAt) entry.lastSeenAt = (prev as any).lastSeenAt;
          if ((prev as any).company) entry.company = (prev as any).company;
          if ((prev as any).invoice) entry.invoice = (prev as any).invoice;
          if ((prev as any).dueDate) entry.dueDate = (prev as any).dueDate;
          if ((prev as any).confidencePct !== undefined) entry.confidencePct = (prev as any).confidencePct;
        }
        STATE.oneOffs[idx] = entry;
      } else {
        STATE.oneOffs.push(entry);
      }
    } else {
      STATE.oneOffs.push(entry);
    }

    saveState(STATE);
    resetOneOffForm();
    recalcAndRender();
  });

  // Table click handlers (edit/delete)
  const table = $('#oneOffTable');
  table?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('button[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (!id) return;

    if (act === 'delOneOff') {
      STATE.oneOffs = STATE.oneOffs.filter((t) => t.id !== id);
      if (editingOneOffId === id) {
        resetOneOffForm();
      }
      saveState(STATE);
      recalcAndRender();
    } else if (act === 'editOneOff') {
      populateOneOffForm(STATE, id);
    }
  });

  // Table header sort handlers
  const tableHead = $('#oneOffTable thead');
  const requestSort = (key: string) => {
    if (!updateOneOffSortState(STATE, key)) return;
    saveState(STATE);
    renderOneOffs(STATE);
  };

  tableHead?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const th = target.closest('th[data-sort]') as HTMLElement | null;
    if (!th) return;
    const sortKey = th.dataset.sort;
    if (sortKey) requestSort(sortKey);
  });

  tableHead?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement;
    const th = target.closest('th[data-sort]') as HTMLElement | null;
    if (!th) return;
    event.preventDefault();
    const sortKey = th.dataset.sort;
    if (sortKey) requestSort(sortKey);
  });
}
