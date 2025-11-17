/**
 * Cash Movements Tab Component - One-off and recurring transactions
 */

import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Transaction, OneOffTransaction, RecurringTransaction, Frequency } from '../types';
import { fmtMoney } from '../modules/calculations';
import { fromYMD } from '../modules/dateUtils';
import { deduplicateTransactions } from '../modules/transactions';

interface FormData {
  type?: 'income' | 'expense';
  name?: string;
  category?: string;
  amount?: number;
  date?: string;
  frequency?: Frequency;
  startDate?: string;
  endDate?: string;
  escalatorPct?: number;
  skipWeekends?: boolean;
  dayOfWeek?: number[];
  monthlyMode?: 'day' | 'nth';
  dayOfMonth?: number;
  nthWeek?: string;
  nthWeekday?: number;
  steps?: any[];
}

export function CashMovements() {
  const { oneOffs, addOneOff, updateOneOff, removeOneOff, setOneOffs } = useAppStore();

  // Form state
  const [isRecurring, setIsRecurring] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    type: 'expense',
    frequency: 'monthly',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const transaction: Transaction = isRecurring
      ? ({
          id: editingId || crypto.randomUUID(),
          name: formData.name || '',
          category: formData.category || '',
          amount: formData.amount || 0,
          type: formData.type || 'expense',
          recurring: true,
          frequency: formData.frequency || 'monthly',
          startDate: formData.startDate || '',
          endDate: formData.endDate || '',
          steps: formData.steps || [],
          escalatorPct: formData.escalatorPct || 0,
          skipWeekends: formData.skipWeekends,
          dayOfWeek: formData.dayOfWeek,
          monthlyMode: formData.monthlyMode,
          dayOfMonth: formData.dayOfMonth,
          nthWeek: formData.nthWeek,
          nthWeekday: formData.nthWeekday,
        } as RecurringTransaction)
      : ({
          id: editingId || crypto.randomUUID(),
          name: formData.name || '',
          category: formData.category || '',
          amount: formData.amount || 0,
          type: formData.type || 'expense',
          date: formData.date || '',
          recurring: false,
          steps: [],
          escalatorPct: 0,
        } as OneOffTransaction);

    if (editingId) {
      updateOneOff(editingId, transaction);
      setEditingId(null);
    } else {
      addOneOff(transaction);
    }

    resetForm();
  };

  const resetForm = () => {
    setFormData({
      type: 'expense',
      frequency: 'monthly',
    });
    setIsRecurring(false);
    setEditingId(null);
  };

  const handleEdit = (transaction: Transaction) => {
    setFormData(transaction);
    setIsRecurring(transaction.recurring);
    setEditingId(transaction.id);
  };

  const handleRemove = (id: string) => {
    if (confirm('Delete this transaction?')) {
      removeOneOff(id);
    }
  };

  const handleDeduplicate = () => {
    const deduplicated = deduplicateTransactions(oneOffs);
    const removedCount = oneOffs.length - deduplicated.length;
    if (removedCount > 0) {
      if (confirm(`Remove ${removedCount} duplicate transaction(s)?`)) {
        setOneOffs(deduplicated);
      }
    } else {
      alert('No duplicates found!');
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

  const getScheduleLabel = (tx: Transaction): string => {
    if (!tx.recurring) return 'One-time';
    return tx.frequency.charAt(0).toUpperCase() + tx.frequency.slice(1);
  };

  return (
    <section id="movements" className="tab-panel active">
      <div className="card">
        <div className="card-header">
          <h2>One-Off Transactions</h2>
          <div className="header-actions">
            <button onClick={handleDeduplicate} className="btn btn-outline">
              Remove Duplicates
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="form grid-4">
          <div className="field">
            <label htmlFor="ooDate">Date</label>
            <input
              id="ooDate"
              type="date"
              value={formData.date || ''}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required={!isRecurring}
            />
          </div>
          <div className="field">
            <label htmlFor="ooType">Type</label>
            <select
              id="ooType"
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as 'income' | 'expense' })}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ooName">Description</label>
            <input
              id="ooName"
              type="text"
              placeholder="Rent, AR payment, etc."
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="ooCategory">Category</label>
            <input
              id="ooCategory"
              type="text"
              placeholder="Ops, AR, etc."
              value={formData.category || ''}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ooAmount">Amount</label>
            <input
              id="ooAmount"
              type="number"
              step="0.01"
              value={formData.amount || ''}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
              required
            />
          </div>
          <div className="field">
            <label>
              <input
                id="ooRepeats"
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
              />{' '}
              Repeats?
            </label>
          </div>

          {isRecurring && (
            <>
              <div className="field">
                <label htmlFor="ooFreq">Frequency</label>
                <select
                  id="ooFreq"
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as Frequency })}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="ooStart">Start Date</label>
                <input
                  id="ooStart"
                  type="date"
                  value={formData.startDate || ''}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="ooEnd">End Date</label>
                <input
                  id="ooEnd"
                  type="date"
                  value={formData.endDate || ''}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="ooEscalator">Monthly Escalator (%)</label>
                <input
                  id="ooEscalator"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 2 for 2%"
                  value={formData.escalatorPct || ''}
                  onChange={(e) => setFormData({ ...formData, escalatorPct: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </>
          )}

          <div className="actions">
            <button className="btn" type="submit">
              {editingId ? 'Update' : 'Add'}
            </button>
            {editingId && (
              <button className="btn btn-outline" type="button" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <table className="table" id="oneOffTable">
          <thead>
            <tr>
              <th>Base Date</th>
              <th>Schedule</th>
              <th>Type</th>
              <th>Description</th>
              <th>Category</th>
              <th className="num">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {oneOffs.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.recurring ? fmtDate(tx.startDate) : fmtDate(tx.date)}</td>
                <td>{getScheduleLabel(tx)}</td>
                <td>{tx.type}</td>
                <td>{tx.name}</td>
                <td>{tx.category}</td>
                <td className="num">{fmtMoney(tx.amount)}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => handleEdit(tx)}>
                    Edit
                  </button>
                  <button className="btn btn-sm" onClick={() => handleRemove(tx.id)}>
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
