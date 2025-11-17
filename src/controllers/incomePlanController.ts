/**
 * Income Plan Controller
 * Handles the Income Plan tab for managing recurring income streams
 */

import type { IncomeStream, YMDString, Step } from '../types';
import { fmtMoney } from '../modules/calculations';
import { clamp } from '../modules/validation';
import { getNextOccurrence, normalizeNth, firstWeekday } from '../modules/transactions';

/**
 * Utility functions
 */
function $(sel: string, ctx: Document | HTMLElement = document): HTMLElement | null {
  return ctx.querySelector(sel);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Read weekday selections from checkboxes
 */
function readWeekdaySelections(container: HTMLElement | null): number[] {
  if (!container) return [];
  const checks = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  return Array.from(checks)
    .map((ch) => Number(ch.value))
    .filter((v) => !isNaN(v) && v >= 0 && v <= 6);
}

/**
 * Get day of week label
 */
function getDOWLabel(dow: number | number[]): string {
  const labels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (Array.isArray(dow)) {
    return dow.map((d) => labels[d] || '?').join(', ');
  }
  return labels[dow] || '?';
}

/**
 * Describe transaction schedule
 */
function describeTransactionSchedule(stream: IncomeStream): string {
  if (!stream || typeof stream !== 'object') return '—';

  const frequency = stream.frequency;
  if (!frequency) return 'Repeats';

  const start = stream.startDate || null;
  const end = stream.endDate || null;
  const range = start && end ? ` (${start} → ${end})` : '';

  let desc = '';
  switch (frequency) {
    case 'daily':
      desc = `Daily${stream.skipWeekends ? ' (M–F)' : ''}${range}`;
      break;
    case 'weekly':
      desc = `Weekly on ${getDOWLabel(stream.dayOfWeek || [])}${range}`;
      break;
    case 'biweekly':
      desc = `Every 2 weeks on ${getDOWLabel(stream.dayOfWeek || [])}${range}`;
      break;
    case 'monthly': {
      if (stream.monthlyMode === 'nth') {
        const nthLabel = describeNth(stream.nthWeek || '1');
        const weekday = getDOWLabel(stream.nthWeekday || 0);
        desc = `Monthly on the ${nthLabel} ${weekday}${range}`;
      } else {
        const day = clamp(Number(stream.dayOfMonth ?? 1), 1, 31);
        desc = `Monthly on day ${day}${range}`;
      }
      break;
    }
    case 'once': {
      const when = stream.onDate || start;
      desc = when ? `On ${when}` : 'Once';
      break;
    }
    default:
      desc = `Repeats${range}`;
      break;
  }

  const extras = [];
  if (Array.isArray(stream.steps) && stream.steps.length) extras.push('stepped');
  const escalator = Number(stream.escalatorPct || 0);
  if (escalator) extras.push(`${escalator}% escalator`);
  if (extras.length) desc += ` [${extras.join(', ')}]`;

  return desc;
}

/**
 * Describe nth week
 */
function describeNth(nth: string): string {
  switch (nth) {
    case '1':
      return '1st';
    case '2':
      return '2nd';
    case '3':
      return '3rd';
    case '4':
      return '4th';
    case '5':
      return '5th';
    case 'last':
      return 'last';
    default:
      return nth;
  }
}

/**
 * Add a step row to the step editor
 */
function addStepRow(editorEl: HTMLElement | null): void {
  if (!editorEl) return;
  const tbody = editorEl.querySelector('tbody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="date" class="step-date" /></td>
    <td><input type="number" step="0.01" class="step-amount" /></td>
    <td><button type="button" class="link" data-act="delStepRow">Remove</button></td>
  `;
  tbody.appendChild(tr);
}

/**
 * Collect step rows from editor
 */
function collectStepRows(editorEl: HTMLElement | null): Step[] {
  if (!editorEl) return [];
  const rows = editorEl.querySelectorAll<HTMLTableRowElement>('tbody tr');
  const steps: Step[] = [];

  for (const row of Array.from(rows)) {
    const dateInput = row.querySelector<HTMLInputElement>('.step-date');
    const amountInput = row.querySelector<HTMLInputElement>('.step-amount');
    const date = dateInput?.value || '';
    const amount = Number(amountInput?.value || 0);

    if (date && !isNaN(amount)) {
      steps.push({ effectiveFrom: date, amount: Math.abs(amount) });
    }
  }

  return steps.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/**
 * Clear all step rows
 */
function clearStepRows(editorEl: HTMLElement | null): void {
  if (!editorEl) return;
  const tbody = editorEl.querySelector('tbody');
  if (tbody) tbody.innerHTML = '';
}

/**
 * Initialize step editor
 */
function initStepEditor(editorEl: HTMLElement | null): void {
  if (!editorEl) return;

  const addBtn = editorEl.querySelector('[data-act="addStepRow"]');
  if (addBtn) {
    addBtn.addEventListener('click', () => addStepRow(editorEl));
  }

  editorEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const delBtn = target.closest('button[data-act="delStepRow"]');
    if (delBtn) {
      const row = delBtn.closest('tr');
      if (row) row.remove();
    }
  });
}

/**
 * Apply monthly mode visibility
 */
function applyMonthlyModeVisibility(select: HTMLSelectElement | null): void {
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
 * Show frequency-specific blocks
 */
function showFreqBlocks(): void {
  const form = $('#streamForm');
  if (!form) return;

  const freqSelect = $('#stFreq') as HTMLSelectElement | null;
  if (!freqSelect) return;

  const freqFields = form.querySelectorAll('.st-freq-only');
  freqFields.forEach((el) => el.classList.add('hidden'));

  const freq = freqSelect.value;
  form.querySelectorAll(`.st-freq-${freq}`).forEach((el) => el.classList.remove('hidden'));
}

/**
 * Render income streams table
 */
export function renderStreams(
  streams: IncomeStream[],
  todayYMD: YMDString
): void {
  const tbody = $('#streamsTable tbody') as HTMLTableSectionElement | null;
  if (!tbody) return;

  tbody.innerHTML = '';
  const rows = [...streams].sort((a, b) => a.name.localeCompare(b.name));

  for (const stream of rows) {
    const schedule = describeTransactionSchedule(stream);
    const next = getNextOccurrence(stream, todayYMD);
    const nextLabel = next ? `${fmtMoney(next.amount)} (${next.date})` : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${stream.name}</td>
      <td>${stream.category || ''}</td>
      <td>${stream.frequency}</td>
      <td>${schedule}</td>
      <td class="num">${nextLabel}</td>
      <td>${stream.startDate} → ${stream.endDate}</td>
      <td><button class="link" data-id="${stream.id}" data-act="delStream">Delete</button></td>
    `;
    tbody.appendChild(tr);
  }
}

/**
 * Initialize income streams handlers
 */
export function bindStreams(
  onAdd: (stream: IncomeStream) => void,
  onDelete: (id: string) => void
): void {
  // Initialize step editor
  initStepEditor($('#stStepEditor'));

  // Frequency change handler
  const freqSelect = $('#stFreq');
  if (freqSelect) {
    freqSelect.addEventListener('change', showFreqBlocks);
  }

  // Monthly mode change handler
  const monthlyModeSelect = $('#stMonthlyMode') as HTMLSelectElement | null;
  if (monthlyModeSelect) {
    monthlyModeSelect.addEventListener('change', (e) => {
      applyMonthlyModeVisibility(e.target as HTMLSelectElement);
    });
  }

  // Initial visibility
  showFreqBlocks();

  // Form submit handler
  const form = $('#streamForm') as HTMLFormElement | null;
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const nameEl = $('#stName') as HTMLInputElement | null;
      const categoryEl = $('#stCategory') as HTMLInputElement | null;
      const amountEl = $('#stAmount') as HTMLInputElement | null;
      const freqEl = $('#stFreq') as HTMLSelectElement | null;
      const startDateEl = $('#stStart') as HTMLInputElement | null;
      const endDateEl = $('#stEnd') as HTMLInputElement | null;

      const name = nameEl?.value.trim() || '';
      const category = categoryEl?.value.trim() || '';
      const amount = Number(amountEl?.value || 0);
      const frequency = freqEl?.value || 'once';
      const startDate = startDateEl?.value || '';
      const endDate = endDateEl?.value || '';

      if (!name || isNaN(amount) || !startDate || !endDate) return;

      const dowSelect = $('#stDOW') as HTMLElement | null;
      const weekdays = readWeekdaySelections(dowSelect);

      const stream: IncomeStream = {
        id: uid(),
        name,
        category,
        amount: Math.abs(amount),
        frequency: frequency as any,
        startDate,
        endDate,
        onDate: null,
        skipWeekends: false,
        dayOfWeek: weekdays,
        dayOfMonth: 1,
        monthlyMode: 'day',
        nthWeek: '1',
        nthWeekday: firstWeekday(weekdays, 0),
        steps: [],
        escalatorPct: 0,
      };

      if (frequency === 'once') {
        const onDateEl = $('#stOnDate') as HTMLInputElement | null;
        stream.onDate = onDateEl?.value || null;
        if (!stream.onDate) return;
      }

      if (frequency === 'daily') {
        const skipWeekendsEl = $('#stSkipWeekends') as HTMLInputElement | null;
        stream.skipWeekends = skipWeekendsEl?.checked || false;
      }

      if (frequency === 'weekly' || frequency === 'biweekly') {
        if (!weekdays.length) return;
      }

      if (frequency === 'monthly') {
        const modeSel = $('#stMonthlyMode') as HTMLSelectElement | null;
        const mode = modeSel && modeSel.value === 'nth' ? 'nth' : 'day';
        stream.monthlyMode = mode;

        if (mode === 'nth') {
          const nthWeekEl = $('#stNthWeek') as HTMLSelectElement | null;
          const nthWeekdayEl = $('#stNthWeekday') as HTMLSelectElement | null;
          stream.nthWeek = normalizeNth(nthWeekEl?.value || '1') as any;
          stream.nthWeekday = clamp(Number(nthWeekdayEl?.value || 0), 0, 6);
        } else {
          const domEl = $('#stDOM') as HTMLInputElement | null;
          stream.dayOfMonth = clamp(Number(domEl?.value || 1), 1, 31);
        }
      }

      // Steps
      stream.steps = collectStepRows($('#stStepEditor'));

      // Escalator
      const escalatorEl = $('#stEscalator') as HTMLInputElement | null;
      const escalatorRaw = Number(escalatorEl?.value || 0);
      stream.escalatorPct = Number.isFinite(escalatorRaw) ? escalatorRaw : 0;

      // Add stream
      onAdd(stream);

      // Reset form
      form.reset();
      if (freqEl) freqEl.value = 'once';
      showFreqBlocks();
      clearStepRows($('#stStepEditor'));
      if (escalatorEl) escalatorEl.value = '';
    });
  }

  // Delete handler
  const table = $('#streamsTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("button[data-act='delStream']") as HTMLButtonElement | null;
      if (!btn) return;

      const id = btn.getAttribute('data-id');
      if (id) {
        onDelete(id);
      }
    });
  }
}
