/**
 * Chart rendering utilities for Cash Flow Tracker
 * Uses Chart.js for visualizations
 */

import type { ProjectionResult, YMDString } from '../types';
import { round2 } from '../modules/calculations';
import { compareYMD } from '../modules/dateUtils';
import { Chart, registerables } from 'chart.js';

// Register all Chart.js components
Chart.register(...registerables);

/**
 * Chart color configuration
 */
const lineColors = {
  above: '#1b5e20',
  below: '#b71c1c',
};

/**
 * Create segment color gradient for balance chart
 */
function createSegmentColor(ctx: any): string | CanvasGradient {
  const { chart, p0DataIndex, p1DataIndex } = ctx;
  const meta = chart.getDatasetMeta(0);
  if (!meta || !meta.data || !meta.data.length) return lineColors.above;

  const point0 = meta.data[p0DataIndex];
  const point1 = meta.data[p1DataIndex];
  if (!point0 || !point1) return lineColors.above;

  const y0 = typeof point0.parsed?.y === 'number' ? point0.parsed.y : 0;
  const y1 = typeof point1.parsed?.y === 'number' ? point1.parsed.y : 0;

  if ((y0 >= 0 && y1 >= 0) || (y0 < 0 && y1 < 0)) {
    return y0 >= 0 ? lineColors.above : lineColors.below;
  }

  const canvas = chart.canvas;
  if (!canvas || typeof canvas.getContext !== 'function') return lineColors.above;

  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return lineColors.above;

  const gradient = ctx2d.createLinearGradient(point0.x, point0.y, point1.x, point1.y);
  const ratio = Math.abs(y0) / (Math.abs(y0) + Math.abs(y1));
  const startColor = y0 >= 0 ? lineColors.above : lineColors.below;
  const endColor = y1 >= 0 ? lineColors.above : lineColors.below;
  const midColor = y0 >= 0 ? lineColors.below : lineColors.above;

  gradient.addColorStop(0, startColor);
  gradient.addColorStop(Math.min(Math.max(ratio, 0), 1), startColor);
  gradient.addColorStop(Math.min(Math.max(ratio, 0), 1), midColor);
  gradient.addColorStop(1, endColor);

  return gradient;
}

/**
 * Common chart options for balance charts
 */
const balanceChartOptions = {
  interaction: { intersect: false, mode: 'index' as const },
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { maxTicksLimit: 10 } },
    y: {
      beginAtZero: false,
      grid: {
        color: (ctx: any) => {
          const value = ctx.tick && typeof ctx.tick.value === 'number' ? ctx.tick.value : null;
          return value === 0 ? '#0f172a' : 'rgba(148, 163, 184, 0.2)';
        },
        lineWidth: (ctx: any) => {
          const value = ctx.tick && typeof ctx.tick.value === 'number' ? ctx.tick.value : null;
          return value === 0 ? 2 : 1;
        },
      },
    },
  },
};

/**
 * Chart instance storage
 */
let balanceChartInstance: any = null;
let whatIfChartInstance: any = null;

/**
 * Destroy existing chart if it exists
 */
function destroyChart(chartInstance: any): void {
  if (chartInstance && typeof chartInstance.destroy === 'function') {
    chartInstance.destroy();
  }
}

/**
 * Get or destroy existing Chart.js instance
 */
function getExistingChart(canvas: HTMLCanvasElement): any {
  const existingChart = typeof Chart?.getChart === 'function'
    ? Chart.getChart(canvas)
    : null;

  if (existingChart && typeof existingChart.destroy === 'function') {
    existingChart.destroy();
  }

  return null;
}

/**
 * Render the main balance chart showing projected balance over time
 */
export function renderBalanceChart(
  canvas: HTMLCanvasElement,
  projection: ProjectionResult
): any {
  // Destroy existing chart
  destroyChart(balanceChartInstance);
  getExistingChart(canvas);

  const { cal } = projection;
  if (!cal || !cal.length) {
    balanceChartInstance = null;
    return null;
  }

  const labels = cal.map((r) => r.date);
  const data = cal.map((r) => round2(r.running));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    balanceChartInstance = null;
    return null;
  }

  balanceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Projected Balance',
          data,
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0,
          borderColor: lineColors.above,
          segment: {
            borderColor: createSegmentColor,
          },
          fill: {
            target: { value: 0 },
            above: 'rgba(27, 94, 32, 0.15)',
            below: 'rgba(183, 28, 28, 0.18)',
          },
        },
      ],
    },
    options: balanceChartOptions,
  });

  return balanceChartInstance;
}

/**
 * Render the What-If comparison chart showing actual vs scenario projections
 */
export function renderWhatIfChart(
  canvas: HTMLCanvasElement,
  actualProjection: ProjectionResult,
  whatIfProjection: ProjectionResult
): any {
  // Destroy existing chart
  destroyChart(whatIfChartInstance);
  getExistingChart(canvas);

  const actualMap = new Map<YMDString, number>();
  const sandboxMap = new Map<YMDString, number>();

  for (const row of actualProjection.cal || []) {
    actualMap.set(row.date, round2(row.running));
  }
  for (const row of whatIfProjection.cal || []) {
    sandboxMap.set(row.date, round2(row.running));
  }

  const labels = Array.from(new Set([...actualMap.keys(), ...sandboxMap.keys()]))
    .sort((a, b) => compareYMD(a, b));

  const actualData = labels.map((date) =>
    actualMap.has(date) ? round2(actualMap.get(date)!) : null
  );
  const sandboxData = labels.map((date) =>
    sandboxMap.has(date) ? round2(sandboxMap.get(date)!) : null
  );

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    whatIfChartInstance = null;
    return null;
  }

  whatIfChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Actual Projection',
          data: actualData,
          borderColor: '#94a3b8',
          backgroundColor: 'rgba(148, 163, 184, 0.18)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          borderDash: [6, 4],
          spanGaps: false,
        },
        {
          label: 'What-If Projection',
          data: sandboxData,
          borderColor: '#5F7BFF',
          backgroundColor: 'rgba(95, 123, 255, 0.2)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          spanGaps: false,
        },
      ],
    },
    options: {
      interaction: { intersect: false, mode: 'index' as const },
      plugins: { legend: { display: true } },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
        y: {
          beginAtZero: false,
          grid: {
            color: (ctx: any) => {
              const value = ctx.tick && typeof ctx.tick.value === 'number' ? ctx.tick.value : null;
              return value === 0 ? '#0f172a' : 'rgba(148, 163, 184, 0.2)';
            },
            lineWidth: (ctx: any) => {
              const value = ctx.tick && typeof ctx.tick.value === 'number' ? ctx.tick.value : null;
              return value === 0 ? 2 : 1;
            },
          },
        },
      },
    },
  });

  return whatIfChartInstance;
}

/**
 * Destroy all chart instances
 */
export function destroyAllCharts(): void {
  destroyChart(balanceChartInstance);
  destroyChart(whatIfChartInstance);
  balanceChartInstance = null;
  whatIfChartInstance = null;
}

/**
 * Get current balance chart instance
 */
export function getBalanceChart(): any {
  return balanceChartInstance;
}

/**
 * Get current what-if chart instance
 */
export function getWhatIfChart(): any {
  return whatIfChartInstance;
}
