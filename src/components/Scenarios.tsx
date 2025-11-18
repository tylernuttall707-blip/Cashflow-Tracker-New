/**
 * Scenarios Tab Component - Multiple scenario planning and comparison
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ScenarioList } from './ScenarioList';
import { ScenarioEditor } from './ScenarioEditor';
import { ComparisonChart } from './ComparisonChart';
import { DifferenceHeatmap } from './DifferenceHeatmap';
import { AISuggestions } from './AISuggestions';
import { computeProjection, fmtMoney } from '../modules/calculations';
import { computeScenarioProjection } from '../modules/scenarioEngine';
import { fromYMD } from '../modules/dateUtils';
import {
  exportComparisonCSV,
  exportComparisonJSON,
  exportSummaryCSV,
  type ComparisonExportData,
} from '../modules/exportComparison';
import type { Scenario, ProjectionResult, AppState } from '../types';

type ViewMode = 'editor' | 'comparison';

export function Scenarios() {
  const {
    scenarios,
    settings,
    adjustments,
    oneOffs,
    incomeStreams,
    expandedTransactions,
  } = useAppStore();

  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [comparisonScenarios, setComparisonScenarios] = useState<string[]>([]);

  // Baseline projection (no scenario changes)
  const [baselineProjection, setBaselineProjection] = useState<ProjectionResult | null>(null);

  // Scenario projections for comparison
  const [scenarioProjections, setScenarioProjections] = useState<Record<string, ProjectionResult>>({});

  // Calculate baseline projection
  useEffect(() => {
    try {
      const result = computeProjection({
        settings,
        adjustments,
        oneOffs,
        incomeStreams,
        expandedTransactions,
        scenarios: [],
        activeScenarioId: null,
        ui: {
          oneOffSort: { key: 'date', direction: 'asc' },
          expandedSort: { key: 'date', direction: 'asc' },
        },
      });
      setBaselineProjection(result);
    } catch (err) {
      console.error('Baseline projection calculation failed:', err);
    }
  }, [settings, adjustments, oneOffs, incomeStreams, expandedTransactions]);

  // Calculate projections for comparison scenarios
  useEffect(() => {
    if (comparisonScenarios.length === 0) {
      setScenarioProjections({});
      return;
    }

    const projections: Record<string, ProjectionResult> = {};
    const baseState = {
      settings,
      adjustments,
      oneOffs,
      incomeStreams,
      expandedTransactions,
      scenarios: [],
      activeScenarioId: null,
      ui: {
        oneOffSort: { key: 'date' as const, direction: 'asc' as const },
        expandedSort: { key: 'date' as const, direction: 'asc' as const },
      },
    };

    comparisonScenarios.forEach((scenarioId) => {
      const scenario = (scenarios || []).find((s) => s.id === scenarioId);
      if (scenario) {
        try {
          projections[scenarioId] = computeScenarioProjection(baseState, scenario);
        } catch (err) {
          console.error(`Failed to compute projection for scenario ${scenario.name}:`, err);
        }
      }
    });

    setScenarioProjections(projections);
  }, [comparisonScenarios, scenarios, settings, adjustments, oneOffs, incomeStreams, expandedTransactions]);

  const handleSelectScenario = (scenario: Scenario | null) => {
    setSelectedScenario(scenario);
    setViewMode('editor');
  };

  const handleToggleComparison = (scenarioId: string) => {
    setComparisonScenarios((prev) => {
      if (prev.includes(scenarioId)) {
        return prev.filter((id) => id !== scenarioId);
      } else {
        // Limit to 5 scenarios for comparison
        if (prev.length >= 5) {
          alert('Maximum 5 scenarios can be compared at once');
          return prev;
        }
        return [...prev, scenarioId];
      }
    });
  };

  const handleExportCSV = () => {
    if (!baselineProjection || comparisonScenarios.length === 0) {
      alert('Please select at least one scenario to export');
      return;
    }

    const exportData: ComparisonExportData = {
      exportDate: new Date().toISOString(),
      baseline: baselineProjection,
      scenarios: comparisonScenarios
        .map((id) => {
          const scenario = scenarios?.find((s) => s.id === id);
          const projection = scenarioProjections[id];
          if (scenario && projection) {
            return { scenario, projection };
          }
          return null;
        })
        .filter((item): item is { scenario: Scenario; projection: ProjectionResult } => item !== null),
    };

    exportComparisonCSV(exportData);
  };

  const handleExportJSON = () => {
    if (!baselineProjection || comparisonScenarios.length === 0) {
      alert('Please select at least one scenario to export');
      return;
    }

    const exportData: ComparisonExportData = {
      exportDate: new Date().toISOString(),
      baseline: baselineProjection,
      scenarios: comparisonScenarios
        .map((id) => {
          const scenario = scenarios?.find((s) => s.id === id);
          const projection = scenarioProjections[id];
          if (scenario && projection) {
            return { scenario, projection };
          }
          return null;
        })
        .filter((item): item is { scenario: Scenario; projection: ProjectionResult } => item !== null),
    };

    exportComparisonJSON(exportData);
  };

  const handleExportSummary = () => {
    if (!baselineProjection || comparisonScenarios.length === 0) {
      alert('Please select at least one scenario to export');
      return;
    }

    const exportData: ComparisonExportData = {
      exportDate: new Date().toISOString(),
      baseline: baselineProjection,
      scenarios: comparisonScenarios
        .map((id) => {
          const scenario = scenarios?.find((s) => s.id === id);
          const projection = scenarioProjections[id];
          if (scenario && projection) {
            return { scenario, projection };
          }
          return null;
        })
        .filter((item): item is { scenario: Scenario; projection: ProjectionResult } => item !== null),
    };

    exportSummaryCSV(exportData);
  };

  const fmtDate = (ymd: string): string => {
    if (!ymd) return '';
    try {
      const d = fromYMD(ymd);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return ymd;
    }
  };

  const activeScenarios = (scenarios || []).filter((s) => !s.isArchived);

  return (
    <section id="scenarios" className="tab-panel active scenarios-layout">
      {/* Sidebar with scenario list */}
      <ScenarioList
        onSelectScenario={handleSelectScenario}
        selectedScenarioId={selectedScenario?.id || null}
      />

      {/* Main content area */}
      <div className="scenarios-main">
        {/* View mode selector */}
        <div className="scenarios-toolbar">
          <div className="view-mode-selector">
            <button
              className={`btn btn-sm ${viewMode === 'editor' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('editor')}
            >
              Editor
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'comparison' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('comparison')}
            >
              Comparison ({comparisonScenarios.length})
            </button>
          </div>
        </div>

        {/* Editor View */}
        {viewMode === 'editor' && (
          <ScenarioEditor scenario={selectedScenario} />
        )}

        {/* Comparison View */}
        {viewMode === 'comparison' && (
          <div className="scenarios-comparison">
            <div className="card">
              <div className="card-header">
                <h2>Scenario Comparison</h2>
                <p className="card-description">
                  Select scenarios from the sidebar to compare them
                </p>
              </div>

              {/* Scenario Selection */}
              <div className="comparison-scenario-selector">
                <h3>Select Scenarios to Compare (max 5)</h3>
                <div className="scenario-checkboxes">
                  {activeScenarios.map((scenario) => (
                    <label key={scenario.id} className="scenario-checkbox">
                      <input
                        type="checkbox"
                        checked={comparisonScenarios.includes(scenario.id)}
                        onChange={() => handleToggleComparison(scenario.id)}
                      />
                      <span
                        className="scenario-color-dot"
                        style={{ backgroundColor: scenario.color }}
                      />
                      <span>{scenario.name}</span>
                      <span className="scenario-change-count">
                        ({scenario.changes.length} changes)
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* AI Suggestions */}
              {baselineProjection && (
                <div className="ai-suggestions-section" style={{ marginBottom: '2rem' }}>
                  <AISuggestions
                    state={{
                      settings,
                      adjustments,
                      oneOffs,
                      incomeStreams,
                      expandedTransactions,
                      scenarios: scenarios || [],
                      activeScenarioId: null,
                      ui: {
                        oneOffSort: { key: 'date' as const, direction: 'asc' as const },
                        expandedSort: { key: 'date' as const, direction: 'asc' as const },
                      },
                    }}
                    projection={baselineProjection}
                    onApplySuggestion={(scenario) => {
                      handleSelectScenario(scenario);
                    }}
                  />
                </div>
              )}

              {/* Export Buttons */}
              {comparisonScenarios.length > 0 && (
                <div className="comparison-export-toolbar">
                  <h3>Export Comparison Report</h3>
                  <div className="export-buttons">
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={handleExportSummary}
                      title="Export summary metrics only"
                    >
                      📊 Export Summary CSV
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={handleExportCSV}
                      title="Export detailed comparison with daily data"
                    >
                      📄 Export Full CSV
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={handleExportJSON}
                      title="Export raw data as JSON"
                    >
                      💾 Export JSON
                    </button>
                  </div>
                </div>
              )}

              {/* Comparison Results */}
              {comparisonScenarios.length > 0 && baselineProjection && (
                <>
                  {/* Key Metrics Comparison */}
                  <div className="comparison-metrics">
                    <h3>Key Metrics Comparison</h3>
                    <table className="table comparison-table">
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>End Balance</th>
                          <th>Lowest Balance</th>
                          <th>Total Income</th>
                          <th>Total Expenses</th>
                          <th>Days Below $0</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Baseline */}
                        {baselineProjection && (
                          <tr className="baseline-row">
                            <td>
                              <strong>Baseline</strong>
                            </td>
                            <td>{fmtMoney(baselineProjection.endBalance)}</td>
                            <td>{fmtMoney(baselineProjection.lowestBalance)}</td>
                            <td>{fmtMoney(baselineProjection.totalIncome)}</td>
                            <td>{fmtMoney(baselineProjection.totalExpenses)}</td>
                            <td>{baselineProjection.negativeDays}</td>
                          </tr>
                        )}

                        {/* Scenarios */}
                        {comparisonScenarios.map((scenarioId) => {
                          const scenario = (scenarios || []).find((s) => s.id === scenarioId);
                          const projection = scenarioProjections[scenarioId];

                          if (!scenario || !projection) return null;

                          return (
                            <tr key={scenarioId}>
                              <td>
                                <span
                                  className="scenario-color-dot"
                                  style={{ backgroundColor: scenario.color }}
                                />
                                {scenario.name}
                              </td>
                              <td>
                                {fmtMoney(projection.endBalance)}
                                {baselineProjection && (
                                  <div className="delta-value">
                                    {projection.endBalance > baselineProjection.endBalance ? '↑' : '↓'}
                                    {' '}
                                    {fmtMoney(Math.abs(projection.endBalance - baselineProjection.endBalance))}
                                  </div>
                                )}
                              </td>
                              <td>
                                {fmtMoney(projection.lowestBalance)}
                                {baselineProjection && (
                                  <div className="delta-value">
                                    {projection.lowestBalance > baselineProjection.lowestBalance ? '↑' : '↓'}
                                    {' '}
                                    {fmtMoney(Math.abs(projection.lowestBalance - baselineProjection.lowestBalance))}
                                  </div>
                                )}
                              </td>
                              <td>{fmtMoney(projection.totalIncome)}</td>
                              <td>{fmtMoney(projection.totalExpenses)}</td>
                              <td>{projection.negativeDays}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Balance Projection Chart */}
                  <div className="comparison-chart-section">
                    <ComparisonChart
                      baselineProjection={baselineProjection}
                      scenarioProjections={scenarioProjections}
                      scenarios={scenarios || []}
                      selectedScenarioIds={comparisonScenarios}
                      days={90}
                    />
                  </div>

                  {/* Difference Heatmap */}
                  <div className="comparison-heatmap-section">
                    <DifferenceHeatmap
                      baselineProjection={baselineProjection}
                      scenarioProjections={scenarioProjections}
                      scenarios={scenarios || []}
                      selectedScenarioIds={comparisonScenarios}
                      days={30}
                    />
                  </div>

                  {/* Daily Comparison Table */}
                  <div className="comparison-daily">
                    <h3>30-Day Balance Comparison</h3>
                    <div className="table-scroll">
                      <table className="table comparison-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Baseline</th>
                            {comparisonScenarios.map((scenarioId) => {
                              const scenario = (scenarios || []).find((s) => s.id === scenarioId);
                              return scenario ? (
                                <th key={scenarioId}>
                                  <span
                                    className="scenario-color-dot"
                                    style={{ backgroundColor: scenario.color }}
                                  />
                                  {scenario.name}
                                </th>
                              ) : null;
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {baselineProjection?.cal.slice(0, 30).map((day, index) => (
                            <tr key={day.date}>
                              <td>{fmtDate(day.date)}</td>
                              <td>{fmtMoney(day.running)}</td>
                              {comparisonScenarios.map((scenarioId) => {
                                const projection = scenarioProjections[scenarioId];
                                const scenarioDay = projection?.cal[index];
                                return scenarioDay ? (
                                  <td key={scenarioId}>
                                    {fmtMoney(scenarioDay.running)}
                                    <div className="delta-value">
                                      {scenarioDay.running > day.running ? '↑' : '↓'}
                                      {' '}
                                      {fmtMoney(Math.abs(scenarioDay.running - day.running))}
                                    </div>
                                  </td>
                                ) : (
                                  <td key={scenarioId}>—</td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {comparisonScenarios.length === 0 && (
                <div className="comparison-empty">
                  <p>Select at least one scenario above to see comparison results.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
