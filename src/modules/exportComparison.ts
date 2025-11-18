/**
 * Export utilities for scenario comparison reports
 */

import type { ProjectionResult, Scenario } from '../types';

export interface ComparisonExportData {
  exportDate: string;
  baseline: ProjectionResult;
  scenarios: Array<{
    scenario: Scenario;
    projection: ProjectionResult;
  }>;
}

/**
 * Export comparison data as JSON file
 */
export function exportComparisonJSON(data: ComparisonExportData): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `scenario-comparison-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export comparison data as CSV file
 */
export function exportComparisonCSV(data: ComparisonExportData, days = 90): void {
  const lines: string[] = [];

  // Header: Summary Section
  lines.push('SCENARIO COMPARISON REPORT');
  lines.push(`Export Date: ${data.exportDate}`);
  lines.push('');

  // Key Metrics Comparison
  lines.push('KEY METRICS COMPARISON');
  lines.push(
    'Scenario,End Balance,Lowest Balance,Total Income,Total Expenses,Days Below $0,Net Cashflow'
  );

  // Baseline row
  lines.push(
    `Baseline,${data.baseline.endBalance},${data.baseline.lowestBalance},${data.baseline.totalIncome},${data.baseline.totalExpenses},${data.baseline.negativeDays},${data.baseline.totalIncome - data.baseline.totalExpenses}`
  );

  // Scenario rows
  data.scenarios.forEach(({ scenario, projection }) => {
    lines.push(
      `${scenario.name},${projection.endBalance},${projection.lowestBalance},${projection.totalIncome},${projection.totalExpenses},${projection.negativeDays},${projection.totalIncome - projection.totalExpenses}`
    );
  });

  lines.push('');

  // Daily Balance Comparison
  lines.push('DAILY BALANCE COMPARISON');
  const headerRow = ['Date', 'Baseline'];
  data.scenarios.forEach(({ scenario }) => {
    headerRow.push(scenario.name);
    headerRow.push(`${scenario.name} (Diff)`);
  });
  lines.push(headerRow.join(','));

  // Daily data
  const numDays = Math.min(days, data.baseline.cal.length);
  for (let i = 0; i < numDays; i++) {
    const baselineDay = data.baseline.cal[i];
    const row = [baselineDay.date, baselineDay.running.toString()];

    data.scenarios.forEach(({ projection }) => {
      const scenarioDay = projection.cal[i];
      if (scenarioDay) {
        row.push(scenarioDay.running.toString());
        row.push((scenarioDay.running - baselineDay.running).toString());
      } else {
        row.push('');
        row.push('');
      }
    });

    lines.push(row.join(','));
  }

  lines.push('');

  // Scenario Details
  lines.push('SCENARIO DETAILS');
  data.scenarios.forEach(({ scenario }) => {
    lines.push('');
    lines.push(`Scenario: ${scenario.name}`);
    lines.push(`Description: ${scenario.description || 'N/A'}`);
    lines.push(`Color: ${scenario.color}`);
    lines.push(`Created: ${scenario.createdAt}`);
    lines.push(`Changes: ${scenario.changes.length}`);

    if (scenario.changes.length > 0) {
      lines.push('Change Details:');
      scenario.changes.forEach((change, idx) => {
        lines.push(`  ${idx + 1}. ${change.type}: ${change.description}`);
      });
    }
  });

  // Create and download CSV
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `scenario-comparison-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export summary metrics only as CSV
 */
export function exportSummaryCSV(data: ComparisonExportData): void {
  const lines: string[] = [];

  lines.push('SCENARIO COMPARISON SUMMARY');
  lines.push(`Export Date: ${data.exportDate}`);
  lines.push('');

  // Headers
  lines.push(
    'Scenario,End Balance,Δ vs Baseline,Lowest Balance,Δ vs Baseline,Total Income,Total Expenses,Net Cashflow,Days Below $0'
  );

  // Baseline
  lines.push(
    `Baseline,${data.baseline.endBalance},0,${data.baseline.lowestBalance},0,${data.baseline.totalIncome},${data.baseline.totalExpenses},${data.baseline.totalIncome - data.baseline.totalExpenses},${data.baseline.negativeDays}`
  );

  // Scenarios
  data.scenarios.forEach(({ scenario, projection }) => {
    const endBalanceDiff = projection.endBalance - data.baseline.endBalance;
    const lowestBalanceDiff = projection.lowestBalance - data.baseline.lowestBalance;
    const netCashflow = projection.totalIncome - projection.totalExpenses;

    lines.push(
      `${scenario.name},${projection.endBalance},${endBalanceDiff},${projection.lowestBalance},${lowestBalanceDiff},${projection.totalIncome},${projection.totalExpenses},${netCashflow},${projection.negativeDays}`
    );
  });

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `scenario-summary-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
