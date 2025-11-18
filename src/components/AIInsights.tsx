import { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { analyzeTransactionPatterns, type AIInsight } from '../modules/aiPatternDetection';
import './AIInsights.css';

export function AIInsights() {
  const state = useAppStore();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());

  // Generate AI insights
  const insights = useMemo(() => {
    return analyzeTransactionPatterns(state);
  }, [state]);

  // Filter insights by category
  const filteredInsights = useMemo(() => {
    if (selectedCategory === 'all') return insights;
    return insights.filter(insight => insight.category === selectedCategory);
  }, [insights, selectedCategory]);

  // Group insights by type
  const insightsByType = useMemo(() => {
    const grouped: Record<string, AIInsight[]> = {
      warning: [],
      suggestion: [],
      prediction: [],
      pattern: []
    };
    filteredInsights.forEach(insight => {
      grouped[insight.type].push(insight);
    });
    return grouped;
  }, [filteredInsights]);

  // Count by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: insights.length,
      overdraft: 0,
      optimization: 0,
      seasonal: 0,
      trend: 0,
      cashflow: 0
    };
    insights.forEach(insight => {
      counts[insight.category]++;
    });
    return counts;
  }, [insights]);

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedInsights);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedInsights(newExpanded);
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'warning': return '⚠️';
      case 'suggestion': return '💡';
      case 'prediction': return '🔮';
      case 'pattern': return '📊';
      default: return '📌';
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'overdraft': return 'Overdraft Risks';
      case 'optimization': return 'Optimizations';
      case 'seasonal': return 'Seasonal Patterns';
      case 'trend': return 'Trends';
      case 'cashflow': return 'Cash Flow';
      case 'all': return 'All Insights';
      default: return category;
    }
  };

  const renderInsightCard = (insight: AIInsight) => {
    const isExpanded = expandedInsights.has(insight.id);

    return (
      <div key={insight.id} className={`insight-card insight-${insight.severity}`}>
        <div className="insight-header" onClick={() => toggleExpanded(insight.id)}>
          <div className="insight-icons">
            <span className="insight-type-icon" title={insight.type}>
              {getTypeIcon(insight.type)}
            </span>
            <span className="insight-severity-icon" title={insight.severity}>
              {getSeverityIcon(insight.severity)}
            </span>
          </div>
          <div className="insight-title-section">
            <h3 className="insight-title">{insight.title}</h3>
            <span className="insight-category-badge">{getCategoryLabel(insight.category)}</span>
          </div>
          <button className="insight-expand-btn" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? '▼' : '▶'}
          </button>
        </div>

        <div className="insight-description">
          {insight.description}
        </div>

        {isExpanded && (
          <div className="insight-details">
            {insight.suggestedAction && (
              <div className="insight-action">
                <strong>💡 Suggested Action:</strong>
                <p>{insight.suggestedAction}</p>
              </div>
            )}

            {insight.impact !== undefined && (
              <div className="insight-impact">
                <strong>💰 Financial Impact:</strong>
                <span className="impact-amount">
                  ${Math.abs(insight.impact).toFixed(2)}
                </span>
              </div>
            )}

            {insight.relatedDates && insight.relatedDates.length > 0 && (
              <div className="insight-dates">
                <strong>📅 Related Dates:</strong>
                <span>{insight.relatedDates.join(', ')}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderInsightSection = (type: string, typeInsights: AIInsight[]) => {
    if (typeInsights.length === 0) return null;

    const sectionTitles: Record<string, string> = {
      warning: 'Warnings & Alerts',
      suggestion: 'Optimization Suggestions',
      prediction: 'Predictions & Forecasts',
      pattern: 'Patterns & Trends'
    };

    return (
      <div key={type} className="insight-section">
        <h2 className="insight-section-title">
          {getTypeIcon(type)} {sectionTitles[type]} ({typeInsights.length})
        </h2>
        <div className="insight-list">
          {typeInsights.map(renderInsightCard)}
        </div>
      </div>
    );
  };

  return (
    <div className="ai-insights-container">
      <div className="ai-insights-header">
        <h1>🤖 AI Pattern Detection</h1>
        <p className="ai-insights-subtitle">
          Intelligent analysis of your cash flow with personalized recommendations
        </p>
      </div>

      {insights.length === 0 ? (
        <div className="no-insights">
          <div className="no-insights-icon">🎯</div>
          <h2>No Insights Yet</h2>
          <p>
            Add more transactions to your cash flow tracker and the AI will analyze patterns,
            detect potential issues, and suggest optimizations.
          </p>
        </div>
      ) : (
        <>
          <div className="category-filters">
            <button
              className={`filter-btn ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              All ({categoryCounts.all})
            </button>
            {categoryCounts.overdraft > 0 && (
              <button
                className={`filter-btn ${selectedCategory === 'overdraft' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('overdraft')}
              >
                ⚠️ Overdraft Risks ({categoryCounts.overdraft})
              </button>
            )}
            {categoryCounts.optimization > 0 && (
              <button
                className={`filter-btn ${selectedCategory === 'optimization' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('optimization')}
              >
                💡 Optimizations ({categoryCounts.optimization})
              </button>
            )}
            {categoryCounts.seasonal > 0 && (
              <button
                className={`filter-btn ${selectedCategory === 'seasonal' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('seasonal')}
              >
                🌦️ Seasonal ({categoryCounts.seasonal})
              </button>
            )}
            {categoryCounts.trend > 0 && (
              <button
                className={`filter-btn ${selectedCategory === 'trend' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('trend')}
              >
                📈 Trends ({categoryCounts.trend})
              </button>
            )}
            {categoryCounts.cashflow > 0 && (
              <button
                className={`filter-btn ${selectedCategory === 'cashflow' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('cashflow')}
              >
                💰 Cash Flow ({categoryCounts.cashflow})
              </button>
            )}
          </div>

          <div className="insights-content">
            {renderInsightSection('warning', insightsByType.warning)}
            {renderInsightSection('suggestion', insightsByType.suggestion)}
            {renderInsightSection('prediction', insightsByType.prediction)}
            {renderInsightSection('pattern', insightsByType.pattern)}
          </div>

          {filteredInsights.length === 0 && (
            <div className="no-filtered-insights">
              <p>No insights in this category</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
