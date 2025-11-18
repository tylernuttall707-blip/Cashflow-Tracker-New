import { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { ExpandedTransaction, ExpandedSortKey } from '../types';
import '../App.css';

export function AllTransactions() {
  const {
    expandedTransactions,
    updateExpandedTransaction,
    removeExpandedTransaction,
    removeExpandedTransactions,
    ui,
    setExpandedSort,
  } = useAppStore();

  // Ensure expandedSort has a default value if undefined
  const expandedSort = ui.expandedSort || { key: 'date' as ExpandedSortKey, direction: 'asc' as const };

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ExpandedTransaction>>({});

  // Get unique source types for filter
  const sourceTypes = useMemo(() => {
    const types = new Set(expandedTransactions.map(tx => tx.sourceType));
    return Array.from(types).sort();
  }, [expandedTransactions]);

  // Filter and sort transactions
  const filteredAndSorted = useMemo(() => {
    let filtered = [...expandedTransactions];

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(tx =>
        tx.name.toLowerCase().includes(term) ||
        tx.category.toLowerCase().includes(term) ||
        tx.note?.toLowerCase().includes(term)
      );
    }

    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(tx => tx.type === filterType);
    }

    // Apply source filter
    if (filterSource !== 'all') {
      filtered = filtered.filter(tx => tx.sourceType === filterSource);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (expandedSort.key) {
        case 'date':
          comparison = a.date.localeCompare(b.date);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        case 'amount':
          comparison = a.amount - b.amount;
          break;
        case 'sourceType':
          comparison = a.sourceType.localeCompare(b.sourceType);
          break;
      }

      return expandedSort.direction === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [expandedTransactions, searchTerm, filterType, filterSource, expandedSort]);

  const handleSort = (key: ExpandedSortKey) => {
    setExpandedSort({
      key,
      direction: expandedSort.key === key && expandedSort.direction === 'asc' ? 'desc' : 'asc',
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredAndSorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSorted.map(tx => tx.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`Delete ${selectedIds.size} selected transaction(s)?`)) {
      removeExpandedTransactions(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const handleEdit = (tx: ExpandedTransaction) => {
    setEditingId(tx.id);
    setEditForm({ ...tx });
  };

  const handleSaveEdit = () => {
    if (!editingId || !editForm.date || !editForm.name || !editForm.category) return;

    const updated: ExpandedTransaction = {
      id: editingId,
      date: editForm.date,
      type: editForm.type || 'expense',
      name: editForm.name,
      category: editForm.category,
      amount: Number(editForm.amount) || 0,
      note: editForm.note,
      sourceType: editForm.sourceType || 'one-off',
      parentId: editForm.parentId,
      parentName: editForm.parentName,
      isEdited: true,
      originalAmount: editForm.originalAmount,
      source: editForm.source,
      status: editForm.status,
      company: editForm.company,
      invoice: editForm.invoice,
      dueDate: editForm.dueDate,
      confidencePct: editForm.confidencePct,
    };

    updateExpandedTransaction(editingId, updated);
    setEditingId(null);
    setEditForm({});
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this transaction?')) {
      removeExpandedTransaction(id);
      if (selectedIds.has(id)) {
        const newSelected = new Set(selectedIds);
        newSelected.delete(id);
        setSelectedIds(newSelected);
      }
    }
  };

  const getSortIcon = (key: ExpandedSortKey) => {
    if (expandedSort.key !== key) return '⇅';
    return expandedSort.direction === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="all-transactions">
      <div className="section-header">
        <h2>All Transactions</h2>
        <div className="transaction-stats">
          <span>{filteredAndSorted.length} transactions</span>
          {selectedIds.size > 0 && (
            <button onClick={handleBulkDelete} className="btn-danger">
              Delete {selectedIds.size} Selected
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="filters-row">
        <input
          type="text"
          placeholder="Search by name, category, or note..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as 'all' | 'income' | 'expense')}
          className="filter-select"
        >
          <option value="all">All Types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>

        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Sources</option>
          {sourceTypes.map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="transactions-table-container">
        <table className="transactions-table">
          <thead>
            <tr>
              <th className="col-checkbox">
                <input
                  type="checkbox"
                  checked={filteredAndSorted.length > 0 && selectedIds.size === filteredAndSorted.length}
                  onChange={handleSelectAll}
                />
              </th>
              <th className="col-date sortable" onClick={() => handleSort('date')}>
                Date {getSortIcon('date')}
              </th>
              <th className="col-type sortable" onClick={() => handleSort('type')}>
                Type {getSortIcon('type')}
              </th>
              <th className="col-name sortable" onClick={() => handleSort('name')}>
                Name {getSortIcon('name')}
              </th>
              <th className="col-category sortable" onClick={() => handleSort('category')}>
                Category {getSortIcon('category')}
              </th>
              <th className="col-amount sortable" onClick={() => handleSort('amount')}>
                Amount {getSortIcon('amount')}
              </th>
              <th className="col-source sortable" onClick={() => handleSort('sourceType')}>
                Source {getSortIcon('sourceType')}
              </th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td colSpan={8} className="no-data">
                  {expandedTransactions.length === 0
                    ? 'No transactions yet. Add some in the Cash Movements tab!'
                    : 'No transactions match your filters.'}
                </td>
              </tr>
            ) : (
              filteredAndSorted.map(tx => (
                <tr key={tx.id} className={selectedIds.has(tx.id) ? 'selected' : ''}>
                  {editingId === tx.id ? (
                    // Edit mode
                    <>
                      <td className="col-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(tx.id)}
                          onChange={() => handleSelectOne(tx.id)}
                        />
                      </td>
                      <td className="col-date">
                        <input
                          type="date"
                          value={editForm.date || ''}
                          onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                          className="edit-input"
                        />
                      </td>
                      <td className="col-type">
                        <select
                          value={editForm.type || 'expense'}
                          onChange={(e) => setEditForm({ ...editForm, type: e.target.value as 'income' | 'expense' })}
                          className="edit-input"
                        >
                          <option value="income">Income</option>
                          <option value="expense">Expense</option>
                        </select>
                      </td>
                      <td className="col-name">
                        <input
                          type="text"
                          value={editForm.name || ''}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="edit-input"
                        />
                      </td>
                      <td className="col-category">
                        <input
                          type="text"
                          value={editForm.category || ''}
                          onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          className="edit-input"
                        />
                      </td>
                      <td className="col-amount">
                        <input
                          type="number"
                          value={editForm.amount || ''}
                          onChange={(e) => setEditForm({ ...editForm, amount: Number(e.target.value) })}
                          className="edit-input"
                          step="0.01"
                          min="0"
                        />
                      </td>
                      <td className="col-source">
                        <span className="source-badge">{tx.sourceType}</span>
                        {tx.parentName && <div className="parent-name">from: {tx.parentName}</div>}
                      </td>
                      <td className="col-actions">
                        <button onClick={handleSaveEdit} className="btn-sm btn-success">Save</button>
                        <button onClick={handleCancelEdit} className="btn-sm btn-secondary">Cancel</button>
                      </td>
                    </>
                  ) : (
                    // View mode
                    <>
                      <td className="col-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(tx.id)}
                          onChange={() => handleSelectOne(tx.id)}
                        />
                      </td>
                      <td className="col-date">{tx.date}</td>
                      <td className="col-type">
                        <span className={`type-badge type-${tx.type}`}>{tx.type}</span>
                      </td>
                      <td className="col-name">
                        {tx.name}
                        {tx.note && <div className="note-preview">{tx.note}</div>}
                      </td>
                      <td className="col-category">{tx.category}</td>
                      <td className="col-amount">
                        <span className={tx.type === 'income' ? 'amount-income' : 'amount-expense'}>
                          ${tx.amount.toFixed(2)}
                        </span>
                        {tx.isEdited && <span className="edited-badge" title="Manually edited">✎</span>}
                      </td>
                      <td className="col-source">
                        <span className="source-badge">{tx.sourceType}</span>
                        {tx.parentName && <div className="parent-name">from: {tx.parentName}</div>}
                      </td>
                      <td className="col-actions">
                        <button onClick={() => handleEdit(tx)} className="btn-sm btn-primary">Edit</button>
                        <button onClick={() => handleDelete(tx.id)} className="btn-sm btn-danger">Delete</button>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        .all-transactions {
          padding: 1rem;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .transaction-stats {
          display: flex;
          gap: 1rem;
          align-items: center;
        }

        .filters-row {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }

        .search-input {
          flex: 1;
          min-width: 200px;
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .filter-select {
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          background: white;
        }

        .transactions-table-container {
          overflow-x: auto;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .transactions-table {
          width: 100%;
          border-collapse: collapse;
          background: white;
        }

        .transactions-table th {
          background: #f5f5f5;
          padding: 0.75rem;
          text-align: left;
          font-weight: 600;
          border-bottom: 2px solid #ddd;
          white-space: nowrap;
        }

        .transactions-table td {
          padding: 0.75rem;
          border-bottom: 1px solid #eee;
        }

        .transactions-table tr:hover:not(:first-child) {
          background: #f9f9f9;
        }

        .transactions-table tr.selected {
          background: #e3f2fd;
        }

        .sortable {
          cursor: pointer;
          user-select: none;
        }

        .sortable:hover {
          background: #eee;
        }

        .col-checkbox {
          width: 40px;
          text-align: center;
        }

        .col-date {
          width: 120px;
        }

        .col-type {
          width: 100px;
        }

        .col-name {
          min-width: 200px;
        }

        .col-category {
          min-width: 150px;
        }

        .col-amount {
          width: 120px;
          text-align: right;
        }

        .col-source {
          width: 150px;
        }

        .col-actions {
          width: 180px;
          text-align: right;
        }

        .type-badge {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .type-income {
          background: #d4edda;
          color: #155724;
        }

        .type-expense {
          background: #f8d7da;
          color: #721c24;
        }

        .source-badge {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          background: #e9ecef;
          border-radius: 4px;
          font-size: 0.75rem;
        }

        .parent-name {
          font-size: 0.75rem;
          color: #666;
          margin-top: 0.25rem;
        }

        .note-preview {
          font-size: 0.75rem;
          color: #666;
          margin-top: 0.25rem;
          font-style: italic;
        }

        .amount-income {
          color: #155724;
          font-weight: 600;
        }

        .amount-expense {
          color: #721c24;
          font-weight: 600;
        }

        .edited-badge {
          margin-left: 0.5rem;
          color: #856404;
          cursor: help;
        }

        .edit-input {
          width: 100%;
          padding: 0.25rem;
          border: 1px solid #007bff;
          border-radius: 3px;
        }

        .btn-sm {
          padding: 0.25rem 0.5rem;
          font-size: 0.75rem;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          margin-left: 0.25rem;
        }

        .btn-primary {
          background: #007bff;
          color: white;
        }

        .btn-primary:hover {
          background: #0056b3;
        }

        .btn-success {
          background: #28a745;
          color: white;
        }

        .btn-success:hover {
          background: #218838;
        }

        .btn-danger {
          background: #dc3545;
          color: white;
        }

        .btn-danger:hover {
          background: #c82333;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
        }

        .btn-secondary:hover {
          background: #5a6268;
        }

        .no-data {
          text-align: center;
          padding: 2rem;
          color: #666;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
