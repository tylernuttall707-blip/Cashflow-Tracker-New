/**
 * ConditionalBuilder - Component for building conditional scenario changes
 */

import { useState } from 'react';
import type {
  Condition,
  ConditionalChange,
  ConditionalOperator,
  LogicalOperator,
  ScenarioChange,
} from '../types';

interface ConditionalBuilderProps {
  onSave: (conditionalChange: ConditionalChange) => void;
  onCancel: () => void;
  initialConditionalChange?: ConditionalChange;
}

export function ConditionalBuilder({
  onSave,
  onCancel,
  initialConditionalChange,
}: ConditionalBuilderProps) {
  const [conditions, setConditions] = useState<Condition[]>(
    initialConditionalChange?.conditions || []
  );
  const [logicalOperator, setLogicalOperator] = useState<LogicalOperator>(
    initialConditionalChange?.logicalOperator || 'AND'
  );
  const [description, setDescription] = useState(initialConditionalChange?.description || '');
  const [enabled, setEnabled] = useState(initialConditionalChange?.enabled ?? true);

  // For the change to apply
  const [changeType, setChangeType] = useState<ScenarioChange['type']>(
    initialConditionalChange?.change.type || 'expense_adjust'
  );
  const [changeDescription, setChangeDescription] = useState(
    initialConditionalChange?.change.description || ''
  );
  const [percentChange, setPercentChange] = useState<number>(0);

  const handleAddCondition = () => {
    const newCondition: Condition = {
      id: crypto.randomUUID(),
      type: 'balance',
      operator: 'less_than',
      value: 0,
    };
    setConditions([...conditions, newCondition]);
  };

  const handleUpdateCondition = (index: number, updates: Partial<Condition>) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], ...updates };
    setConditions(newConditions);
  };

  const handleRemoveCondition = (index: number) => {
    setConditions(conditions.filter((_: any, i: number) => i !== index));
  };

  const handleSave = () => {
    if (conditions.length === 0) {
      alert('Please add at least one condition');
      return;
    }

    const change: ScenarioChange = {
      id: crypto.randomUUID(),
      type: changeType,
      description: changeDescription,
      targetType: changeType.includes('income') ? 'income' : 'expense',
      changes: { percentChange },
    };

    const conditionalChange: ConditionalChange = {
      id: initialConditionalChange?.id || crypto.randomUUID(),
      conditions,
      logicalOperator,
      change,
      description,
      enabled,
    };

    onSave(conditionalChange);
  };

  const conditionTypes = [
    { value: 'balance', label: 'Balance' },
    { value: 'income', label: 'Total Income' },
    { value: 'expense', label: 'Total Expenses' },
    { value: 'transaction_count', label: 'Transaction Count' },
    { value: 'projection_day', label: 'Projection Day' },
  ] as const;

  const operators: { value: ConditionalOperator; label: string }[] = [
    { value: 'equals', label: 'Equals (=)' },
    { value: 'not_equals', label: 'Not Equals (≠)' },
    { value: 'greater_than', label: 'Greater Than (>)' },
    { value: 'less_than', label: 'Less Than (<)' },
    { value: 'greater_than_or_equal', label: 'Greater or Equal (≥)' },
    { value: 'less_than_or_equal', label: 'Less or Equal (≤)' },
  ];

  const changeTypes = [
    { value: 'income_adjust', label: 'Adjust Income' },
    { value: 'expense_adjust', label: 'Adjust Expenses' },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {initialConditionalChange ? 'Edit' : 'Create'} Conditional Change
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Define conditions and the change to apply when they're met
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e: any) => setDescription(e.target.value)}
              placeholder="e.g., Reduce expenses if balance is low"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e: any) => setEnabled(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
              Enabled
            </label>
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-900">Conditions</h3>
              <button
                onClick={handleAddCondition}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                + Add Condition
              </button>
            </div>

            {conditions.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <p className="text-gray-500">No conditions yet</p>
                <p className="text-sm text-gray-400 mt-1">Click "Add Condition" to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {conditions.map((condition: any, index: number) => (
                  <div key={condition.id} className="border border-gray-200 rounded-lg p-4">
                    {index > 0 && (
                      <div className="mb-3">
                        <select
                          value={logicalOperator}
                          onChange={(e: any) => setLogicalOperator(e.target.value as LogicalOperator)}
                          className="px-3 py-1 border border-gray-300 rounded bg-gray-50 text-sm font-medium"
                        >
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Type
                        </label>
                        <select
                          value={condition.type}
                          onChange={(e: any) =>
                            handleUpdateCondition(index, {
                              type: e.target.value as Condition['type'],
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          {conditionTypes.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Operator
                        </label>
                        <select
                          value={condition.operator}
                          onChange={(e: any) =>
                            handleUpdateCondition(index, {
                              operator: e.target.value as ConditionalOperator,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          {operators.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Value
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={condition.value}
                            onChange={(e: any) =>
                              handleUpdateCondition(index, {
                                value: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          />
                          <button
                            onClick={() => handleRemoveCondition(index)}
                            className="px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm"
                            title="Remove condition"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded">
                      <strong>Preview:</strong> If{' '}
                      {conditionTypes.find((t) => t.value === condition.type)?.label}{' '}
                      {operators.find((o) => o.value === condition.operator)?.label.toLowerCase()}{' '}
                      {condition.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Change to apply */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Change to Apply When Conditions Are Met
            </h3>
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Change Type
                </label>
                <select
                  value={changeType}
                  onChange={(e: any) => setChangeType(e.target.value as ScenarioChange['type'])}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {changeTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Change Description
                </label>
                <input
                  type="text"
                  value={changeDescription}
                  onChange={(e: any) => setChangeDescription(e.target.value)}
                  placeholder="e.g., Reduce expenses by 10%"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Percent Change
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={percentChange}
                    onChange={(e: any) => setPercentChange(parseFloat(e.target.value) || 0)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                  />
                  <span className="text-gray-600">%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Positive for increase, negative for decrease
                </p>
              </div>
            </div>
          </div>

          {/* Summary */}
          {conditions.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">Summary</h4>
              <p className="text-sm text-gray-700">
                <strong>IF</strong>{' '}
                {conditions.map((condition: any, index: number) => (
                  <span key={condition.id}>
                    {index > 0 && <strong> {logicalOperator} </strong>}
                    {conditionTypes.find((t) => t.value === condition.type)?.label}{' '}
                    {operators.find((o) => o.value === condition.operator)?.label.toLowerCase()}{' '}
                    {condition.value}
                  </span>
                ))}
              </p>
              <p className="text-sm text-gray-700 mt-2">
                <strong>THEN</strong> {changeDescription || `${changeType} by ${percentChange}%`}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {initialConditionalChange ? 'Update' : 'Create'} Conditional Change
          </button>
        </div>
      </div>
    </div>
  );
}
