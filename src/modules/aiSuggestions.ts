/**
 * AI Suggestions Module - Pattern detection and scenario recommendations
 * This is a simplified/mock implementation for Phase 4
 */

import type {
  AppState,
  ProjectionResult,
  ScenarioSuggestion,
  FinancialPattern,
  ScenarioChange,
  Scenario,
} from '../types';

/**
 * Generate a unique ID
 */
const uid = (): string => crypto.randomUUID();

/**
 * Analyze financial state and detect patterns
 * @param state - Current app state
 * @param projection - Current projection result
 * @returns Array of detected patterns
 */
export function detectFinancialPatterns(
  state: AppState,
  projection: ProjectionResult
): FinancialPattern[] {
  const patterns: FinancialPattern[] = [];

  // Pattern 1: High expenses in specific categories
  const expensesByCategory = new Map<string, number>();
  state.expandedTransactions
    .filter((tx) => tx.amount < 0)
    .forEach((tx) => {
      const category = tx.category || 'Uncategorized';
      const current = expensesByCategory.get(category) || 0;
      expensesByCategory.set(category, current + Math.abs(tx.amount));
    });

  const totalExpenses = Array.from(expensesByCategory.values()).reduce((sum, val) => sum + val, 0);

  expensesByCategory.forEach((amount, category) => {
    const percentage = (amount / totalExpenses) * 100;
    if (percentage > 30) {
      patterns.push({
        id: uid(),
        type: 'high_expenses',
        severity: percentage > 50 ? 'critical' : 'warning',
        title: `High spending in ${category}`,
        description: `${category} accounts for ${percentage.toFixed(1)}% of total expenses ($${amount.toFixed(2)})`,
        affectedCategory: category,
        metrics: {
          categoryAmount: amount,
          totalExpenses,
          percentage,
        },
      });
    }
  });

  // Pattern 2: Declining balance
  if (projection.daily.length > 30) {
    const first30DayAvg =
      projection.daily.slice(0, 30).reduce((sum, day) => sum + day.balance, 0) / 30;
    const last30DayAvg =
      projection.daily
        .slice(-30)
        .reduce((sum, day) => sum + day.balance, 0) / 30;

    const decline = first30DayAvg - last30DayAvg;
    const declinePercentage = (decline / first30DayAvg) * 100;

    if (declinePercentage > 10) {
      patterns.push({
        id: uid(),
        type: 'declining_balance',
        severity: declinePercentage > 30 ? 'critical' : 'warning',
        title: 'Declining balance trend',
        description: `Your balance is declining by ${declinePercentage.toFixed(1)}% over the projection period`,
        metrics: {
          initialAverage: first30DayAvg,
          finalAverage: last30DayAvg,
          decline,
          declinePercentage,
        },
      });
    }
  }

  // Pattern 3: Low income
  const totalIncome = state.expandedTransactions
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);

  if (totalExpenses > totalIncome * 0.9) {
    const ratio = (totalExpenses / totalIncome) * 100;
    patterns.push({
      id: uid(),
      type: 'low_income',
      severity: ratio > 100 ? 'critical' : 'warning',
      title: 'Expenses approaching income',
      description: `Your expenses are ${ratio.toFixed(1)}% of your income`,
      metrics: {
        totalIncome,
        totalExpenses,
        ratio,
        difference: totalIncome - totalExpenses,
      },
    });
  }

  // Pattern 4: Irregular income (coefficient of variation)
  const incomeTransactions = state.expandedTransactions.filter((tx) => tx.amount > 0);
  if (incomeTransactions.length > 1) {
    const amounts = incomeTransactions.map((tx) => tx.amount);
    const mean = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
    const variance =
      amounts.reduce((sum, amt) => sum + Math.pow(amt - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = (stdDev / mean) * 100;

    if (coefficientOfVariation > 30) {
      patterns.push({
        id: uid(),
        type: 'irregular_income',
        severity: 'info',
        title: 'Irregular income pattern',
        description: `Your income varies significantly (CV: ${coefficientOfVariation.toFixed(1)}%)`,
        metrics: {
          mean,
          stdDev,
          coefficientOfVariation,
          count: incomeTransactions.length,
        },
      });
    }
  }

  return patterns;
}

/**
 * Generate scenario suggestions based on patterns and state
 * @param state - Current app state
 * @param projection - Current projection result
 * @param patterns - Detected patterns
 * @param existingScenarios - Existing scenarios to avoid duplicates
 * @returns Array of scenario suggestions
 */
export function generateScenarioSuggestions(
  state: AppState,
  projection: ProjectionResult,
  patterns: FinancialPattern[],
  existingScenarios: Scenario[] = []
): ScenarioSuggestion[] {
  const suggestions: ScenarioSuggestion[] = [];

  // Suggestion 1: Cost reduction for high expense categories
  const highExpensePatterns = patterns.filter((p) => p.type === 'high_expenses');
  highExpensePatterns.forEach((pattern) => {
    if (!pattern.affectedCategory) return;

    const reductionPercent = 20;
    const potentialSavings = (pattern.metrics.categoryAmount || 0) * (reductionPercent / 100);

    suggestions.push({
      id: uid(),
      type: 'optimization',
      title: `Reduce ${pattern.affectedCategory} expenses`,
      description: `Cut ${pattern.affectedCategory} spending by ${reductionPercent}%`,
      reasoning: `${pattern.affectedCategory} is a high-expense category. Reducing it by ${reductionPercent}% could save $${potentialSavings.toFixed(2)}.`,
      suggestedChanges: [
        {
          id: uid(),
          type: 'expense_adjust',
          description: `Reduce ${pattern.affectedCategory} by ${reductionPercent}%`,
          targetType: 'expense',
          targetId: pattern.affectedCategory,
          changes: {
            percentChange: -reductionPercent,
            category: pattern.affectedCategory,
          },
        },
      ],
      priority: pattern.severity === 'critical' ? 'high' : 'medium',
      estimatedImpact: {
        endBalanceChange: potentialSavings,
      },
    });
  });

  // Suggestion 2: Income increase for low income patterns
  const lowIncomePattern = patterns.find((p) => p.type === 'low_income');
  if (lowIncomePattern) {
    const currentIncome = lowIncomePattern.metrics.totalIncome || 0;
    const currentExpenses = lowIncomePattern.metrics.totalExpenses || 0;
    const neededIncrease = ((currentExpenses - currentIncome) / currentIncome) * 100 + 10; // +10% buffer

    suggestions.push({
      id: uid(),
      type: 'risk_mitigation',
      title: 'Increase income to cover expenses',
      description: `Boost income by ${neededIncrease.toFixed(1)}% to maintain positive cash flow`,
      reasoning: `Your expenses are very close to your income. Increasing income provides a safety buffer.`,
      suggestedChanges: [
        {
          id: uid(),
          type: 'income_adjust',
          description: `Increase income by ${neededIncrease.toFixed(1)}%`,
          targetType: 'income',
          changes: {
            percentChange: neededIncrease,
          },
        },
      ],
      priority: 'high',
      estimatedImpact: {
        endBalanceChange: currentIncome * (neededIncrease / 100),
      },
    });
  }

  // Suggestion 3: Emergency fund for declining balance
  const decliningPattern = patterns.find((p) => p.type === 'declining_balance');
  if (decliningPattern) {
    suggestions.push({
      id: uid(),
      type: 'risk_mitigation',
      title: 'Build emergency fund',
      description: 'Add one-time income to build reserves',
      reasoning: `Your balance is declining. Adding to your emergency fund can provide a buffer against unexpected expenses.`,
      suggestedChanges: [
        {
          id: uid(),
          type: 'transaction_add',
          description: 'Emergency fund contribution',
          changes: {
            newTransaction: {
              id: uid(),
              description: 'Emergency fund boost',
              amount: 2000,
              isRecurring: false,
              date: new Date().toISOString().split('T')[0],
              category: 'Savings',
            },
          },
        },
      ],
      priority: decliningPattern.severity === 'critical' ? 'high' : 'medium',
      estimatedImpact: {
        endBalanceChange: 2000,
      },
    });
  }

  // Suggestion 4: Conservative planning for irregular income
  const irregularIncomePattern = patterns.find((p) => p.type === 'irregular_income');
  if (irregularIncomePattern) {
    suggestions.push({
      id: uid(),
      type: 'optimization',
      title: 'Plan for income variability',
      description: 'Reduce income by 15% to account for variability',
      reasoning: `Your income is irregular. Planning with a conservative estimate helps manage cash flow.`,
      suggestedChanges: [
        {
          id: uid(),
          type: 'income_adjust',
          description: 'Conservative income adjustment',
          targetType: 'income',
          changes: {
            percentChange: -15,
          },
        },
      ],
      priority: 'medium',
      estimatedImpact: {
        endBalanceChange: -((irregularIncomePattern.metrics.mean || 0) * 0.15),
      },
    });
  }

  // Suggestion 5: General optimization - balanced approach
  if (projection.lowestBalance && projection.lowestBalance < state.startingBalance * 0.5) {
    suggestions.push({
      id: uid(),
      type: 'optimization',
      title: 'Balanced budget optimization',
      description: 'Reduce expenses by 10% and increase income by 5%',
      reasoning: `Your projected lowest balance is significantly lower than your starting balance. A balanced approach can help.`,
      suggestedChanges: [
        {
          id: uid(),
          type: 'expense_adjust',
          description: 'Reduce all expenses by 10%',
          targetType: 'expense',
          changes: {
            percentChange: -10,
          },
        },
        {
          id: uid(),
          type: 'income_adjust',
          description: 'Increase income by 5%',
          targetType: 'income',
          changes: {
            percentChange: 5,
          },
        },
      ],
      priority: 'medium',
    });
  }

  // Suggestion 6: Opportunity - if doing well
  if (
    projection.endBalance > state.startingBalance * 1.2 &&
    projection.lowestBalance > state.startingBalance
  ) {
    suggestions.push({
      id: uid(),
      type: 'opportunity',
      title: 'Investment opportunity',
      description: 'Your cash flow is strong - consider investing surplus',
      reasoning: `Your projections show consistent growth. Consider investing surplus funds for better returns.`,
      suggestedChanges: [
        {
          id: uid(),
          type: 'transaction_add',
          description: 'Monthly investment',
          changes: {
            newTransaction: {
              id: uid(),
              description: 'Investment contribution',
              amount: -500,
              isRecurring: true,
              frequency: 'monthly',
              date: new Date().toISOString().split('T')[0],
              category: 'Investment',
            },
          },
        },
      ],
      priority: 'low',
      estimatedImpact: {
        endBalanceChange: -500,
      },
    });
  }

  return suggestions;
}

/**
 * Apply a suggestion to create a new scenario
 * @param suggestion - The suggestion to apply
 * @param baseName - Base name for the scenario
 * @returns Scenario
 */
export function applySuggestionToScenario(
  suggestion: ScenarioSuggestion,
  baseName?: string
): Scenario {
  const now = new Date().toISOString();
  const name = baseName || `AI: ${suggestion.title}`;

  // Color based on suggestion type
  const colorMap: Record<ScenarioSuggestion['type'], string> = {
    optimization: '#10B981',
    risk_mitigation: '#F59E0B',
    pattern_detected: '#6366F1',
    opportunity: '#3B82F6',
  };

  return {
    id: uid(),
    name,
    description: suggestion.description + '\n\n' + suggestion.reasoning,
    color: colorMap[suggestion.type],
    createdAt: now,
    updatedAt: now,
    changes: JSON.parse(JSON.stringify(suggestion.suggestedChanges)),
    tags: ['ai-suggested', suggestion.type],
    currentVersionNumber: 1,
  };
}

/**
 * Get AI recommendations summary
 * @param suggestions - Array of suggestions
 * @returns Summary object
 */
export function getRecommendationsSummary(suggestions: ScenarioSuggestion[]): {
  totalSuggestions: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  highPrioritySuggestions: ScenarioSuggestion[];
} {
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};

  suggestions.forEach((suggestion) => {
    byType[suggestion.type] = (byType[suggestion.type] || 0) + 1;
    byPriority[suggestion.priority] = (byPriority[suggestion.priority] || 0) + 1;
  });

  const highPrioritySuggestions = suggestions.filter((s) => s.priority === 'high');

  return {
    totalSuggestions: suggestions.length,
    byType,
    byPriority,
    highPrioritySuggestions,
  };
}
