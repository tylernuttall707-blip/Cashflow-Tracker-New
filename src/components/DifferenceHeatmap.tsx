/**
 * DifferenceHeatmap Component - Visualizes differences between scenarios and baseline
 */

import { fromYMD } from '../modules/dateUtils';
import type { ProjectionResult, Scenario } from '../types';

interface DifferenceHeatmapProps {
  baselineProjection: ProjectionResult;
  scenarioProjections: Record<string, ProjectionResult>;
  scenarios: Scenario[];
  selectedScenarioIds: string[];
  days?: number; // Number of days to show (default: 30)
}

export function DifferenceHeatmap({
  baselineProjection,
  scenarioProjections,
  scenarios,
  selectedScenarioIds,
  days = 30,
}: DifferenceHeatmapProps) {
  // Calculate max absolute difference for color scaling
  let maxAbsDiff = 0;
  selectedScenarioIds.forEach((scenarioId) => {
    const projection = scenarioProjections[scenarioId];
    if (!projection) return;

    projection.cal.slice(0, days).forEach((day, idx) => {
      const baselineDay = baselineProjection.cal[idx];
      if (baselineDay) {
        const diff = Math.abs(day.running - baselineDay.running);
        if (diff > maxAbsDiff) maxAbsDiff = diff;
      }
    });
  });

  // Generate color based on difference
  const getColorForDiff = (diff: number): string => {
    const normalized = Math.abs(diff) / (maxAbsDiff || 1);

    if (diff > 0) {
      // Positive difference - green scale
      const intensity = Math.min(normalized, 1);
      const green = Math.round(100 + intensity * 155); // 100-255
      return `rgb(0, ${green}, 0)`;
    } else if (diff < 0) {
      // Negative difference - red scale
      const intensity = Math.min(normalized, 1);
      const red = Math.round(100 + intensity * 155); // 100-255
      return `rgb(${red}, 0, 0)`;
    } else {
      // No difference - gray
      return '#e5e7eb';
    }
  };

  // Format currency
  const fmtMoney = (value: number): string => {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  // Format date
  const fmtDate = (ymd: string): string => {
    try {
      const d = fromYMD(ymd);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return ymd;
    }
  };

  if (selectedScenarioIds.length === 0) {
    return (
      <div className="heatmap-empty">
        <p>Select scenarios to see difference heatmap</p>
      </div>
    );
  }

  return (
    <div className="difference-heatmap">
      <h3>Difference Heatmap (vs Baseline)</h3>
      <p className="heatmap-description">
        Colors show how much each scenario differs from baseline.
        <span className="heatmap-legend">
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: 'rgb(255, 0, 0)' }} />
            Lower
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#e5e7eb' }} />
            Same
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: 'rgb(0, 255, 0)' }} />
            Higher
          </span>
        </span>
      </p>

      <div className="table-scroll">
        <table className="table heatmap-table">
          <thead>
            <tr>
              <th>Date</th>
              {selectedScenarioIds.map((scenarioId) => {
                const scenario = scenarios.find((s) => s.id === scenarioId);
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
            {baselineProjection.cal.slice(0, days).map((baselineDay, index) => (
              <tr key={baselineDay.date}>
                <td>{fmtDate(baselineDay.date)}</td>
                {selectedScenarioIds.map((scenarioId) => {
                  const projection = scenarioProjections[scenarioId];
                  const scenarioDay = projection?.cal[index];

                  if (!scenarioDay) {
                    return <td key={scenarioId}>—</td>;
                  }

                  const diff = scenarioDay.running - baselineDay.running;
                  const color = getColorForDiff(diff);
                  const textColor = Math.abs(diff) / (maxAbsDiff || 1) > 0.5 ? '#fff' : '#000';

                  return (
                    <td
                      key={scenarioId}
                      className="heatmap-cell"
                      style={{
                        backgroundColor: color,
                        color: textColor,
                      }}
                      title={`Difference: ${fmtMoney(diff)}`}
                    >
                      <div className="heatmap-cell-content">
                        {diff > 0 ? '+' : ''}
                        {fmtMoney(diff)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary statistics */}
      <div className="heatmap-summary">
        <h4>Summary</h4>
        <div className="summary-grid">
          {selectedScenarioIds.map((scenarioId) => {
            const scenario = scenarios.find((s) => s.id === scenarioId);
            const projection = scenarioProjections[scenarioId];

            if (!scenario || !projection) return null;

            // Calculate average difference
            let totalDiff = 0;
            let positiveDays = 0;
            let negativeDays = 0;

            projection.cal.slice(0, days).forEach((day, idx) => {
              const baselineDay = baselineProjection.cal[idx];
              if (baselineDay) {
                const diff = day.running - baselineDay.running;
                totalDiff += diff;
                if (diff > 0) positiveDays++;
                else if (diff < 0) negativeDays++;
              }
            });

            const avgDiff = totalDiff / days;

            return (
              <div key={scenarioId} className="summary-card">
                <div className="summary-header">
                  <span
                    className="scenario-color-dot"
                    style={{ backgroundColor: scenario.color }}
                  />
                  <strong>{scenario.name}</strong>
                </div>
                <div className="summary-stats">
                  <div className="stat">
                    <span className="stat-label">Avg Difference:</span>
                    <span className={`stat-value ${avgDiff >= 0 ? 'positive' : 'negative'}`}>
                      {avgDiff >= 0 ? '+' : ''}
                      {fmtMoney(avgDiff)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Days Higher:</span>
                    <span className="stat-value">{positiveDays}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Days Lower:</span>
                    <span className="stat-value">{negativeDays}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
