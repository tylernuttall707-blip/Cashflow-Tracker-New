import React, { useState, useMemo } from 'react';
import { getMasterTransactionTable } from './transaction-utils';

/**
 * Cash Movements Page - Redesigned
 * Focuses on upcoming transactions and quick adding
 */
export function CashMovementsPage({ data, onDataChange }) {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    name: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    category: '',
    type: 'expense',
    recurring: false
  });
  const [daysToShow, setDaysToShow] = useState(30);

  // Get all transactions
  const allTransactions = useMemo(() => {
    return getMasterTransactionTable(data);
  }, [data]);

  // Filter to upcoming transactions only
  const upcomingTransactions = useMemo(() => {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + daysToShow);

    return allTransactions
      .filter(t => {
        const tDate = new Date(t.instanceDate);
        return tDate >= today && tDate <= futureDate;
      })
      .sort((a, b) => a.instanceDate.localeCompare(b.instanceDate));
  }, [allTransactions, daysToShow]);

  // Group by date
  const groupedByDate = useMemo(() => {
    const grouped = {};
    upcomingTransactions.forEach(transaction => {
      if (!grouped[transaction.instanceDate]) {
        grouped[transaction.instanceDate] = [];
      }
      grouped[transaction.instanceDate].push(transaction);
    });
    return grouped;
  }, [upcomingTransactions]);

  // Calculate running balance
  const runningBalance = useMemo(() => {
    let balance = data.settings.startingBalance || 0;
    
    // Add all past transactions
    allTransactions
      .filter(t => new Date(t.instanceDate) < new Date())
      .forEach(t => {
        balance += t.type === 'income' ? t.amount : -t.amount;
      });

    return balance;
  }, [allTransactions, data.settings.startingBalance]);

  // Calculate projected balance over next N days
  const projectedBalances = useMemo(() => {
    let balance = runningBalance;
    const balances = {};

    Object.keys(groupedByDate).forEach(date => {
      groupedByDate[date].forEach(t => {
        balance += t.type === 'income' ? t.amount : -t.amount;
      });
      balances[date] = balance;
    });

    return balances;
  }, [groupedByDate, runningBalance]);

  const handleQuickAdd = () => {
    if (!quickAddForm.name || !quickAddForm.amount) {
      alert('Please fill in name and amount');
      return;
    }

    const newTransaction = {
      id: generateId(),
      type: quickAddForm.type,
      name: quickAddForm.name,
      category: quickAddForm.category || 'Uncategorized',
      amount: parseFloat(quickAddForm.amount),
      recurring: quickAddForm.recurring,
      steps: [],
      escalatorPct: 0
    };

    if (quickAddForm.recurring) {
      // Add as recurring (you'd need more fields for this)
      newTransaction.frequency = 'monthly';
      newTransaction.startDate = quickAddForm.date;
      newTransaction.endDate = null;
      newTransaction.monthlyMode = 'day';
      newTransaction.dayOfMonth = new Date(quickAddForm.date).getDate();
    } else {
      // Add as one-time
      newTransaction.date = quickAddForm.date;
    }

    // Add to oneOffs array
    const updatedData = {
      ...data,
      oneOffs: [...data.oneOffs, newTransaction]
    };

    onDataChange(updatedData);

    // Reset form
    setQuickAddForm({
      name: '',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      category: '',
      type: 'expense',
      recurring: false
    });
    setShowQuickAdd(false);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        weekday: 'short'
      });
    }
  };

  const getBalanceColor = (balance) => {
    if (balance > 50000) return 'balance-healthy';
    if (balance > 20000) return 'balance-ok';
    if (balance > 0) return 'balance-warning';
    return 'balance-danger';
  };

  return (
    <div className="cash-movements-container">
      {/* Header */}
      <div className="page-header">
        <h1>Cash Movements</h1>
        <button 
          onClick={() => setShowQuickAdd(!showQuickAdd)}
          className="btn btn-primary"
        >
          + Quick Add
        </button>
      </div>

      {/* Current Balance Display */}
      <div className="balance-card">
        <div className="balance-label">Current Balance</div>
        <div className={`balance-amount ${getBalanceColor(runningBalance)}`}>
          {formatCurrency(runningBalance)}
        </div>
        <div className="balance-subtitle">
          As of {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Quick Add Form */}
      {showQuickAdd && (
        <div className="quick-add-card">
          <h3>Quick Add Transaction</h3>
          <div className="quick-add-form">
            <div className="form-row">
              <div className="form-group">
                <label>Type</label>
                <select 
                  value={quickAddForm.type}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, type: e.target.value })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={quickAddForm.name}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, name: e.target.value })}
                  placeholder="Transaction name"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  value={quickAddForm.amount}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  value={quickAddForm.date}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, date: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Category</label>
                <input
                  type="text"
                  value={quickAddForm.category}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, category: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={quickAddForm.recurring}
                    onChange={(e) => setQuickAddForm({ ...quickAddForm, recurring: e.target.checked })}
                  />
                  Recurring
                </label>
              </div>
            </div>

            <div className="form-actions">
              <button onClick={handleQuickAdd} className="btn btn-success">
                Add Transaction
              </button>
              <button onClick={() => setShowQuickAdd(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Controls */}
      <div className="view-controls">
        <label>Show next:</label>
        <select 
          value={daysToShow} 
          onChange={(e) => setDaysToShow(parseInt(e.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      {/* Upcoming Transactions Timeline */}
      <div className="timeline-container">
        <h2>Upcoming Transactions</h2>
        
        {Object.keys(groupedByDate).length === 0 ? (
          <div className="no-transactions">
            No upcoming transactions in the next {daysToShow} days.
          </div>
        ) : (
          Object.keys(groupedByDate).map(date => (
            <div key={date} className="timeline-day">
              {/* Date Header */}
              <div className="timeline-date">
                <div className="date-badge">
                  <div className="date-label">{formatDate(date)}</div>
                  <div className="date-full">{new Date(date).toLocaleDateString()}</div>
                </div>
                <div className="projected-balance">
                  <span className="balance-label-small">Balance:</span>
                  <span className={`balance-value ${getBalanceColor(projectedBalances[date])}`}>
                    {formatCurrency(projectedBalances[date])}
                  </span>
                </div>
              </div>

              {/* Transactions for this date */}
              <div className="timeline-transactions">
                {groupedByDate[date].map(transaction => (
                  <div 
                    key={transaction.id}
                    className={`transaction-item ${transaction.type}`}
                  >
                    <div className="transaction-icon">
                      {transaction.type === 'income' ? '💰' : '💸'}
                    </div>
                    <div className="transaction-details">
                      <div className="transaction-name">{transaction.name}</div>
                      <div className="transaction-category">{transaction.category}</div>
                      {transaction.isModified && (
                        <span className="modified-badge">Modified</span>
                      )}
                    </div>
                    <div className={`transaction-amount ${transaction.type}`}>
                      {transaction.type === 'income' ? '+' : '-'}
                      {formatCurrency(Math.abs(transaction.amount))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Daily Summary */}
              <div className="day-summary">
                <div className="summary-item">
                  <span>Income:</span>
                  <span className="income-text">
                    +{formatCurrency(
                      groupedByDate[date]
                        .filter(t => t.type === 'income')
                        .reduce((sum, t) => sum + t.amount, 0)
                    )}
                  </span>
                </div>
                <div className="summary-item">
                  <span>Expenses:</span>
                  <span className="expense-text">
                    -{formatCurrency(
                      groupedByDate[date]
                        .filter(t => t.type === 'expense')
                        .reduce((sum, t) => sum + t.amount, 0)
                    )}
                  </span>
                </div>
                <div className="summary-item net">
                  <span>Net:</span>
                  <span className={
                    groupedByDate[date].reduce((sum, t) => 
                      sum + (t.type === 'income' ? t.amount : -t.amount), 0
                    ) >= 0 ? 'income-text' : 'expense-text'
                  }>
                    {formatCurrency(
                      groupedByDate[date].reduce((sum, t) => 
                        sum + (t.type === 'income' ? t.amount : -t.amount), 0
                      )
                    )}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Styling
 */
const styles = `
.cash-movements-container {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.balance-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 2rem;
  border-radius: 12px;
  text-align: center;
  margin-bottom: 2rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.balance-label {
  font-size: 0.875rem;
  opacity: 0.9;
  margin-bottom: 0.5rem;
}

.balance-amount {
  font-size: 3rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.balance-subtitle {
  font-size: 0.875rem;
  opacity: 0.8;
}

.quick-add-card {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.quick-add-form {
  margin-top: 1rem;
}

.form-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.form-group {
  flex: 1;
}

.form-group label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: #374151;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

.checkbox-group {
  display: flex;
  align-items: flex-end;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.form-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1.5rem;
}

.view-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.timeline-container {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
}

.timeline-day {
  margin-bottom: 2rem;
  border-left: 3px solid #e5e7eb;
  padding-left: 1.5rem;
}

.timeline-date {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.date-badge {
  background: #f3f4f6;
  padding: 0.5rem 1rem;
  border-radius: 8px;
}

.date-label {
  font-weight: 600;
  font-size: 1.125rem;
}

.date-full {
  font-size: 0.75rem;
  color: #6b7280;
}

.projected-balance {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.balance-label-small {
  font-size: 0.875rem;
  color: #6b7280;
}

.balance-value {
  font-weight: 600;
  font-size: 1.125rem;
}

.balance-healthy {
  color: #22c55e;
}

.balance-ok {
  color: #3b82f6;
}

.balance-warning {
  color: #f59e0b;
}

.balance-danger {
  color: #ef4444;
}

.timeline-transactions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.transaction-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
}

.transaction-item.income {
  background: #f0fdf4;
  border-color: #86efac;
}

.transaction-item.expense {
  background: #fef2f2;
  border-color: #fca5a5;
}

.transaction-icon {
  font-size: 1.5rem;
}

.transaction-details {
  flex: 1;
}

.transaction-name {
  font-weight: 600;
}

.transaction-category {
  font-size: 0.875rem;
  color: #6b7280;
}

.modified-badge {
  display: inline-block;
  background: #fef3c7;
  color: #92400e;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  margin-top: 0.25rem;
}

.transaction-amount {
  font-weight: bold;
  font-size: 1.125rem;
}

.transaction-amount.income {
  color: #22c55e;
}

.transaction-amount.expense {
  color: #ef4444;
}

.day-summary {
  display: flex;
  gap: 2rem;
  padding: 0.75rem;
  background: #f9fafb;
  border-radius: 4px;
  font-size: 0.875rem;
}

.summary-item {
  display: flex;
  gap: 0.5rem;
}

.summary-item.net {
  font-weight: 600;
}

.income-text {
  color: #22c55e;
  font-weight: 600;
}

.expense-text {
  color: #ef4444;
  font-weight: 600;
}

.no-transactions {
  text-align: center;
  padding: 3rem;
  color: #6b7280;
}

.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-success {
  background: #22c55e;
  color: white;
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
`;


