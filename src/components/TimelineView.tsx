import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { ExpandedTransaction, YMDString } from '../types';
import { toYMD } from '../modules/dateUtils';

type ViewMode = 'month' | 'week' | 'day';

interface DayCell {
  date: YMDString;
  transactions: ExpandedTransaction[];
  isCurrentMonth?: boolean;
  isToday?: boolean;
}

interface EditingTransaction {
  transaction: ExpandedTransaction;
  field: 'name' | 'amount' | 'category';
}

interface DragState {
  transaction: ExpandedTransaction;
  sourceDate: YMDString;
}

export const TimelineView: React.FC = () => {
  const { expandedTransactions, updateExpandedTransaction } = useAppStore();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [hoveredTransaction, setHoveredTransaction] = useState<ExpandedTransaction | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [editingTransaction, setEditingTransaction] = useState<EditingTransaction | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Get calendar data based on view mode
  const calendarData = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (viewMode === 'month') {
      return generateMonthView(year, month, expandedTransactions);
    } else if (viewMode === 'week') {
      return generateWeekView(currentDate, expandedTransactions);
    } else {
      return generateDayView(currentDate, expandedTransactions);
    }
  }, [viewMode, currentDate, expandedTransactions]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingTransaction && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTransaction]);

  // Navigation handlers
  const handlePrevious = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Get title based on view mode
  const getTitle = () => {
    if (viewMode === 'month') {
      return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else if (viewMode === 'week') {
      const weekStart = getWeekStart(currentDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
      return currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, transaction: ExpandedTransaction, sourceDate: YMDString) => {
    setDragState({ transaction, sourceDate });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetDate: YMDString) => {
    e.preventDefault();
    if (dragState && dragState.sourceDate !== targetDate) {
      // Update the transaction's date
      updateExpandedTransaction(dragState.transaction.id, {
        ...dragState.transaction,
        date: targetDate,
      });
    }
    setDragState(null);
  };

  const handleDragEnd = () => {
    setDragState(null);
  };

  // Edit handlers
  const handleTransactionClick = (transaction: ExpandedTransaction, field: 'name' | 'amount' | 'category') => {
    setEditingTransaction({ transaction, field });
  };

  const handleEditChange = (value: string) => {
    if (!editingTransaction) return;

    const { transaction, field } = editingTransaction;
    const updates: Partial<ExpandedTransaction> = {};

    if (field === 'amount') {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        updates.amount = numValue;
      }
    } else {
      updates[field] = value;
    }

    updateExpandedTransaction(transaction.id, { ...transaction, ...updates });
  };

  const handleEditComplete = () => {
    setEditingTransaction(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditComplete();
    } else if (e.key === 'Escape') {
      setEditingTransaction(null);
    }
  };

  // Tooltip handlers
  const handleTransactionHover = (e: React.MouseEvent, transaction: ExpandedTransaction) => {
    setHoveredTransaction(transaction);
    setTooltipPosition({ x: e.clientX, y: e.clientY });
  };

  const handleTransactionLeave = () => {
    setHoveredTransaction(null);
  };

  return (
    <div className="timeline-view">
      {/* Header with controls */}
      <div className="timeline-header">
        <div className="timeline-nav">
          <button className="btn-sm" onClick={handlePrevious}>←</button>
          <button className="btn-sm" onClick={handleToday}>Today</button>
          <button className="btn-sm" onClick={handleNext}>→</button>
          <h2 className="timeline-title">{getTitle()}</h2>
        </div>
        <div className="timeline-view-toggle">
          <button
            className={`btn-sm ${viewMode === 'month' ? 'active' : ''}`}
            onClick={() => setViewMode('month')}
          >
            Month
          </button>
          <button
            className={`btn-sm ${viewMode === 'week' ? 'active' : ''}`}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
          <button
            className={`btn-sm ${viewMode === 'day' ? 'active' : ''}`}
            onClick={() => setViewMode('day')}
          >
            Day
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="timeline-legend">
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#47C7AC' }}></span>
          <span>Income</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#F16564' }}></span>
          <span>Expenses</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#5F7BFF' }}></span>
          <span>Recurring</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#F9C74F' }}></span>
          <span>AR Invoices</span>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className={`timeline-grid timeline-grid-${viewMode}`}>
        {viewMode === 'month' && (
          <>
            {/* Day headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="timeline-day-header">
                {day}
              </div>
            ))}
          </>
        )}

        {/* Day cells */}
        {calendarData.map((dayCell) => (
          <div
            key={dayCell.date}
            className={`timeline-day-cell ${dayCell.isCurrentMonth === false ? 'other-month' : ''} ${dayCell.isToday ? 'today' : ''}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, dayCell.date)}
          >
            <div className="day-header">
              <span className="day-number">{new Date(dayCell.date).getDate()}</span>
              {viewMode !== 'month' && (
                <span className="day-name">{new Date(dayCell.date).toLocaleDateString('en-US', { weekday: 'short' })}</span>
              )}
              {getDensityIndicator(dayCell.transactions)}
            </div>
            <div className="day-transactions">
              {dayCell.transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className={`transaction-item ${getTransactionClass(transaction)} ${dragState?.transaction.id === transaction.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, transaction, dayCell.date)}
                  onDragEnd={handleDragEnd}
                  onMouseEnter={(e) => handleTransactionHover(e, transaction)}
                  onMouseLeave={handleTransactionLeave}
                  style={{
                    backgroundColor: getTransactionColor(transaction),
                    opacity: transaction.sourceType === 'recurring' ? 0.6 : 1,
                  }}
                >
                  <div className="transaction-content">
                    {editingTransaction?.transaction.id === transaction.id && editingTransaction.field === 'name' ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        className="edit-input"
                        defaultValue={transaction.name}
                        onChange={(e) => handleEditChange(e.target.value)}
                        onBlur={handleEditComplete}
                        onKeyDown={handleEditKeyDown}
                      />
                    ) : (
                      <span
                        className="transaction-name"
                        onClick={() => handleTransactionClick(transaction, 'name')}
                      >
                        {transaction.name}
                      </span>
                    )}
                    {editingTransaction?.transaction.id === transaction.id && editingTransaction.field === 'amount' ? (
                      <input
                        ref={editInputRef}
                        type="number"
                        className="edit-input edit-input-amount"
                        defaultValue={transaction.amount}
                        onChange={(e) => handleEditChange(e.target.value)}
                        onBlur={handleEditComplete}
                        onKeyDown={handleEditKeyDown}
                      />
                    ) : (
                      <span
                        className="transaction-amount"
                        onClick={() => handleTransactionClick(transaction, 'amount')}
                      >
                        ${Math.abs(transaction.amount).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {hoveredTransaction && (
        <div
          className="timeline-tooltip"
          style={{
            left: tooltipPosition.x + 10,
            top: tooltipPosition.y + 10,
          }}
        >
          <div className="tooltip-header">
            <strong>{hoveredTransaction.name}</strong>
          </div>
          <div className="tooltip-body">
            <div className="tooltip-row">
              <span>Amount:</span>
              <span className={hoveredTransaction.type === 'income' ? 'positive' : 'negative'}>
                {hoveredTransaction.type === 'income' ? '+' : '-'}${Math.abs(hoveredTransaction.amount).toFixed(2)}
              </span>
            </div>
            <div className="tooltip-row">
              <span>Category:</span>
              <span>{hoveredTransaction.category}</span>
            </div>
            <div className="tooltip-row">
              <span>Type:</span>
              <span>{hoveredTransaction.type}</span>
            </div>
            {hoveredTransaction.sourceType === 'recurring' && (
              <div className="tooltip-row">
                <span>Source:</span>
                <span>Recurring ({hoveredTransaction.parentName})</span>
              </div>
            )}
            {hoveredTransaction.source === 'AR' && (
              <>
                <div className="tooltip-row">
                  <span>Company:</span>
                  <span>{hoveredTransaction.company}</span>
                </div>
                <div className="tooltip-row">
                  <span>Invoice:</span>
                  <span>{hoveredTransaction.invoice}</span>
                </div>
                {hoveredTransaction.confidencePct !== undefined && (
                  <div className="tooltip-row">
                    <span>Confidence:</span>
                    <span>{hoveredTransaction.confidencePct}%</span>
                  </div>
                )}
              </>
            )}
            {hoveredTransaction.note && (
              <div className="tooltip-row">
                <span>Note:</span>
                <span>{hoveredTransaction.note}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Helper functions

function generateMonthView(year: number, month: number, transactions: ExpandedTransaction[]): DayCell[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Start from Sunday

  const endDate = new Date(lastDay);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // End on Saturday

  const cells: DayCell[] = [];
  const today = toYMD(new Date());

  for (let d = new Date(startDate); d <= endDate; ) {
    const dateStr = toYMD(d);
    const isCurrentMonth = d.getMonth() === month;
    const isToday = dateStr === today;
    const dayTransactions = transactions.filter((t) => t.date === dateStr);

    cells.push({
      date: dateStr,
      transactions: dayTransactions,
      isCurrentMonth,
      isToday,
    });
    d.setDate(d.getDate() + 1);
  }

  return cells;
}

function generateWeekView(currentDate: Date, transactions: ExpandedTransaction[]): DayCell[] {
  const weekStart = getWeekStart(currentDate);
  const cells: DayCell[] = [];
  const today = toYMD(new Date());

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = toYMD(d);
    const isToday = dateStr === today;
    const dayTransactions = transactions.filter((t) => t.date === dateStr);

    cells.push({
      date: dateStr,
      transactions: dayTransactions,
      isToday,
    });
  }

  return cells;
}

function generateDayView(currentDate: Date, transactions: ExpandedTransaction[]): DayCell[] {
  const dateStr = toYMD(currentDate);
  const today = toYMD(new Date());
  const isToday = dateStr === today;
  const dayTransactions = transactions.filter((t) => t.date === dateStr);

  return [{
    date: dateStr,
    transactions: dayTransactions,
    isToday,
  }];
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // Go to Sunday
  return d;
}

function getDensityIndicator(transactions: ExpandedTransaction[]): JSX.Element | null {
  if (transactions.length === 0) return null;

  const totalAmount = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  let densityClass = 'low';
  if (totalAmount > 10000) {
    densityClass = 'very-high';
  } else if (totalAmount > 5000) {
    densityClass = 'high';
  } else if (totalAmount > 1000) {
    densityClass = 'medium';
  }

  return <span className={`density-indicator density-${densityClass}`} title={`Cash flow: $${totalAmount.toFixed(2)}`}></span>;
}

function getTransactionColor(transaction: ExpandedTransaction): string {
  // Priority order: AR invoices > Income > Expenses > Recurring
  if (transaction.source === 'AR') {
    return '#F9C74F'; // Yellow for AR
  }
  if (transaction.type === 'income') {
    return '#47C7AC'; // Green for income
  }
  if (transaction.type === 'expense') {
    return '#F16564'; // Red for expenses
  }
  if (transaction.sourceType === 'recurring') {
    return '#5F7BFF'; // Blue for recurring
  }
  return '#E1E7F5'; // Default gray
}

function getTransactionClass(transaction: ExpandedTransaction): string {
  const classes = ['transaction'];
  if (transaction.source === 'AR') classes.push('ar-invoice');
  if (transaction.type === 'income') classes.push('income');
  if (transaction.type === 'expense') classes.push('expense');
  if (transaction.sourceType === 'recurring') classes.push('recurring');
  return classes.join(' ');
}
