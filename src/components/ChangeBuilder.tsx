/**
 * ChangeBuilder Component - Visual interface for creating scenario changes
 */

import { useState } from 'react';
import type { ScenarioChange, ScenarioChangeType, TransactionType } from '../types';

interface ChangeBuilderProps {
  onAddChange: (change: ScenarioChange) => void;
  onCancel: () => void;
}

export function ChangeBuilder({ onAddChange, onCancel }: ChangeBuilderProps) {
  const [changeType, setChangeType] = useState<ScenarioChangeType>('income_adjust');
  const [description, setDescription] = useState('');

  // Income/Expense adjust fields
  const [percentChange, setPercentChange] = useState<number>(0);
  const [categoryFilter, setCategoryFilter] = useState('');

  // Transaction modify fields
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [amountMultiplier, setAmountMultiplier] = useState<number | ''>('');
  const [useMultiplier, setUseMultiplier] = useState(false);

  // Bulk adjustment fields
  const [typeFilter, setTypeFilter] = useState<TransactionType | ''>('');

  // Setting override fields
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startingBalance, setStartingBalance] = useState<number | ''>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const change: ScenarioChange = {
      id: crypto.randomUUID(),
      type: changeType,
      description: description || getDefaultDescription(),
      changes: {},
    };

    // Build changes object based on type
    switch (changeType) {
      case 'income_adjust':
        change.targetType = 'income';
        change.changes.percentChange = percentChange;
        break;

      case 'expense_adjust':
        change.targetType = 'expense';
        change.changes.percentChange = percentChange;
        if (categoryFilter) {
          change.changes.categoryFilter = categoryFilter;
        }
        break;

      case 'bulk_adjustment':
        change.changes.percentChange = percentChange;
        if (categoryFilter) {
          change.changes.categoryFilter = categoryFilter;
        }
        if (typeFilter) {
          change.changes.typeFilter = typeFilter;
        }
        break;

      case 'transaction_modify':
        if (!targetId) {
          alert('Transaction ID is required for modification');
          return;
        }
        change.targetId = targetId;
        change.targetType = 'transaction';
        if (useMultiplier && amountMultiplier !== '') {
          change.changes.amountMultiplier = Number(amountMultiplier);
        } else if (amount !== '') {
          change.changes.amount = Number(amount);
        }
        break;

      case 'transaction_remove':
        if (!targetId) {
          alert('Transaction ID is required for removal');
          return;
        }
        change.targetId = targetId;
        change.targetType = 'transaction';
        break;

      case 'setting_override':
        change.targetType = 'setting';
        if (startDate) change.changes.startDate = startDate;
        if (endDate) change.changes.endDate = endDate;
        if (startingBalance !== '') change.changes.startingBalance = Number(startingBalance);
        break;
    }

    onAddChange(change);
    resetForm();
  };

  const resetForm = () => {
    setDescription('');
    setPercentChange(0);
    setCategoryFilter('');
    setTargetId('');
    setAmount('');
    setAmountMultiplier('');
    setTypeFilter('');
    setStartDate('');
    setEndDate('');
    setStartingBalance('');
  };

  const getDefaultDescription = (): string => {
    switch (changeType) {
      case 'income_adjust':
        return `Adjust all income by ${percentChange > 0 ? '+' : ''}${percentChange}%`;
      case 'expense_adjust':
        return `Adjust ${categoryFilter || 'all'} expenses by ${percentChange > 0 ? '+' : ''}${percentChange}%`;
      case 'bulk_adjustment':
        return `Bulk adjust by ${percentChange > 0 ? '+' : ''}${percentChange}%`;
      case 'transaction_modify':
        return `Modify transaction ${targetId}`;
      case 'transaction_remove':
        return `Remove transaction ${targetId}`;
      case 'setting_override':
        return 'Override settings';
      default:
        return 'New change';
    }
  };

  return (
    <div className="change-builder card">
      <div className="card-header">
        <h3>Add Change to Scenario</h3>
        <button onClick={onCancel} className="btn btn-sm btn-outline">
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="change-builder-form">
        {/* Change Type Selection */}
        <div className="form-group">
          <label htmlFor="changeType">Change Type</label>
          <select
            id="changeType"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value as ScenarioChangeType)}
            className="form-control"
          >
            <option value="income_adjust">Income Adjustment</option>
            <option value="expense_adjust">Expense Adjustment</option>
            <option value="bulk_adjustment">Bulk Adjustment</option>
            <option value="transaction_modify">Modify Transaction</option>
            <option value="transaction_remove">Remove Transaction</option>
            <option value="setting_override">Override Settings</option>
          </select>
        </div>

        {/* Description */}
        <div className="form-group">
          <label htmlFor="description">Description (optional)</label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={getDefaultDescription()}
            className="form-control"
          />
        </div>

        {/* Income/Expense/Bulk Adjustment Fields */}
        {(changeType === 'income_adjust' ||
          changeType === 'expense_adjust' ||
          changeType === 'bulk_adjustment') && (
          <>
            <div className="form-group">
              <label htmlFor="percentChange">Percent Change (%)</label>
              <div className="input-with-slider">
                <input
                  id="percentChange"
                  type="number"
                  value={percentChange}
                  onChange={(e) => setPercentChange(Number(e.target.value))}
                  step="1"
                  min="-100"
                  max="200"
                  className="form-control"
                />
                <input
                  type="range"
                  value={percentChange}
                  onChange={(e) => setPercentChange(Number(e.target.value))}
                  min="-100"
                  max="200"
                  step="1"
                  className="form-range"
                />
              </div>
              <small className="form-help">
                {percentChange > 0 ? '+' : ''}
                {percentChange}% (multiply by {(1 + percentChange / 100).toFixed(2)}x)
              </small>
            </div>

            {(changeType === 'expense_adjust' || changeType === 'bulk_adjustment') && (
              <div className="form-group">
                <label htmlFor="categoryFilter">Category Filter (optional)</label>
                <input
                  id="categoryFilter"
                  type="text"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  placeholder="e.g., Rent, Utilities"
                  className="form-control"
                />
                <small className="form-help">Leave empty to affect all categories</small>
              </div>
            )}

            {changeType === 'bulk_adjustment' && (
              <div className="form-group">
                <label htmlFor="typeFilter">Type Filter (optional)</label>
                <select
                  id="typeFilter"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TransactionType | '')}
                  className="form-control"
                >
                  <option value="">All Types</option>
                  <option value="income">Income Only</option>
                  <option value="expense">Expense Only</option>
                </select>
              </div>
            )}
          </>
        )}

        {/* Transaction Modify Fields */}
        {changeType === 'transaction_modify' && (
          <>
            <div className="form-group">
              <label htmlFor="targetId">Transaction ID *</label>
              <input
                id="targetId"
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="Enter transaction ID"
                className="form-control"
                required
              />
              <small className="form-help">Find transaction IDs in All Transactions tab</small>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={useMultiplier}
                  onChange={(e) => setUseMultiplier(e.target.checked)}
                />
                {' '}Use Multiplier (instead of absolute amount)
              </label>
            </div>

            {useMultiplier ? (
              <div className="form-group">
                <label htmlFor="amountMultiplier">Amount Multiplier</label>
                <input
                  id="amountMultiplier"
                  type="number"
                  value={amountMultiplier}
                  onChange={(e) => setAmountMultiplier(e.target.value === '' ? '' : Number(e.target.value))}
                  step="0.1"
                  placeholder="e.g., 1.5 for 50% increase"
                  className="form-control"
                />
                <small className="form-help">e.g., 1.1 = +10%, 0.9 = -10%</small>
              </div>
            ) : (
              <div className="form-group">
                <label htmlFor="amount">New Amount</label>
                <input
                  id="amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  step="0.01"
                  placeholder="Enter new amount"
                  className="form-control"
                />
              </div>
            )}
          </>
        )}

        {/* Transaction Remove Fields */}
        {changeType === 'transaction_remove' && (
          <div className="form-group">
            <label htmlFor="targetId">Transaction ID *</label>
            <input
              id="targetId"
              type="text"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="Enter transaction ID"
              className="form-control"
              required
            />
            <small className="form-help">Find transaction IDs in All Transactions tab</small>
          </div>
        )}

        {/* Setting Override Fields */}
        {changeType === 'setting_override' && (
          <>
            <div className="form-group">
              <label htmlFor="startDate">Override Start Date</label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label htmlFor="endDate">Override End Date</label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="form-control"
              />
            </div>

            <div className="form-group">
              <label htmlFor="startingBalance">Override Starting Balance</label>
              <input
                id="startingBalance"
                type="number"
                value={startingBalance}
                onChange={(e) => setStartingBalance(e.target.value === '' ? '' : Number(e.target.value))}
                step="0.01"
                placeholder="Enter new starting balance"
                className="form-control"
              />
            </div>
          </>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            Add Change
          </button>
          <button type="button" onClick={onCancel} className="btn btn-outline">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
