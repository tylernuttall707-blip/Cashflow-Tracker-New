/**
 * VersionDiffViewer - Component to show differences between two scenario versions
 */

import React from 'react';
import type { ScenarioVersion, VersionDiff } from '../types';
import { compareVersions } from '../modules/scenarioEngine';

interface VersionDiffViewerProps {
  fromVersion: ScenarioVersion;
  toVersion: ScenarioVersion;
  onClose: () => void;
}

export function VersionDiffViewer({
  fromVersion,
  toVersion,
  onClose,
}: VersionDiffViewerProps) {
  const diff = compareVersions(fromVersion, toVersion);

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

  const formatChangeDescription = (change: any): string => {
    if (change.description) return change.description;

    switch (change.type) {
      case 'transaction_add':
        return `Add transaction: ${change.changes?.newTransaction?.description || 'New transaction'}`;
      case 'transaction_remove':
        return `Remove transaction`;
      case 'transaction_modify':
        return `Modify transaction`;
      case 'income_adjust':
        return `Adjust income by ${change.changes?.percentChange || 0}%`;
      case 'expense_adjust':
        return `Adjust expenses by ${change.changes?.percentChange || 0}%`;
      case 'bulk_adjustment':
        return `Bulk adjustment by ${change.changes?.percentChange || 0}%`;
      case 'setting_override':
        return `Override settings`;
      default:
        return change.type;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Version Comparison</h2>
              <p className="text-sm text-gray-600 mt-1">
                Comparing v{fromVersion.versionNumber} to v{toVersion.versionNumber}
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Version info */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 grid grid-cols-2 gap-4">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">
              Version {fromVersion.versionNumber}
            </h3>
            <p className="text-sm text-gray-600">{formatDate(fromVersion.timestamp)}</p>
            {fromVersion.notes && (
              <p className="text-sm text-gray-700 mt-2 italic">"{fromVersion.notes}"</p>
            )}
            <p className="text-sm text-gray-600 mt-2">
              {fromVersion.changes.length} change{fromVersion.changes.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">
              Version {toVersion.versionNumber}
            </h3>
            <p className="text-sm text-gray-600">{formatDate(toVersion.timestamp)}</p>
            {toVersion.notes && (
              <p className="text-sm text-gray-700 mt-2 italic">"{toVersion.notes}"</p>
            )}
            <p className="text-sm text-gray-600 mt-2">
              {toVersion.changes.length} change{toVersion.changes.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Differences */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Metadata changes */}
          {(diff.nameChanged || diff.descriptionChanged || diff.tagsChanged) && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Metadata Changes</h3>
              <div className="space-y-2">
                {diff.nameChanged && (
                  <div className="flex items-start gap-3">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                      NAME
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-red-600 line-through text-sm">
                          {fromVersion.name}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="text-green-600 text-sm">{toVersion.name}</span>
                      </div>
                    </div>
                  </div>
                )}
                {diff.descriptionChanged && (
                  <div className="flex items-start gap-3">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                      DESC
                    </span>
                    <div className="flex-1">
                      <div className="text-sm">
                        <div className="text-red-600 line-through mb-1">
                          {fromVersion.description || '(empty)'}
                        </div>
                        <div className="text-green-600">
                          {toVersion.description || '(empty)'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {diff.tagsChanged && (
                  <div className="flex items-start gap-3">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                      TAGS
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-red-600 line-through text-sm">
                          {fromVersion.tags?.join(', ') || '(none)'}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="text-green-600 text-sm">
                          {toVersion.tags?.join(', ') || '(none)'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Added changes */}
          {diff.changesAdded.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded">
                  +{diff.changesAdded.length}
                </span>
                Changes Added
              </h3>
              <div className="space-y-2">
                {diff.changesAdded.map((change) => (
                  <div
                    key={change.id}
                    className="border-l-4 border-green-500 bg-green-50 pl-4 py-2"
                  >
                    <p className="text-sm font-medium text-gray-900">
                      {formatChangeDescription(change)}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Type: {change.type}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Removed changes */}
          {diff.changesRemoved.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs rounded">
                  -{diff.changesRemoved.length}
                </span>
                Changes Removed
              </h3>
              <div className="space-y-2">
                {diff.changesRemoved.map((change) => (
                  <div
                    key={change.id}
                    className="border-l-4 border-red-500 bg-red-50 pl-4 py-2"
                  >
                    <p className="text-sm font-medium text-gray-900 line-through">
                      {formatChangeDescription(change)}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Type: {change.type}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Modified changes */}
          {diff.changesModified.length > 0 && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded">
                  ~{diff.changesModified.length}
                </span>
                Changes Modified
              </h3>
              <div className="space-y-3">
                {diff.changesModified.map((mod) => (
                  <div
                    key={mod.changeId}
                    className="border-l-4 border-yellow-500 bg-yellow-50 pl-4 py-2"
                  >
                    <p className="text-sm font-medium text-gray-900 mb-2">
                      {formatChangeDescription(mod.oldChange)}
                    </p>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-red-600">Old:</span>
                        <code className="bg-white px-2 py-1 rounded text-xs">
                          {JSON.stringify(mod.oldChange.changes, null, 2)}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">New:</span>
                        <code className="bg-white px-2 py-1 rounded text-xs">
                          {JSON.stringify(mod.newChange.changes, null, 2)}
                        </code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No changes */}
          {diff.changesAdded.length === 0 &&
            diff.changesRemoved.length === 0 &&
            diff.changesModified.length === 0 &&
            !diff.nameChanged &&
            !diff.descriptionChanged &&
            !diff.tagsChanged && (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg">No differences found</p>
                <p className="text-gray-400 text-sm mt-2">
                  These versions are identical
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
