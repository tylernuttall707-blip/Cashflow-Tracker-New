/**
 * ScenarioList Component - Sidebar for browsing and managing scenarios
 */

import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { createScenarioTemplate } from '../modules/scenarioEngine';
import type { Scenario } from '../types';

interface ScenarioListProps {
  onSelectScenario: (scenario: Scenario | null) => void;
  selectedScenarioId: string | null;
}

export function ScenarioList({ onSelectScenario, selectedScenarioId }: ScenarioListProps) {
  const { scenarios, addScenario, removeScenario, duplicateScenario, archiveScenario, restoreScenario } = useAppStore();
  const [showArchived, setShowArchived] = useState(false);

  // Filter scenarios based on archived status
  const activeScenarios = (scenarios || []).filter((s: Scenario) => !s.isArchived);
  const archivedScenarios = (scenarios || []).filter((s: Scenario) => s.isArchived);
  const displayedScenarios = showArchived ? archivedScenarios : activeScenarios;

  const handleCreateFromTemplate = (templateName: 'conservative' | 'aggressive' | 'worst-case' | 'cost-cutting') => {
    const scenario = createScenarioTemplate(templateName);
    addScenario(scenario);
    onSelectScenario(scenario);
  };

  const handleCreateBlank = () => {
    const scenario: Scenario = {
      id: crypto.randomUUID(),
      name: 'New Scenario',
      description: '',
      color: '#3B82F6',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      changes: [],
      isArchived: false,
    };
    addScenario(scenario);
    onSelectScenario(scenario);
  };

  const handleDuplicate = (scenario: Scenario, e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = `${scenario.name} (Copy)`;
    duplicateScenario(scenario.id, newName);
  };

  const handleDelete = (scenario: Scenario, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete "${scenario.name}"? This cannot be undone.`)) {
      removeScenario(scenario.id);
      if (selectedScenarioId === scenario.id) {
        onSelectScenario(null);
      }
    }
  };

  const handleArchive = (scenario: Scenario, e: React.MouseEvent) => {
    e.stopPropagation();
    archiveScenario(scenario.id);
    if (selectedScenarioId === scenario.id) {
      onSelectScenario(null);
    }
  };

  const handleRestore = (scenario: Scenario, e: React.MouseEvent) => {
    e.stopPropagation();
    restoreScenario(scenario.id);
  };

  const formatDate = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return isoString;
    }
  };

  return (
    <aside className="scenario-list">
      <div className="scenario-list-header">
        <h3>Scenarios</h3>
        <div className="scenario-list-actions">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="btn btn-sm btn-outline"
            title={showArchived ? 'Show Active' : 'Show Archived'}
          >
            {showArchived ? 'Active' : 'Archived'}
          </button>
        </div>
      </div>

      {!showArchived && (
        <div className="scenario-create-section">
          <button onClick={handleCreateBlank} className="btn btn-primary btn-block">
            + New Blank Scenario
          </button>
          <details className="scenario-templates">
            <summary>Create from Template</summary>
            <div className="template-buttons">
              <button
                onClick={() => handleCreateFromTemplate('conservative')}
                className="btn btn-sm btn-outline template-btn"
                style={{ borderLeftColor: '#F59E0B' }}
              >
                Conservative
              </button>
              <button
                onClick={() => handleCreateFromTemplate('aggressive')}
                className="btn btn-sm btn-outline template-btn"
                style={{ borderLeftColor: '#10B981' }}
              >
                Aggressive Growth
              </button>
              <button
                onClick={() => handleCreateFromTemplate('worst-case')}
                className="btn btn-sm btn-outline template-btn"
                style={{ borderLeftColor: '#EF4444' }}
              >
                Worst Case
              </button>
              <button
                onClick={() => handleCreateFromTemplate('cost-cutting')}
                className="btn btn-sm btn-outline template-btn"
                style={{ borderLeftColor: '#6366F1' }}
              >
                Cost Cutting
              </button>
            </div>
          </details>
        </div>
      )}

      <div className="scenario-items">
        {displayedScenarios.length === 0 ? (
          <div className="scenario-empty">
            {showArchived ? 'No archived scenarios' : 'No scenarios yet. Create one to get started!'}
          </div>
        ) : (
          displayedScenarios.map((scenario: Scenario) => (
            <div
              key={scenario.id}
              className={`scenario-item ${selectedScenarioId === scenario.id ? 'active' : ''}`}
              onClick={() => onSelectScenario(scenario)}
            >
              <div className="scenario-item-header">
                <div
                  className="scenario-color-indicator"
                  style={{ backgroundColor: scenario.color }}
                  title={scenario.color}
                />
                <div className="scenario-item-info">
                  <h4>{scenario.name}</h4>
                  {scenario.description && (
                    <p className="scenario-description">{scenario.description}</p>
                  )}
                  <div className="scenario-meta">
                    <span className="scenario-change-count">
                      {scenario.changes.length} change{scenario.changes.length !== 1 ? 's' : ''}
                    </span>
                    <span className="scenario-date">
                      Updated {formatDate(scenario.updatedAt)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="scenario-item-actions">
                {showArchived ? (
                  <>
                    <button
                      onClick={(e) => handleRestore(scenario, e)}
                      className="btn btn-xs btn-outline"
                      title="Restore"
                    >
                      ↻
                    </button>
                    <button
                      onClick={(e) => handleDelete(scenario, e)}
                      className="btn btn-xs btn-danger"
                      title="Delete Permanently"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => handleDuplicate(scenario, e)}
                      className="btn btn-xs btn-outline"
                      title="Duplicate"
                    >
                      ⎘
                    </button>
                    <button
                      onClick={(e) => handleArchive(scenario, e)}
                      className="btn btn-xs btn-outline"
                      title="Archive"
                    >
                      ↓
                    </button>
                    <button
                      onClick={(e) => handleDelete(scenario, e)}
                      className="btn btn-xs btn-danger"
                      title="Delete"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
