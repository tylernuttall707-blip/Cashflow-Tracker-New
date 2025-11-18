/**
 * ScenarioEditor Component - Create and edit scenario interface
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ChangeBuilder } from './ChangeBuilder';
import { computeScenarioProjection, validateScenarioChange } from '../modules/scenarioEngine';
import { fmtMoney } from '../modules/calculations';
import type { Scenario, ScenarioChange, ProjectionResult } from '../types';

interface ScenarioEditorProps {
  scenario: Scenario | null;
}

export function ScenarioEditor({ scenario }: ScenarioEditorProps) {
  const {
    updateScenario,
    addChangeToScenario,
    removeChangeFromScenario,
    settings,
    adjustments,
    oneOffs,
    incomeStreams,
    expandedTransactions,
  } = useAppStore();

  const [showChangeBuilder, setShowChangeBuilder] = useState(false);
  const [projection, setProjection] = useState<ProjectionResult | null>(null);

  // Local state for editing scenario metadata
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [notes, setNotes] = useState('');

  // Preset colors for quick selection
  const presetColors = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#6366F1', // Indigo
    '#14B8A6', // Teal
  ];

  // Load scenario data when scenario changes
  useEffect(() => {
    if (scenario) {
      setName(scenario.name);
      setDescription(scenario.description || '');
      setColor(scenario.color);
      setNotes(scenario.notes || '');
    }
  }, [scenario?.id]);

  // Compute projection when scenario changes
  useEffect(() => {
    if (!scenario) {
      setProjection(null);
      return;
    }

    try {
      const baseState = {
        settings,
        adjustments,
        oneOffs,
        incomeStreams,
        expandedTransactions,
        scenarios: [],
        activeScenarioId: null,
        ui: {
          oneOffSort: { key: 'date' as const, direction: 'asc' as const },
          expandedSort: { key: 'date' as const, direction: 'asc' as const },
        },
      };

      const result = computeScenarioProjection(baseState, scenario);
      setProjection(result);
    } catch (err) {
      console.error('Failed to compute scenario projection:', err);
      setProjection(null);
    }
  }, [scenario, settings, adjustments, oneOffs, incomeStreams, expandedTransactions]);

  if (!scenario) {
    return (
      <div className="scenario-editor-empty">
        <h2>No Scenario Selected</h2>
        <p>Select a scenario from the list or create a new one to get started.</p>
      </div>
    );
  }

  const handleSaveMetadata = () => {
    updateScenario(scenario.id, {
      name,
      description,
      color,
      notes,
    });
  };

  const handleAddChange = (change: ScenarioChange) => {
    // Validate the change first
    const baseState = {
      settings,
      adjustments,
      oneOffs,
      incomeStreams,
      expandedTransactions,
      scenarios: [],
      activeScenarioId: null,
      ui: {
        oneOffSort: { key: 'date' as const, direction: 'asc' as const },
        expandedSort: { key: 'date' as const, direction: 'asc' as const },
      },
    };

    const validation = validateScenarioChange(change, baseState);
    if (!validation.valid) {
      alert(`Invalid change:\n${validation.errors.join('\n')}`);
      return;
    }

    addChangeToScenario(scenario.id, change);
    setShowChangeBuilder(false);
  };

  const handleRemoveChange = (changeId: string) => {
    if (confirm('Remove this change from the scenario?')) {
      removeChangeFromScenario(scenario.id, changeId);
    }
  };

  const handleMoveChange = (changeId: string, direction: 'up' | 'down') => {
    const currentIndex = scenario.changes.findIndex((c) => c.id === changeId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= scenario.changes.length) return;

    const newChanges = [...scenario.changes];
    const [removed] = newChanges.splice(currentIndex, 1);
    newChanges.splice(newIndex, 0, removed);

    updateScenario(scenario.id, { changes: newChanges });
  };

  const getChangeTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      income_adjust: 'Income Adjustment',
      expense_adjust: 'Expense Adjustment',
      bulk_adjustment: 'Bulk Adjustment',
      transaction_add: 'Add Transaction',
      transaction_remove: 'Remove Transaction',
      transaction_modify: 'Modify Transaction',
      setting_override: 'Setting Override',
    };
    return labels[type] || type;
  };

  return (
    <div className="scenario-editor">
      {/* Scenario Metadata */}
      <div className="card scenario-metadata">
        <div className="card-header">
          <h2>Scenario Details</h2>
          <button onClick={handleSaveMetadata} className="btn btn-primary">
            Save Details
          </button>
        </div>

        <div className="scenario-metadata-form">
          <div className="form-group">
            <label htmlFor="scenarioName">Name</label>
            <input
              id="scenarioName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-control"
              placeholder="e.g., Conservative Growth"
            />
          </div>

          <div className="form-group">
            <label htmlFor="scenarioDescription">Description</label>
            <input
              id="scenarioDescription"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-control"
              placeholder="Brief summary of this scenario"
            />
          </div>

          <div className="form-group">
            <label htmlFor="scenarioColor">Color</label>
            <div className="color-picker">
              <input
                id="scenarioColor"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="form-control-color"
              />
              <div className="color-presets">
                {presetColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-preset ${color === c ? 'active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="scenarioNotes">Notes</label>
            <textarea
              id="scenarioNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="form-control"
              rows={3}
              placeholder="Additional notes about this scenario..."
            />
          </div>
        </div>
      </div>

      {/* Projection Summary */}
      {projection && (
        <div className="card scenario-projection-summary">
          <h3>Scenario Projection</h3>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">End Balance</div>
              <div className="kpi-value">{fmtMoney(projection.endBalance)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Lowest Balance</div>
              <div className="kpi-value">{fmtMoney(projection.lowestBalance)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Total Income</div>
              <div className="kpi-value">{fmtMoney(projection.totalIncome)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Total Expenses</div>
              <div className="kpi-value">{fmtMoney(projection.totalExpenses)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Days Below $0</div>
              <div className="kpi-value">{projection.negativeDays}</div>
            </div>
          </div>
        </div>
      )}

      {/* Changes List */}
      <div className="card scenario-changes">
        <div className="card-header">
          <h3>Changes ({scenario.changes.length})</h3>
          <button
            onClick={() => setShowChangeBuilder(true)}
            className="btn btn-primary"
          >
            + Add Change
          </button>
        </div>

        {scenario.changes.length === 0 ? (
          <div className="scenario-changes-empty">
            <p>No changes yet. Add changes to modify the baseline projection.</p>
          </div>
        ) : (
          <div className="scenario-changes-list">
            {scenario.changes.map((change, index) => (
              <div key={change.id} className="scenario-change-item">
                <div className="change-order">{index + 1}</div>
                <div className="change-info">
                  <div className="change-type-badge">
                    {getChangeTypeLabel(change.type)}
                  </div>
                  <div className="change-description">{change.description}</div>
                  {change.targetId && (
                    <div className="change-meta">Target: {change.targetId}</div>
                  )}
                </div>
                <div className="change-actions">
                  <button
                    onClick={() => handleMoveChange(change.id, 'up')}
                    disabled={index === 0}
                    className="btn btn-xs btn-outline"
                    title="Move Up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => handleMoveChange(change.id, 'down')}
                    disabled={index === scenario.changes.length - 1}
                    className="btn btn-xs btn-outline"
                    title="Move Down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => handleRemoveChange(change.id)}
                    className="btn btn-xs btn-danger"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Change Builder Modal */}
      {showChangeBuilder && (
        <div className="modal-overlay">
          <div className="modal-content">
            <ChangeBuilder
              onAddChange={handleAddChange}
              onCancel={() => setShowChangeBuilder(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
