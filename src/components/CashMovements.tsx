/**
 * Redesigned Cash Movements Component - Quick Add + Upcoming Transactions
 */

import { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { ExpandedTransaction, Frequency } from '../types';
import { fromYMD, toYMD } from '../modules/dateUtils';
import { shouldApplyStreamOn } from '../modules/transactions';
import '../App.css';

interface QuickAddForm {
  type: 'income' | 'expense';
  name: string;
  category: string;
  amount: number;
  date: string;
  isRecurring: boolean;
  // Recurring fields
  frequency?: Frequency;
  startDate?: string;
  endDate?: string;
  dayOfWeek?: number[];
  skipWeekends?: boolean;
  monthlyMode?: 'day' | 'nth';
  dayOfMonth?: number;
  nthWeek?: string;
  nthWeekday?: number;
}

export function CashMovements() {
  const { expandedTransactions, addExpandedTransaction } = useAppStore();

  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState<QuickAddForm>({
    type: 'expense',
    name: '',
    category: '',
    amount: 0,
    date: today,
    isRecurring: false,
  });

  const [showUpcomingDays, setShowUpcomingDays] = useState(7);

  // Get categories for autocomplete
  const categories = useMemo((): string[] => {
    const cats = new Set(expandedTransactions.map((tx: ExpandedTransaction) => tx.category));
    return Array.from(cats).sort();
  }, [expandedTransactions]);

  // Get names for autocomplete
  const names = useMemo((): string[] => {
    const nameSet = new Set(expandedTransactions.map((tx: ExpandedTransaction) => tx.name));
    return Array.from(nameSet).sort();
  }, [expandedTransactions]);

  // Get upcoming transactions (next N days)
  const upcomingTransactions = useMemo((): ExpandedTransaction[] => {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + showUpcomingDays);
    const endDateStr = toYMD(endDate);

    return expandedTransactions
      .filter((tx: ExpandedTransaction) => tx.date >= today && tx.date <= endDateStr)
      .sort((a: ExpandedTransaction, b: ExpandedTransaction) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.name.localeCompare(b.name);
      });
  }, [expandedTransactions, showUpcomingDays, today]);

  // Group transactions by date
  const groupedUpcoming = useMemo(() => {
    const groups: Record<string, ExpandedTransaction[]> = {};
    upcomingTransactions.forEach((tx: ExpandedTransaction) => {
      if (!groups[tx.date]) {
        groups[tx.date] = [];
      }
      groups[tx.date].push(tx);
    });
    return groups;
  }, [upcomingTransactions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name || !form.category || form.amount <= 0) {
      alert('Please fill in all required fields');
      return;
    }

    if (form.isRecurring) {
      // Expand recurring transaction
      if (!form.startDate || !form.endDate || !form.frequency) {
        alert('Please fill in recurring transaction details');
        return;
      }

      const parentId = crypto.randomUUID();
      const instances = expandRecurringTransaction(parentId);

      if (instances.length === 0) {
        alert('No instances generated. Check your recurring settings.');
        return;
      }

      // Add all instances
      instances.forEach(instance => addExpandedTransaction(instance));
      alert(`Created ${instances.length} transaction instances`);
    } else {
      // Add single transaction
      const transaction: ExpandedTransaction = {
        id: crypto.randomUUID(),
        date: form.date,
        type: form.type,
        name: form.name,
        category: form.category,
        amount: form.amount,
        sourceType: 'one-off',
      };

      addExpandedTransaction(transaction);
    }

    resetForm();
  };

  const expandRecurringTransaction = (parentId: string): ExpandedTransaction[] => {
    if (!form.startDate || !form.endDate || !form.frequency) return [];

    const results: ExpandedTransaction[] = [];
    const start = fromYMD(form.startDate);
    const end = fromYMD(form.endDate);

    // Create a stream-like object for matching
    const stream = {
      frequency: form.frequency,
      startDate: form.startDate,
      endDate: form.endDate,
      onDate: null,
      skipWeekends: form.skipWeekends || false,
      dayOfWeek: form.dayOfWeek || [],
      dayOfMonth: form.dayOfMonth || 1,
      monthlyMode: form.monthlyMode || 'day',
      nthWeek: form.nthWeek || '1',
      nthWeekday: form.nthWeekday || 0,
    };

    for (let cursor = new Date(start.getTime()); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      if (shouldApplyStreamOn(cursor, stream)) {
        const dateYMD = toYMD(cursor);
        results.push({
          id: `${parentId}-${dateYMD}`,
          date: dateYMD,
          type: form.type,
          name: form.name,
          category: form.category,
          amount: form.amount,
          sourceType: 'recurring',
          parentId,
          parentName: form.name,
        });
      }
    }

    return results;
  };

  const resetForm = () => {
    setForm({
      type: 'expense',
      name: '',
      category: '',
      amount: 0,
      date: today,
      isRecurring: false,
    });
  };

  const formatDate = (dateStr: string) => {
    const dateObj = new Date(dateStr);
    const isToday = dateStr === today;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = dateStr === toYMD(tomorrow);

    if (isToday) return 'Today';
    if (isTomorrow) return 'Tomorrow';

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${dayNames[dateObj.getDay()]} ${dateStr}`;
  };

  return (
    <div className="cash-movements-new">
      {/* Quick Add Form */}
      <div className="quick-add-section">
        <h2>Quick Add Transaction</h2>
        <form onSubmit={handleSubmit} className="quick-add-form">
          <div className="form-row">
            <div className="form-group">
              <label>Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as 'income' | 'expense' })}
                className="form-input"
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </div>

            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                list="names-list"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="form-input"
                required
              />
              <datalist id="names-list">
                {names.map((name: string) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div className="form-group">
              <label>Category *</label>
              <input
                type="text"
                list="categories-list"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="form-input"
                required
              />
              <datalist id="categories-list">
                {categories.map((cat: string) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            <div className="form-group">
              <label>Amount *</label>
              <input
                type="number"
                value={form.amount || ''}
                onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                className="form-input"
                step="0.01"
                min="0"
                required
              />
            </div>

            {!form.isRecurring && (
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="form-input"
                  required
                />
              </div>
            )}
          </div>

          {/* Recurring checkbox */}
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
              />
              Make this a recurring transaction
            </label>
          </div>

          {/* Recurring fields */}
          {form.isRecurring && (
            <div className="recurring-fields">
              <div className="form-row">
                <div className="form-group">
                  <label>Frequency</label>
                  <select
                    value={form.frequency || 'monthly'}
                    onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
                    className="form-input"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Start Date *</label>
                  <input
                    type="date"
                    value={form.startDate || ''}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="form-input"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>End Date *</label>
                  <input
                    type="date"
                    value={form.endDate || ''}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="form-input"
                    required
                  />
                </div>
              </div>

              {(form.frequency === 'weekly' || form.frequency === 'biweekly') && (
                <div className="form-group">
                  <label>Days of Week</label>
                  <div className="days-of-week">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                      <label key={idx} className="day-checkbox">
                        <input
                          type="checkbox"
                          checked={(form.dayOfWeek || []).includes(idx)}
                          onChange={(e) => {
                            const days = form.dayOfWeek || [];
                            if (e.target.checked) {
                              setForm({ ...form, dayOfWeek: [...days, idx].sort() });
                            } else {
                              setForm({ ...form, dayOfWeek: days.filter(d => d !== idx) });
                            }
                          }}
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.frequency === 'monthly' && (
                <div className="form-group">
                  <label>Day of Month</label>
                  <input
                    type="number"
                    value={form.dayOfMonth || 1}
                    onChange={(e) => setForm({ ...form, dayOfMonth: parseInt(e.target.value) })}
                    className="form-input"
                    min="1"
                    max="31"
                  />
                </div>
              )}

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.skipWeekends || false}
                    onChange={(e) => setForm({ ...form, skipWeekends: e.target.checked })}
                  />
                  Skip weekends
                </label>
              </div>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {form.isRecurring ? 'Create Recurring Series' : 'Add Transaction'}
            </button>
            <button type="button" onClick={resetForm} className="btn btn-secondary">
              Reset
            </button>
          </div>
        </form>
      </div>

      {/* Upcoming Transactions */}
      <div className="upcoming-section">
        <div className="section-header">
          <h2>Upcoming Transactions</h2>
          <div className="view-controls">
            <select
              value={showUpcomingDays}
              onChange={(e) => setShowUpcomingDays(parseInt(e.target.value))}
              className="days-select"
            >
              <option value="7">Next 7 days</option>
              <option value="14">Next 14 days</option>
              <option value="30">Next 30 days</option>
              <option value="60">Next 60 days</option>
            </select>
            <a href="#" onClick={(e) => { e.preventDefault(); /* Switch to transactions tab */ }} className="view-all-link">
              View All Transactions →
            </a>
          </div>
        </div>

        {upcomingTransactions.length === 0 ? (
          <div className="no-upcoming">
            No upcoming transactions in the next {showUpcomingDays} days.
          </div>
        ) : (
          <div className="upcoming-list">
            {Object.entries(groupedUpcoming).map(([date, transactions]) => (
              <div key={date} className="upcoming-day">
                <div className="day-header">
                  <span className="day-date">{formatDate(date)}</span>
                  <span className="day-total">
                    {transactions.reduce((sum, tx) => {
                      return sum + (tx.type === 'income' ? tx.amount : -tx.amount);
                    }, 0).toFixed(2)}
                  </span>
                </div>
                <div className="day-transactions">
                  {transactions.map(tx => (
                    <div key={tx.id} className={`transaction-item ${tx.type}`}>
                      <div className="transaction-info">
                        <span className={`transaction-type-indicator ${tx.type}`}>
                          {tx.type === 'income' ? '+' : '-'}
                        </span>
                        <div className="transaction-details">
                          <div className="transaction-name">{tx.name}</div>
                          <div className="transaction-category">{tx.category}</div>
                          {tx.parentName && (
                            <div className="transaction-parent">from: {tx.parentName}</div>
                          )}
                        </div>
                      </div>
                      <div className={`transaction-amount ${tx.type}`}>
                        ${tx.amount.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .cash-movements-new {
          padding: 1rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .quick-add-section {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 2rem;
        }

        .quick-add-section h2 {
          margin-top: 0;
          margin-bottom: 1rem;
        }

        .quick-add-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .form-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }

        .form-group {
          display: flex;
          flex-direction: column;
        }

        .form-group label {
          margin-bottom: 0.25rem;
          font-weight: 500;
          font-size: 0.875rem;
        }

        .form-input {
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 1rem;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
        }

        .checkbox-label input[type="checkbox"] {
          width: auto;
          margin: 0;
        }

        .recurring-fields {
          background: #f8f9fa;
          padding: 1rem;
          border-radius: 4px;
          border-left: 3px solid #007bff;
        }

        .days-of-week {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .day-checkbox {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          cursor: pointer;
        }

        .day-checkbox input[type="checkbox"] {
          margin: 0;
        }

        .form-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 1rem;
        }

        .btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
          font-weight: 500;
        }

        .btn-primary {
          background: #007bff;
          color: white;
        }

        .btn-primary:hover {
          background: #0056b3;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
        }

        .btn-secondary:hover {
          background: #5a6268;
        }

        .upcoming-section {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 1.5rem;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .section-header h2 {
          margin: 0;
        }

        .view-controls {
          display: flex;
          gap: 1rem;
          align-items: center;
        }

        .days-select {
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .view-all-link {
          color: #007bff;
          text-decoration: none;
          font-weight: 500;
        }

        .view-all-link:hover {
          text-decoration: underline;
        }

        .no-upcoming {
          text-align: center;
          padding: 2rem;
          color: #666;
          font-style: italic;
        }

        .upcoming-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .upcoming-day {
          border: 1px solid #e9ecef;
          border-radius: 4px;
          overflow: hidden;
        }

        .day-header {
          background: #f8f9fa;
          padding: 0.75rem 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
        }

        .day-date {
          font-size: 1rem;
        }

        .day-total {
          font-size: 1.125rem;
          font-family: monospace;
        }

        .day-transactions {
          display: flex;
          flex-direction: column;
        }

        .transaction-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid #f0f0f0;
        }

        .transaction-item:last-child {
          border-bottom: none;
        }

        .transaction-item.income {
          background: #f0fdf4;
        }

        .transaction-item.expense {
          background: #fef2f2;
        }

        .transaction-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .transaction-type-indicator {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 1.125rem;
        }

        .transaction-type-indicator.income {
          background: #22c55e;
          color: white;
        }

        .transaction-type-indicator.expense {
          background: #ef4444;
          color: white;
        }

        .transaction-details {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .transaction-name {
          font-weight: 500;
        }

        .transaction-category {
          font-size: 0.875rem;
          color: #666;
        }

        .transaction-parent {
          font-size: 0.75rem;
          color: #999;
        }

        .transaction-amount {
          font-weight: 600;
          font-size: 1.125rem;
          font-family: monospace;
        }

        .transaction-amount.income {
          color: #22c55e;
        }

        .transaction-amount.expense {
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}
