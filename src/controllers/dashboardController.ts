/**
 * Dashboard Controller
 * Handles the main dashboard tab with KPIs, balance chart, and upcoming transactions
 */

import type { Adjustment, ProjectionResult } from '../types';
import { fmtMoney } from '../modules/calculations';
import { fromYMD } from '../modules/dateUtils';
import { renderBalanceChart } from '../utils/chartUtils';

/**
 * Utility function for element selection
 */
function $(sel: string, ctx: Document | HTMLElement = document): HTMLElement | null {
  return ctx.querySelector(sel);
}

/**
 * Format date for display
 */
function fmtDate(ymd: string): string {
  if (!ymd) return '';
  try {
    const d = fromYMD(ymd);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (err) {
    return ymd;
  }
}

/**
 * Render dashboard KPIs
 */
export function renderDashboardKPIs(projection: ProjectionResult): void {
  const {
    totalIncome,
    totalExpenses,
    endBalance,
    projectedWeeklyIncome,
    lowestBalance,
    lowestBalanceDate,
    peakBalance,
    peakBalanceDate,
    firstNegativeDate,
    negativeDays,
  } = projection;

  // Update KPI elements
  const endBalanceEl = $('#kpiEndBalance');
  if (endBalanceEl) endBalanceEl.textContent = fmtMoney(endBalance);

  const incomeEl = $('#kpiIncome');
  if (incomeEl) incomeEl.textContent = fmtMoney(totalIncome);

  const expensesEl = $('#kpiExpenses');
  if (expensesEl) expensesEl.textContent = fmtMoney(totalExpenses);

  const weeklyEl = $('#kpiWeeklyIncome');
  if (weeklyEl) weeklyEl.textContent = fmtMoney(projectedWeeklyIncome);

  const lowestEl = $('#kpiLowestBalance');
  if (lowestEl) lowestEl.textContent = fmtMoney(lowestBalance);

  const lowestDateEl = $('#kpiLowestDate');
  if (lowestDateEl) {
    lowestDateEl.textContent = lowestBalanceDate ? `on ${fmtDate(lowestBalanceDate)}` : '—';
  }

  const peakEl = $('#kpiPeakBalance');
  if (peakEl) peakEl.textContent = fmtMoney(peakBalance);

  const peakDateEl = $('#kpiPeakDate');
  if (peakDateEl) {
    peakDateEl.textContent = peakBalanceDate ? `on ${fmtDate(peakBalanceDate)}` : '—';
  }

  const negDaysEl = $('#kpiNegativeDays');
  if (negDaysEl) negDaysEl.textContent = String(negativeDays);

  const firstNegEl = $('#kpiFirstNegative');
  if (firstNegEl) {
    firstNegEl.textContent = firstNegativeDate ? fmtDate(firstNegativeDate) : '—';
  }
}

/**
 * Render upcoming 14 days table
 */
export function renderUpcoming14Days(projection: ProjectionResult): void {
  const tbody = $('#upcomingTable tbody') as HTMLTableSectionElement | null;
  if (!tbody) return;

  tbody.innerHTML = '';
  const next14 = projection.cal.slice(0, 14);

  for (const row of next14) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.date}</td>
      <td class="num">${fmtMoney(row.income)}</td>
      <td class="num">${fmtMoney(row.expenses)}</td>
      <td class="num">${fmtMoney(row.net)}</td>
      <td class="num">${fmtMoney(row.running)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/**
 * Render complete dashboard
 */
export function renderDashboard(projection: ProjectionResult): void {
  // Render KPIs
  renderDashboardKPIs(projection);

  // Render chart
  const canvasEl = $('#balanceChart') as HTMLCanvasElement | null;
  if (canvasEl) {
    renderBalanceChart(canvasEl, projection);
  }

  // Render upcoming 14 days table
  renderUpcoming14Days(projection);
}

/**
 * Render adjustments table
 */
export function renderAdjustments(adjustments: Adjustment[]): void {
  const tbody = $('#adjTable tbody') as HTMLTableSectionElement | null;
  if (!tbody) return;

  tbody.innerHTML = '';
  const rows = [...adjustments].sort((a, b) => a.date.localeCompare(b.date));

  for (const adj of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${adj.date}</td>
      <td class="num">${fmtMoney(Number(adj.amount || 0))}</td>
      <td>${adj.note || ''}</td>
      <td><button class="link" data-id="${adj.date}" data-act="delAdj">Delete</button></td>
    `;
    tbody.appendChild(tr);
  }
}

/**
 * Render settings form
 */
export function renderSettingsForm(
  startDate: string,
  endDate: string,
  startingBalance: number
): void {
  const startDateEl = $('#startDate') as HTMLInputElement | null;
  if (startDateEl) startDateEl.value = startDate;

  const endDateEl = $('#endDate') as HTMLInputElement | null;
  if (endDateEl) endDateEl.value = endDate;

  const startingBalanceEl = $('#startingBalance') as HTMLInputElement | null;
  if (startingBalanceEl) startingBalanceEl.value = String(startingBalance);
}

/**
 * Initialize settings form handlers
 */
export function initSettings(
  onSave: (startDate: string, endDate: string, startingBalance: number) => void
): void {
  const form = $('#settingsForm') as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const startDateEl = $('#startDate') as HTMLInputElement | null;
    const endDateEl = $('#endDate') as HTMLInputElement | null;
    const startingBalanceEl = $('#startingBalance') as HTMLInputElement | null;

    const startDate = startDateEl?.value || '';
    const endDate = endDateEl?.value || '';
    const startingBalance = Number(startingBalanceEl?.value || 0);

    onSave(startDate, endDate, startingBalance);
  });
}

/**
 * Initialize adjustments handlers
 */
export function initAdjustments(
  onAdd: (date: string, amount: number, note: string) => void,
  onDelete: (date: string) => void
): void {
  // Add adjustment form handler
  const form = $('#adjForm') as HTMLFormElement | null;
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const dateEl = $('#adjDate') as HTMLInputElement | null;
      const amountEl = $('#adjAmount') as HTMLInputElement | null;
      const noteEl = $('#adjNote') as HTMLInputElement | null;

      const date = dateEl?.value || '';
      const amount = Number(amountEl?.value || 0);
      const note = noteEl?.value.trim() || '';

      if (!date || isNaN(amount)) return;

      onAdd(date, amount, note);
      form.reset();
    });
  }

  // Delete adjustment handler
  const table = $('#adjTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("button[data-act='delAdj']") as HTMLButtonElement | null;
      if (!btn) return;

      const id = btn.getAttribute('data-id');
      if (id) {
        onDelete(id);
      }
    });
  }
}

/**
 * Initialize tab navigation
 */
export function initTabs(): void {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Remove active class from all tabs and panels
      tabs.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      // Add active class to clicked tab
      btn.classList.add('active');

      // Show corresponding panel
      const tabId = btn.getAttribute('data-tab');
      if (tabId) {
        const panel = document.getElementById(tabId);
        if (panel) {
          panel.classList.add('active');
        }
      }
    });
  });
}
