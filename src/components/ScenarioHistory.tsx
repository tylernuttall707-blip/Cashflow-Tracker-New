/**
 * ScenarioHistory - Component for viewing and managing scenario version history
 */

import { useState } from 'react';
import type { Scenario, ScenarioVersion, AppState } from '../types';
import { useAppStore } from '../store/useAppStore';
import { compareVersions, getVersionDiffSummary } from '../modules/scenarioEngine';

interface ScenarioHistoryProps {
  scenario: Scenario;
  onClose: () => void;
  onViewDiff?: (fromVersion: ScenarioVersion, toVersion: ScenarioVersion) => void;
}

export function ScenarioHistory({ scenario, onClose, onViewDiff }: ScenarioHistoryProps) {
  const getScenarioVersions = useAppStore((state) => state.getScenarioVersions);
  const restoreScenarioVersion = useAppStore((state) => state.restoreScenarioVersion);
  const deleteScenarioVersion = useAppStore((state) => state.deleteScenarioVersion);
  const saveScenarioVersion = useAppStore((state) => state.saveScenarioVersion);

  const versions = getScenarioVersions(scenario.id);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [versionNotes, setVersionNotes] = useState('');

  const handleVersionSelect = (versionId: string) => {
    if (selectedVersions.includes(versionId)) {
      setSelectedVersions(selectedVersions.filter((id) => id !== versionId));
    } else {
      if (selectedVersions.length >= 2) {
        setSelectedVersions([selectedVersions[1], versionId]);
      } else {
        setSelectedVersions([...selectedVersions, versionId]);
      }
    }
  };

  const handleRestore = (versionId: string) => {
    if (confirm('Are you sure you want to restore this version? Current changes will be lost.')) {
      restoreScenarioVersion(scenario.id, versionId);
      onClose();
    }
  };

  const handleDelete = (versionId: string) => {
    if (confirm('Are you sure you want to delete this version? This cannot be undone.')) {
      deleteScenarioVersion(scenario.id, versionId);
    }
  };

  const handleSaveVersion = () => {
    saveScenarioVersion(scenario.id, versionNotes || undefined);
    setVersionNotes('');
    setShowSaveModal(false);
  };

  const handleCompare = () => {
    if (selectedVersions.length === 2) {
      const v1 = versions.find((v: ScenarioVersion) => v.id === selectedVersions[0]);
      const v2 = versions.find((v: ScenarioVersion) => v.id === selectedVersions[1]);
      if (v1 && v2 && onViewDiff) {
        // Order by version number
        const [older, newer] = v1.versionNumber < v2.versionNumber ? [v1, v2] : [v2, v1];
        onViewDiff(older, newer);
      }
    }
  };

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Version History</h2>
            <p className="text-sm text-gray-600 mt-1">{scenario.name}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSaveModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Current Version
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Compare button */}
        {selectedVersions.length === 2 && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-200">
            <button
              onClick={handleCompare}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Compare Selected Versions
            </button>
            <span className="ml-3 text-sm text-gray-600">
              {selectedVersions.length} versions selected
            </span>
          </div>
        )}

        {/* Version list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {versions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">No version history yet</p>
              <p className="text-gray-400 text-sm mt-2">
                Save a version to track changes over time
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((version: ScenarioVersion, index: number) => {
                const isLatest = index === 0;
                const isSelected = selectedVersions.includes(version.id);
                const prevVersion = versions[index + 1];
                let diffSummary = '';

                if (prevVersion) {
                  const diff = compareVersions(prevVersion, version);
                  diffSummary = getVersionDiffSummary(diff);
                }

                return (
                  <div
                    key={version.id}
                    className={`border rounded-lg p-4 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleVersionSelect(version.id)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">
                              Version {version.versionNumber}
                            </span>
                            {isLatest && (
                              <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full">
                                Latest
                              </span>
                            )}
                            {version.versionNumber === scenario.currentVersionNumber && (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full">
                                Current
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">
                            {formatDate(version.timestamp)}
                          </p>
                          {version.notes && (
                            <p className="text-sm text-gray-700 mt-2 italic">
                              "{version.notes}"
                            </p>
                          )}
                          {diffSummary && (
                            <p className="text-xs text-gray-500 mt-2">
                              Changes: {diffSummary}
                            </p>
                          )}
                          <div className="mt-2 text-sm text-gray-600">
                            <span className="font-medium">{version.changes.length}</span>{' '}
                            change{version.changes.length !== 1 ? 's' : ''}
                            {version.tags && version.tags.length > 0 && (
                              <span className="ml-3">
                                Tags:{' '}
                                {version.tags.map((tag: string) => (
                                  <span
                                    key={tag}
                                    className="inline-block px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded ml-1"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleRestore(version.id)}
                          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                          title="Restore this version"
                        >
                          Restore
                        </button>
                        {!isLatest && (
                          <button
                            onClick={() => handleDelete(version.id)}
                            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                            title="Delete this version"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Save version modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Save New Version</h3>
            <p className="text-sm text-gray-600 mb-4">
              Add optional notes to help identify this version later.
            </p>
            <textarea
              value={versionNotes}
              onChange={(e) => setVersionNotes(e.target.value)}
              placeholder="Version notes (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveVersion}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Save Version
              </button>
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setVersionNotes('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
