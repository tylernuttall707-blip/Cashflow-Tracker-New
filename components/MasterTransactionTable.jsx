import React, { useState, useMemo } from 'react';
import { getMasterTransactionTable, saveOverride, deleteInstance, revertOverride } from './transaction-utils';

/**
 * Master Transaction Table Component
 * Shows all expanded transactions with edit capabilities
 */
export function MasterTransactionTable({ data, onDataChange }) {
  const [editingRow, setEditingRow] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'instanceDate', direction: 'asc' });
  const [filterType, setFilterType] = useState('all'); // 'all', 'income', 'expense'
  const [searchTerm, setSearchTerm] = useState('');

  // Get master table data
  const transactions = useMemo(() => {
    return getMasterTransactionTable(data);
  }, [data]);

  // Apply filters and sorting
  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(t => t.type === filterType);
    }

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [transactions, filterType, searchTerm, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleEdit = (transaction) => {
    setEditingRow({
      ...transaction,
      originalAmount: transaction.amount,
      originalDate: transaction.instanceDate
    });
  };

  const handleSaveEdit = () => {
    if (!editingRow) return;

    const modifications = {};
    
    // Check what changed
    if (editingRow.amount !== editingRow.originalAmount) {
      modifications.amount = parseFloat(editingRow.amount);
    }
    if (editingRow.instanceDate !== editingRow.originalDate) {
      modifications.date = editingRow.instanceDate;
    }
    if (editingRow.name !== transactions.find(t => t.id === editingRow.id)?.name) {
      modifications.name = editingRow.name;
    }
    if (editingRow.category !== transactions.find(t => t.id === editingRow.id)?.category) {
      modifications.category = editingRow.category;
    }

    // Save override
    const updatedData = saveOverride(
      data,
      editingRow.parentId,
      editingRow.originalDate,
      modifications
    );

    onDataChange(updatedData);
    setEditingRow(null);
  };

  const handleDelete = (transaction) => {
    if (!confirm(`Delete ${transaction.name} on ${transaction.instanceDate}?`)) {
      return;
    }

    const updatedData = deleteInstance(
      data,
      transaction.parentId,
      transaction.instanceDate
    );

    onDataChange(updatedData);
  };

  const handleRevert = (transaction) => {
    if (!transaction.overrideId) return;

    const updatedData = revertOverride(data, transaction.overrideId);
    onDataChange(updatedData);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="master-table-container">
      {/* Header with filters */}
      <div className="table-header">
        <h1>Master Transaction Table</h1>
        
        <div className="filters">
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          
          <select 
            value={filterType} 
            onChange={(e) => setFilterType(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Types</option>
            <option value="income">Income Only</option>
            <option value="expense">Expenses Only</option>
          </select>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="summary-stats">
        <div className="stat">
          <span className="stat-label">Total Transactions:</span>
          <span className="stat-value">{filteredTransactions.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Income:</span>
          <span className="stat-value income">
            {formatCurrency(
              filteredTransactions
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + t.amount, 0)
            )}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Expenses:</span>
          <span className="stat-value expense">
            {formatCurrency(
              filteredTransactions
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + t.amount, 0)
            )}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="master-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('instanceDate')}>
                Date {sortConfig.key === 'instanceDate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('name')}>
                Description {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('category')}>
                Category {sortConfig.key === 'category' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('amount')}>
                Amount {sortConfig.key === 'amount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('type')}>
                Type {sortConfig.key === 'type' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.map((transaction) => (
              <tr 
                key={transaction.id}
                className={`
                  ${transaction.type === 'income' ? 'income-row' : 'expense-row'}
                  ${transaction.isModified ? 'modified-row' : ''}
                `}
              >
                {editingRow?.id === transaction.id ? (
                  // Edit mode
                  <>
                    <td>
                      <input
                        type="date"
                        value={editingRow.instanceDate}
                        onChange={(e) => setEditingRow({ ...editingRow, instanceDate: e.target.value })}
                        className="edit-input"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={editingRow.name}
                        onChange={(e) => setEditingRow({ ...editingRow, name: e.target.value })}
                        className="edit-input"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={editingRow.category}
                        onChange={(e) => setEditingRow({ ...editingRow, category: e.target.value })}
                        className="edit-input"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={editingRow.amount}
                        onChange={(e) => setEditingRow({ ...editingRow, amount: e.target.value })}
                        className="edit-input"
                      />
                    </td>
                    <td>{transaction.type}</td>
                    <td>
                      {transaction.isRecurring ? (
                        transaction.isModified ? 'Recurring (Modified)' : 'Recurring'
                      ) : 'One-time'}
                    </td>
                    <td>
                      <button onClick={handleSaveEdit} className="btn btn-save">Save</button>
                      <button onClick={() => setEditingRow(null)} className="btn btn-cancel">Cancel</button>
                    </td>
                  </>
                ) : (
                  // View mode
                  <>
                    <td>{new Date(transaction.instanceDate).toLocaleDateString()}</td>
                    <td>{transaction.name}</td>
                    <td>{transaction.category}</td>
                    <td className={transaction.type === 'income' ? 'amount-income' : 'amount-expense'}>
                      {formatCurrency(transaction.amount)}
                    </td>
                    <td>
                      <span className={`badge badge-${transaction.type}`}>
                        {transaction.type}
                      </span>
                    </td>
                    <td>
                      {transaction.isRecurring ? (
                        transaction.isModified ? (
                          <span className="source-badge modified">
                            Recurring (Modified)
                          </span>
                        ) : (
                          <span className="source-badge recurring">
                            Recurring
                          </span>
                        )
                      ) : (
                        <span className="source-badge one-time">
                          One-time
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button 
                          onClick={() => handleEdit(transaction)} 
                          className="btn btn-edit"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        {transaction.isRecurring && (
                          <button 
                            onClick={() => handleDelete(transaction)} 
                            className="btn btn-delete"
                            title="Delete this instance"
                          >
                            🗑️
                          </button>
                        )}
                        {transaction.isModified && (
                          <button 
                            onClick={() => handleRevert(transaction)} 
                            className="btn btn-revert"
                            title="Revert to template"
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredTransactions.length === 0 && (
        <div className="no-results">
          No transactions found matching your filters.
        </div>
      )}
    </div>
  );
}

/**
 * Styling (CSS/Tailwind)
 * You'd add this to your stylesheet
 */
const styles = `
.master-table-container {
  padding: 2rem;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.filters {
  display: flex;
  gap: 1rem;
}

.search-input, .filter-select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.summary-stats {
  display: flex;
  gap: 2rem;
  margin-bottom: 2rem;
  padding: 1rem;
  background: #f5f5f5;
  border-radius: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.875rem;
  color: #666;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: bold;
}

.stat-value.income {
  color: #22c55e;
}

.stat-value.expense {
  color: #ef4444;
}

.table-wrapper {
  overflow-x: auto;
}

.master-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.master-table th {
  background: #f9fafb;
  padding: 0.75rem;
  text-align: left;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.master-table th:hover {
  background: #f3f4f6;
}

.master-table td {
  padding: 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}

.income-row {
  background: #f0fdf4;
}

.expense-row {
  background: #fef2f2;
}

.modified-row {
  border-left: 3px solid #f59e0b;
}

.amount-income {
  color: #22c55e;
  font-weight: 600;
}

.amount-expense {
  color: #ef4444;
  font-weight: 600;
}

.badge {
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-income {
  background: #dcfce7;
  color: #166534;
}

.badge-expense {
  background: #fee2e2;
  color: #991b1b;
}

.source-badge {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.source-badge.recurring {
  background: #dbeafe;
  color: #1e40af;
}

.source-badge.modified {
  background: #fef3c7;
  color: #92400e;
}

.source-badge.one-time {
  background: #f3f4f6;
  color: #374151;
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
}

.btn {
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
}

.btn-edit {
  background: #3b82f6;
  color: white;
}

.btn-delete {
  background: #ef4444;
  color: white;
}

.btn-revert {
  background: #f59e0b;
  color: white;
}

.btn-save {
  background: #22c55e;
  color: white;
}

.btn-cancel {
  background: #6b7280;
  color: white;
}

.edit-input {
  width: 100%;
  padding: 0.25rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

.no-results {
  text-align: center;
  padding: 3rem;
  color: #6b7280;
}
`;
