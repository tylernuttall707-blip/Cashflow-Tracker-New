/**
 * What-If Tab Component - Scenario planning and comparison
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeProjection, fmtMoney } from '../modules/calculations';
import { fromYMD } from '../modules/dateUtils';
import type { ProjectionResult, WhatIfTweaks } from '../types';

export function WhatIf() {
  const { settings, adjustments, oneOffs, incomeStreams } = useAppStore();
  const [actualProjection, setActualProjection] = useState<ProjectionResult | null>(null);
  const [whatIfProjection, setWhatIfProjection] = useState<ProjectionResult | null>(null);

  const [tweaks, setTweaks] = useState<WhatIfTweaks>({
    global: {
      pct: 0,
      delta: 0,
      lastEdited: 'pct',
    },
    streams: {},
    sale: {
      enabled: false,
      entries: [],
    },
    startDate: settings.startDate,
    endDate: settings.endDate,
  });

  // Calculate actual projection
  useEffect(() => {
    try {
      const result = computeProjection({
        settings,
        adjustments,
        oneOffs,
        incomeStreams,
        ui: { oneOffSort: { key: 'date', direction: 'asc' } },
      });
      setActualProjection(result);
    } catch (err) {
      console.error('Actual projection calculation failed:', err);
    }
  }, [settings, adjustments, oneOffs, incomeStreams]);

  // Calculate what-if projection with tweaks
  useEffect(() => {
    try {
      // Apply global tweaks to income streams
      const tweakedStreams = incomeStreams.map((stream) => {
        const streamTweak = tweaks.streams[stream.id];
        let multiplier = 1;

        if (streamTweak) {
          if (streamTweak.lastEdited === 'pct') {
            multiplier = 1 + streamTweak.pct / 100;
          } else if (streamTweak.lastEdited === 'delta') {
            const newAmount = stream.amount + streamTweak.delta;
            multiplier = newAmount / stream.amount;
          }
        } else {
          // Apply global tweak
          if (tweaks.global.lastEdited === 'pct') {
            multiplier = 1 + tweaks.global.pct / 100;
          } else if (tweaks.global.lastEdited === 'delta') {
            const newAmount = stream.amount + tweaks.global.delta;
            multiplier = newAmount / stream.amount;
          }
        }

        return {
          ...stream,
          amount: stream.amount * multiplier,
        };
      });

      const result = computeProjection({
        settings: {
          ...settings,
          startDate: tweaks.startDate,
          endDate: tweaks.endDate,
        },
        adjustments,
        oneOffs,
        incomeStreams: tweakedStreams,
        ui: { oneOffSort: { key: 'date', direction: 'asc' } },
      });
      setWhatIfProjection(result);
    } catch (err) {
      console.error('What-if projection calculation failed:', err);
    }
  }, [settings, adjustments, oneOffs, incomeStreams, tweaks]);

  const handlePullFromActuals = () => {
    if (confirm('Pull current actuals into What-If scenario?')) {
      setTweaks({
        global: {
          pct: 0,
          delta: 0,
          lastEdited: 'pct',
        },
        streams: {},
        sale: {
          enabled: false,
          entries: [],
        },
        startDate: settings.startDate,
        endDate: settings.endDate,
      });
    }
  };

  const handleGlobalPctChange = (pct: number) => {
    setTweaks({
      ...tweaks,
      global: {
        ...tweaks.global,
        pct,
        lastEdited: 'pct',
      },
    });
  };

  const handleGlobalDeltaChange = (delta: number) => {
    setTweaks({
      ...tweaks,
      global: {
        ...tweaks.global,
        delta,
        lastEdited: 'delta',
      },
    });
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

  const fmtDelta = (val: number): string => {
    const sign = val >= 0 ? '+' : '';
    return `${sign}${fmtMoney(val)}`;
  };

  return (
    <section id="whatif" className="tab-panel active">
      <div className="card">
        <div className="card-header">
          <h2>What-If Quick Stats</h2>
          <div className="header-actions">
            <button onClick={handlePullFromActuals} className="btn btn-outline">
              Pull from Actuals
            </button>
          </div>
        </div>
        <div className="kpis whatif-kpis">
          {whatIfProjection && actualProjection && (
            <>
              <div className="kpi">
                <div className="kpi-label">Projected End Balance</div>
                <div className="kpi-value">{fmtMoney(whatIfProjection.endBalance)}</div>
                <div className="kpi-meta">Actual: {fmtMoney(actualProjection.endBalance)}</div>
                <div className="kpi-meta">
                  Δ vs Actual:{' '}
                  <span className="delta">
                    {fmtDelta(whatIfProjection.endBalance - actualProjection.endBalance)}
                  </span>
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Total Planned Income</div>
                <div className="kpi-value">{fmtMoney(whatIfProjection.totalIncome)}</div>
                <div className="kpi-meta">Actual: {fmtMoney(actualProjection.totalIncome)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Projected Weekly Income</div>
                <div className="kpi-value">{fmtMoney(whatIfProjection.projectedWeeklyIncome)}</div>
                <div className="kpi-meta">Actual: {fmtMoney(actualProjection.projectedWeeklyIncome)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Total Planned Expenses</div>
                <div className="kpi-value">{fmtMoney(whatIfProjection.totalExpenses)}</div>
                <div className="kpi-meta">Actual: {fmtMoney(actualProjection.totalExpenses)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Lowest Projected Balance</div>
                <div className="kpi-value">{fmtMoney(whatIfProjection.lowestBalance)}</div>
                <div className="kpi-meta">Actual: {fmtMoney(actualProjection.lowestBalance)}</div>
                <div className="kpi-meta">
                  Δ vs Actual:{' '}
                  <span className="delta">
                    {fmtDelta(whatIfProjection.lowestBalance - actualProjection.lowestBalance)}
                  </span>
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Days Below $0</div>
                <div className="kpi-value">{whatIfProjection.negativeDays}</div>
                <div className="kpi-meta">Actual: {actualProjection.negativeDays}</div>
                <div className="kpi-meta">
                  Δ vs Actual:{' '}
                  <span className="delta">{whatIfProjection.negativeDays - actualProjection.negativeDays}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>What-If Controls</h2>
        <div className="whatif-controls">
          <div className="whatif-control-block">
            <h3>What-If Model Dates</h3>
            <div className="whatif-fields">
              <label htmlFor="whatifStartDate">Start Date</label>
              <input
                id="whatifStartDate"
                type="date"
                value={tweaks.startDate}
                onChange={(e) => setTweaks({ ...tweaks, startDate: e.target.value })}
              />
            </div>
            <div className="whatif-fields">
              <label htmlFor="whatifEndDate">End Date</label>
              <input
                id="whatifEndDate"
                type="date"
                value={tweaks.endDate}
                onChange={(e) => setTweaks({ ...tweaks, endDate: e.target.value })}
              />
            </div>
          </div>

          <div className="whatif-control-block whatif-global-block">
            <h3>Global Tweaks</h3>
            <div className="whatif-global-grid">
              <label className="whatif-fields">
                <span>% tweak</span>
                <div className="whatif-percent-inputs">
                  <input
                    id="whatifGlobalPct"
                    type="number"
                    min="-100"
                    max="200"
                    step="1"
                    value={tweaks.global.pct}
                    onChange={(e) => handleGlobalPctChange(parseFloat(e.target.value) || 0)}
                  />
                  <input
                    id="whatifGlobalPctSlider"
                    type="range"
                    min="-100"
                    max="200"
                    step="1"
                    value={tweaks.global.pct}
                    onChange={(e) => handleGlobalPctChange(parseFloat(e.target.value))}
                  />
                </div>
              </label>
              <label className="whatif-fields">
                <span>$ tweak</span>
                <input
                  id="whatifGlobalDelta"
                  type="number"
                  step="0.01"
                  value={tweaks.global.delta}
                  onChange={(e) => handleGlobalDeltaChange(parseFloat(e.target.value) || 0)}
                />
              </label>
            </div>
            <div className="whatif-global-summary">
              {tweaks.global.pct !== 0 && (
                <p>
                  All income streams adjusted by {tweaks.global.pct > 0 ? '+' : ''}
                  {tweaks.global.pct}%
                </p>
              )}
              {tweaks.global.delta !== 0 && (
                <p>All income streams adjusted by {fmtDelta(tweaks.global.delta)}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>What-If 30-Day Outlook</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Income</th>
              <th>Expenses</th>
              <th>Net</th>
              <th>Running</th>
            </tr>
          </thead>
          <tbody>
            {whatIfProjection?.cal.slice(0, 30).map((day) => (
              <tr key={day.date}>
                <td>{fmtDate(day.date)}</td>
                <td>{fmtMoney(day.income)}</td>
                <td>{fmtMoney(day.expenses)}</td>
                <td>{fmtMoney(day.net)}</td>
                <td>{fmtMoney(day.running)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
