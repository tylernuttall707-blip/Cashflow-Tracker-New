/**
 * AISuggestions - Component to display AI-generated scenario suggestions
 */

import { useState, useEffect } from 'react';
import type { AppState, ProjectionResult, ScenarioSuggestion, Scenario } from '../types';
import { useAppStore } from '../store/useAppStore';
import {
  detectFinancialPatterns,
  generateScenarioSuggestions,
  applySuggestionToScenario,
} from '../modules/aiSuggestions';

interface AISuggestionsProps {
  state: AppState;
  projection: ProjectionResult;
  onApplySuggestion?: (scenario: Scenario) => void;
}

export function AISuggestions({ state, projection, onApplySuggestion }: AISuggestionsProps) {
  const addScenario = useAppStore((s: any) => s.addScenario);

  const [suggestions, setSuggestions] = useState<ScenarioSuggestion[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [showAllPatterns, setShowAllPatterns] = useState(false);

  useEffect(() => {
    // Generate suggestions based on current state
    const patterns = detectFinancialPatterns(state, projection);
    const newSuggestions = generateScenarioSuggestions(state, projection, patterns);
    setSuggestions(newSuggestions);
  }, [state, projection]);

  const handleApply = (suggestion: ScenarioSuggestion) => {
    const scenario = applySuggestionToScenario(suggestion);
    addScenario(scenario);
    if (onApplySuggestion) {
      onApplySuggestion(scenario);
    }
    // Mark as applied
    setSuggestions(
      suggestions.map((s: any) =>
        s.id === suggestion.id ? { ...s, appliedToScenarioId: scenario.id } : s
      )
    );
  };

  const handleDismiss = (suggestionId: string) => {
    setDismissedSuggestions(new Set([...dismissedSuggestions, suggestionId]));
  };

  const visibleSuggestions = suggestions.filter(
    (s: ScenarioSuggestion) => !dismissedSuggestions.has(s.id) && !s.appliedToScenarioId
  );

  const priorityOrder: Record<ScenarioSuggestion['priority'], number> = { high: 0, medium: 1, low: 2 };
  const sortedSuggestions = [...visibleSuggestions].sort(
    (a: ScenarioSuggestion, b: ScenarioSuggestion) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  const getPriorityColor = (priority: ScenarioSuggestion['priority']) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const getTypeIcon = (type: ScenarioSuggestion['type']) => {
    switch (type) {
      case 'optimization':
        return '⚡';
      case 'risk_mitigation':
        return '🛡️';
      case 'pattern_detected':
        return '🔍';
      case 'opportunity':
        return '💡';
    }
  };

  const getTypeLabel = (type: ScenarioSuggestion['type']) => {
    switch (type) {
      case 'optimization':
        return 'Optimization';
      case 'risk_mitigation':
        return 'Risk Mitigation';
      case 'pattern_detected':
        return 'Pattern Detected';
      case 'opportunity':
        return 'Opportunity';
    }
  };

  if (sortedSuggestions.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <div className="text-4xl mb-2">✅</div>
        <h3 className="font-semibold text-gray-900 mb-1">Looking Good!</h3>
        <p className="text-sm text-gray-600">
          No immediate concerns detected in your financial projections.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          AI Recommendations ({sortedSuggestions.length})
        </h3>
        <button
          onClick={() => setShowAllPatterns(!showAllPatterns)}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          {showAllPatterns ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      <div className="space-y-3">
        {sortedSuggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className={`border rounded-lg p-4 ${getPriorityColor(suggestion.priority)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{getTypeIcon(suggestion.type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900">{suggestion.title}</h4>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${getPriorityColor(
                          suggestion.priority
                        )}`}
                      >
                        {suggestion.priority.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {getTypeLabel(suggestion.type)}
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm text-gray-700 mb-2">{suggestion.description}</p>

                {/* Reasoning */}
                {showAllPatterns && (
                  <div className="bg-white bg-opacity-50 rounded p-3 mb-3">
                    <p className="text-xs font-medium text-gray-900 mb-1">Why this suggestion:</p>
                    <p className="text-xs text-gray-600">{suggestion.reasoning}</p>
                  </div>
                )}

                {/* Estimated impact */}
                {suggestion.estimatedImpact && (
                  <div className="flex items-center gap-4 text-sm mb-3">
                    {suggestion.estimatedImpact.endBalanceChange !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-600">Impact:</span>
                        <span
                          className={`font-medium ${
                            suggestion.estimatedImpact.endBalanceChange > 0
                              ? 'text-green-700'
                              : 'text-red-700'
                          }`}
                        >
                          {suggestion.estimatedImpact.endBalanceChange > 0 ? '+' : ''}$
                          {suggestion.estimatedImpact.endBalanceChange.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Changes preview */}
                {showAllPatterns && (
                  <div className="bg-white bg-opacity-50 rounded p-3">
                    <p className="text-xs font-medium text-gray-900 mb-2">
                      Proposed changes ({suggestion.suggestedChanges.length}):
                    </p>
                    <ul className="space-y-1">
                      {suggestion.suggestedChanges.map((change: any, idx: number) => (
                        <li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
                          <span className="text-gray-400">•</span>
                          <span>{change.description || change.type}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleApply(suggestion)}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  Apply as Scenario
                </button>
                <button
                  onClick={() => handleDismiss(suggestion.id)}
                  className="px-3 py-1.5 bg-white bg-opacity-50 text-gray-700 text-sm rounded-lg hover:bg-opacity-75 transition-colors whitespace-nowrap"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Statistics */}
      {showAllPatterns && suggestions.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-900 mb-2 text-sm">Suggestion Summary</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-600">Total suggestions:</span>
              <span className="ml-2 font-medium">{suggestions.length}</span>
            </div>
            <div>
              <span className="text-gray-600">Applied:</span>
              <span className="ml-2 font-medium">
                {suggestions.filter((s: any) => s.appliedToScenarioId).length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">High priority:</span>
              <span className="ml-2 font-medium text-red-700">
                {suggestions.filter((s: any) => s.priority === 'high').length}
              </span>
            </div>
            <div>
              <span className="text-gray-600">Dismissed:</span>
              <span className="ml-2 font-medium">{dismissedSuggestions.size}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
