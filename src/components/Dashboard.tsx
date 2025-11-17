/**
 * Dashboard Tab Component
 */

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { computeProjection, fmtMoney } from '../modules/calculations';
import { fromYMD } from '../modules/dateUtils';
import { renderBalanceChart } from '../utils/chartUtils';
import type { ProjectionResult, Adjustment } from '../types';

export function Dashboard() {
  const { settings, adjustments, oneOffs, incomeStreams, updateSettings, addAdjustment, removeAdjustment } = useAppStore();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<any>(null);

  // State for adjustment form
  const [adjDate, setAdjDate] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');

  // Calculate projection whenever data changes
  useEffect(() => {
    try {
      const result = computeProjection({
        settings,
        adjustments,
        oneOffs,
        incomeStreams,
        expandedTransactions: [],
        ui: {
          oneOffSort: { key: 'date', direction: 'asc' },
          expandedSort: { key: 'date', direction: 'asc' },
        },
      });
      setProjection(result);
    } catch (err) {
      console.error('Projection calculation failed:', err);
    }
  }, [settings, adjustments, oneOffs, incomeStreams]);

  // Render chart when projection changes
  useEffect(() => {
    if (projection && chartCanvasRef.current) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
      chartInstanceRef.current = renderBalanceChart(chartCanvasRef.current, projection);
    }
  }, [projection]);

  const handleSettingsSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    updateSettings({
      startDate: formData.get('startDate') as string,
      endDate: formData.get('endDate') as string,
      startingBalance: parseFloat(formData.get('startingBalance') as string),
    });
  };

  const handleAdjustmentSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adjDate || !adjAmount) return;

    const adjustment: Adjustment = {
      date: adjDate,
      amount: parseFloat(adjAmount),
      note: adjNote || undefined,
    };

    addAdjustment(adjustment);
    setAdjDate('');
    setAdjAmount('');
    setAdjNote('');
  };

  const handleRemoveAdjustment = (date: string) => {
    if (confirm('Remove this adjustment?')) {
      removeAdjustment(date);
    }
  };

  const fmtDate = (ymd: string): string => {
    if (!ymd) return '';
    try {
      const d = fromYMD(ymd);
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ymd;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return ymd;
    }
  };

  // Get upcoming 14 days
  const upcomingDays = projection?.cal.slice(0, 14) || [];

  return (
    <section id="dashboard" className="tab-panel active">
      <div className="card grid-2">
        <form onSubmit={handleSettingsSubmit} className="form">
          <h2>Model Settings</h2>
          <div className="field">
            <label htmlFor="startDate">Start Date</label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={settings.startDate}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="endDate">End Date</label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={settings.endDate}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="startingBalance">Starting Balance</label>
            <input
              id="startingBalance"
              name="startingBalance"
              type="number"
              step="0.01"
              defaultValue={settings.startingBalance}
              required
            />
          </div>
          <div className="actions">
            <button type="submit" className="btn">
              Recalculate
            </button>
          </div>
        </form>

        <div className="kpis">
          <h2>Quick Stats</h2>
          {projection && (
            <>
              <div className="kpi">
                <div className="kpi-label">Projected End Balance</div>
                <div className="kpi-value">{fmtMoney(projection.endBalance)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Total Planned Income</div>
                <div className="kpi-value">{fmtMoney(projection.totalIncome)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Projected Weekly Income</div>
                <div className="kpi-value">{fmtMoney(projection.projectedWeeklyIncome)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Total Planned Expenses</div>
                <div className="kpi-value">{fmtMoney(projection.totalExpenses)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Lowest Projected Balance</div>
                <div className="kpi-value">{fmtMoney(projection.lowestBalance)}</div>
                <div className="kpi-meta">{fmtDate(projection.lowestBalanceDate)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Peak Projected Balance</div>
                <div className="kpi-value">{fmtMoney(projection.peakBalance)}</div>
                <div className="kpi-meta">{fmtDate(projection.peakBalanceDate)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Days Below $0</div>
                <div className="kpi-value">{projection.negativeDays}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">First Negative Day</div>
                <div className="kpi-value">
                  {projection.firstNegativeDate ? fmtDate(projection.firstNegativeDate) : '—'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Projected Balance</h2>
        <canvas ref={chartCanvasRef} id="balanceChart" height="100"></canvas>
      </div>

      <div className="card">
        <div>
          <h2>Upcoming 14 Days</h2>
          <table className="table" id="upcomingTable">
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
              {upcomingDays.map((day) => (
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

        <div>
          <h2>Adjustments</h2>
          <form onSubmit={handleAdjustmentSubmit} className="form compact">
            <div className="field">
              <label htmlFor="adjDate">Date</label>
              <input
                id="adjDate"
                type="date"
                value={adjDate}
                onChange={(e) => setAdjDate(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="adjAmount">Amount (+/−)</label>
              <input
                id="adjAmount"
                type="number"
                step="0.01"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="adjNote">Note</label>
              <input
                id="adjNote"
                type="text"
                placeholder="Reconcile to bank, etc."
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
              />
            </div>
            <div className="actions">
              <button className="btn" type="submit">
                Add Adjustment
              </button>
            </div>
          </form>
          <table className="table" id="adjTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((adj) => (
                <tr key={adj.date}>
                  <td>{fmtDate(adj.date)}</td>
                  <td>{fmtMoney(adj.amount)}</td>
                  <td>{adj.note || '—'}</td>
                  <td>
                    <button
                      className="btn btn-sm"
                      onClick={() => handleRemoveAdjustment(adj.date)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
