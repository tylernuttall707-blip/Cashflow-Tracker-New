/**
 * Income Plan Tab Component - Recurring income streams
 */

import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { IncomeStream, Frequency } from '../types';
import { fmtMoney } from '../modules/calculations';
import { fromYMD } from '../modules/dateUtils';

export function IncomePlan() {
  const { incomeStreams, addIncomeStream, updateIncomeStream, removeIncomeStream } = useAppStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<IncomeStream>>({
    frequency: 'weekly',
    skipWeekends: false,
    monthlyMode: 'day',
    dayOfMonth: 1,
    escalatorPct: 0,
    steps: [],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const stream: IncomeStream = {
      id: editingId || crypto.randomUUID(),
      name: formData.name || '',
      category: formData.category || '',
      amount: formData.amount || 0,
      frequency: formData.frequency || 'weekly',
      startDate: formData.startDate || '',
      endDate: formData.endDate || '',
      onDate: formData.onDate || null,
      skipWeekends: formData.skipWeekends || false,
      steps: formData.steps || [],
      escalatorPct: formData.escalatorPct || 0,
      dayOfWeek: formData.dayOfWeek,
      monthlyMode: formData.monthlyMode,
      dayOfMonth: formData.dayOfMonth,
      nthWeek: formData.nthWeek,
      nthWeekday: formData.nthWeekday,
    };

    if (editingId) {
      updateIncomeStream(editingId, stream);
      setEditingId(null);
    } else {
      addIncomeStream(stream);
    }

    resetForm();
  };

  const resetForm = () => {
    setFormData({
      frequency: 'weekly',
      skipWeekends: false,
      monthlyMode: 'day',
      dayOfMonth: 1,
      escalatorPct: 0,
      steps: [],
    });
    setEditingId(null);
  };

  const handleEdit = (stream: IncomeStream) => {
    setFormData(stream);
    setEditingId(stream.id);
  };

  const handleRemove = (id: string) => {
    if (confirm('Delete this income stream?')) {
      removeIncomeStream(id);
    }
  };

  const fmtDate = (ymd: string): string => {
    if (!ymd) return '';
    try {
      const d = fromYMD(ymd);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return ymd;
    }
  };

  const getScheduleLabel = (stream: IncomeStream): string => {
    if (stream.frequency === 'once') return `On ${fmtDate(stream.onDate || '')}`;

    let label = stream.frequency.charAt(0).toUpperCase() + stream.frequency.slice(1);

    if (stream.frequency === 'daily' && stream.skipWeekends) {
      label += ' (skip weekends)';
    }

    if ((stream.frequency === 'weekly' || stream.frequency === 'biweekly') && stream.dayOfWeek) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayNames = stream.dayOfWeek.map(d => days[d]).join(', ');
      label += ` on ${dayNames}`;
    }

    if (stream.frequency === 'monthly') {
      if (stream.monthlyMode === 'day' && stream.dayOfMonth) {
        label += ` on day ${stream.dayOfMonth}`;
      } else if (stream.monthlyMode === 'nth' && stream.nthWeek && stream.nthWeekday !== undefined) {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        label += ` on ${stream.nthWeek} ${days[stream.nthWeekday]}`;
      }
    }

    return label;
  };

  return (
    <section id="income" className="tab-panel active">
      <div className="card">
        <h2>Recurring Income Streams</h2>

        <form onSubmit={handleSubmit} className="form grid-4">
          <div className="field">
            <label htmlFor="stName">Name</label>
            <input
              id="stName"
              type="text"
              placeholder="Weekly sales, AR collections, etc."
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="stCategory">Category</label>
            <input
              id="stCategory"
              type="text"
              placeholder="Sales, AR, etc."
              value={formData.category || ''}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="stAmount">Amount</label>
            <input
              id="stAmount"
              type="number"
              step="0.01"
              value={formData.amount || ''}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="stEscalator">Monthly Escalator (%)</label>
            <input
              id="stEscalator"
              type="number"
              step="0.01"
              placeholder="e.g. 1.5"
              value={formData.escalatorPct || ''}
              onChange={(e) => setFormData({ ...formData, escalatorPct: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label htmlFor="stFreq">Frequency</label>
            <select
              id="stFreq"
              value={formData.frequency}
              onChange={(e) => setFormData({ ...formData, frequency: e.target.value as Frequency })}
            >
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {formData.frequency === 'once' && (
            <div className="field">
              <label htmlFor="stOnDate">On Date</label>
              <input
                id="stOnDate"
                type="date"
                value={formData.onDate || ''}
                onChange={(e) => setFormData({ ...formData, onDate: e.target.value })}
              />
            </div>
          )}

          {formData.frequency === 'daily' && (
            <div className="field">
              <label>
                <input
                  id="stSkipWeekends"
                  type="checkbox"
                  checked={formData.skipWeekends}
                  onChange={(e) => setFormData({ ...formData, skipWeekends: e.target.checked })}
                />{' '}
                Skip weekends
              </label>
            </div>
          )}

          {formData.frequency !== 'once' && (
            <>
              <div className="field">
                <label htmlFor="stStart">Start Date</label>
                <input
                  id="stStart"
                  type="date"
                  value={formData.startDate || ''}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="stEnd">End Date</label>
                <input
                  id="stEnd"
                  type="date"
                  value={formData.endDate || ''}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  required
                />
              </div>
            </>
          )}

          <div className="actions">
            <button className="btn" type="submit">
              {editingId ? 'Update Stream' : 'Add Stream'}
            </button>
            {editingId && (
              <button className="btn btn-outline" type="button" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <table className="table" id="streamsTable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Frequency</th>
              <th>Schedule</th>
              <th className="num">Amount</th>
              <th>Dates</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {incomeStreams.map((stream) => (
              <tr key={stream.id}>
                <td>{stream.name}</td>
                <td>{stream.category}</td>
                <td>{stream.frequency}</td>
                <td>{getScheduleLabel(stream)}</td>
                <td className="num">{fmtMoney(stream.amount)}</td>
                <td>
                  {stream.frequency !== 'once' && `${fmtDate(stream.startDate)} - ${fmtDate(stream.endDate)}`}
                  {stream.frequency === 'once' && fmtDate(stream.onDate || '')}
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => handleEdit(stream)}>
                    Edit
                  </button>
                  <button className="btn btn-sm" onClick={() => handleRemove(stream.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
