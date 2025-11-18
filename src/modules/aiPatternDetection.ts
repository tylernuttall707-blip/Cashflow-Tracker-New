import type { AppState, ProjectionResult, CalendarRow } from '../types';
import { computeProjection } from './calculations';
import { fromYMD, toYMD } from './dateUtils';

// ============================================================================
// AI Insight Types
// ============================================================================

export interface AIInsight {
  id: string;
  type: 'warning' | 'suggestion' | 'prediction' | 'pattern';
  category: 'overdraft' | 'optimization' | 'seasonal' | 'trend' | 'cashflow';
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  actionable?: boolean;
  suggestedAction?: string;
  relatedDates?: string[];
  impact?: number; // Potential financial impact
}

export interface SeasonalPattern {
  month: number;
  monthName: string;
  avgIncome: number;
  avgExpense: number;
  avgBalance: number;
  transactionCount: number;
  trend: 'high' | 'normal' | 'low';
}

export interface OverdraftRisk {
  date: string;
  balance: number;
  severity: 'high' | 'medium' | 'low';
  daysUntil: number;
}

export interface OptimizationSuggestion {
  transactionName: string;
  currentDay: number;
  suggestedDay: number;
  reason: string;
  potentialSavings: number;
  affectedDates: string[];
}

// ============================================================================
// Main AI Analysis Function
// ============================================================================

export function analyzeTransactionPatterns(state: AppState): AIInsight[] {
  const insights: AIInsight[] = [];

  // Compute projection for analysis
  const projection = computeProjection(state);

  // Run all analysis functions
  insights.push(...analyzeOverdrafts(state, projection));
  insights.push(...analyzeSeasonalPatterns(state, projection));
  insights.push(...analyzeCashFlowPatterns(state, projection));
  insights.push(...generateOptimizationSuggestions(state, projection));
  insights.push(...analyzeTrends(state, projection));

  // Sort by severity and type
  return insights.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    const typeOrder = { warning: 0, suggestion: 1, prediction: 2, pattern: 3 };
    return typeOrder[a.type] - typeOrder[b.type];
  });
}

// ============================================================================
// Overdraft Detection & Analysis
// ============================================================================

function analyzeOverdrafts(_state: AppState, projection: ProjectionResult): AIInsight[] {
  const insights: AIInsight[] = [];
  const overdraftDays = projection.cal.filter((day: CalendarRow) => day.running < 0);

  if (overdraftDays.length === 0) {
    return insights;
  }

  // Find the first overdraft
  const firstOverdraft = overdraftDays[0];
  const today = new Date();
  const firstOverdraftDate = fromYMD(firstOverdraft.date);
  const daysUntil = Math.ceil((firstOverdraftDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // Analyze what caused the overdraft
  const dayBefore = projection.cal.find((d: CalendarRow) => {
    const date = fromYMD(d.date);
    const targetDate = fromYMD(firstOverdraft.date);
    date.setDate(date.getDate() + 1);
    return toYMD(date) === toYMD(targetDate);
  });

  if (dayBefore && dayBefore.running >= 0) {
    // Large expenses on the day caused the overdraft
    if (firstOverdraft.expenses > 0) {
      // Find the largest expense source
      const largestExpense = firstOverdraft.expenseDetails.reduce((max: any, detail: any) =>
        detail.amount > (max?.amount || 0) ? detail : max, null
      );

      if (largestExpense && largestExpense.amount > Math.abs(firstOverdraft.running)) {
        insights.push({
          id: `overdraft-warning-${firstOverdraft.date}`,
          type: 'warning',
          category: 'overdraft',
          title: 'Overdraft Risk Detected',
          description: daysUntil > 0
            ? `Your balance will go negative in ${daysUntil} days on ${firstOverdraft.date} due to ${largestExpense.source} ($${largestExpense.amount.toFixed(2)}). Balance: $${firstOverdraft.running.toFixed(2)}`
            : `Your balance is negative on ${firstOverdraft.date} due to ${largestExpense.source} ($${largestExpense.amount.toFixed(2)}). Balance: $${firstOverdraft.running.toFixed(2)}`,
          severity: firstOverdraft.running < -1000 ? 'high' : firstOverdraft.running < -100 ? 'medium' : 'low',
          actionable: true,
          suggestedAction: `Consider moving ${largestExpense.source} to a later date when you have sufficient funds`,
          relatedDates: [firstOverdraft.date],
          impact: Math.abs(firstOverdraft.running)
        });
      }
    }
  }

  // Check for recurring overdrafts
  if (overdraftDays.length >= 3) {
    insights.push({
      id: 'recurring-overdraft-pattern',
      type: 'pattern',
      category: 'overdraft',
      title: 'Recurring Overdraft Pattern',
      description: `Your balance goes negative on ${overdraftDays.length} days in the projection period. This suggests a structural cash flow issue.`,
      severity: 'high',
      actionable: true,
      suggestedAction: 'Review your recurring expenses and consider adjusting payment dates or amounts',
      relatedDates: overdraftDays.map((d: CalendarRow) => d.date),
      impact: Math.min(...overdraftDays.map((d: CalendarRow) => d.running))
    });
  }

  return insights;
}

// ============================================================================
// Seasonal Pattern Analysis
// ============================================================================

function analyzeSeasonalPatterns(state: AppState, projection: ProjectionResult): AIInsight[] {
  const insights: AIInsight[] = [];

  // Group transactions by month
  const monthlyData = new Map<number, {
    income: number[];
    expense: number[];
    balance: number[];
  }>();

  projection.cal.forEach((day: CalendarRow) => {
    const date = fromYMD(day.date);
    const month = date.getMonth();

    if (!monthlyData.has(month)) {
      monthlyData.set(month, { income: [], expense: [], balance: [] });
    }

    const data = monthlyData.get(month)!;

    data.income.push(day.income);
    data.expense.push(day.expenses);
    data.balance.push(day.running);
  });

  // Analyze each month
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  const monthlyPatterns: SeasonalPattern[] = [];

  monthlyData.forEach((data, month) => {
    if (data.expense.length === 0) return;

    const avgIncome = data.income.reduce((a, b) => a + b, 0) / data.income.length;
    const avgExpense = data.expense.reduce((a, b) => a + b, 0) / data.expense.length;
    const avgBalance = data.balance.reduce((a, b) => a + b, 0) / data.balance.length;

    monthlyPatterns.push({
      month,
      monthName: monthNames[month],
      avgIncome,
      avgExpense,
      avgBalance,
      transactionCount: data.income.length + data.expense.length,
      trend: avgExpense > avgIncome * 1.2 ? 'high' : avgExpense < avgIncome * 0.8 ? 'low' : 'normal'
    });
  });

  // Find months with high expenses
  const overallAvgExpense = monthlyPatterns.reduce((sum, m) => sum + m.avgExpense, 0) / monthlyPatterns.length;
  const highExpenseMonths = monthlyPatterns.filter(m => m.avgExpense > overallAvgExpense * 1.3);

  if (highExpenseMonths.length > 0) {
    highExpenseMonths.forEach(month => {
      insights.push({
        id: `seasonal-high-expense-${month.month}`,
        type: 'prediction',
        category: 'seasonal',
        title: `Seasonal Pattern: ${month.monthName}`,
        description: `Your expenses typically spike in ${month.monthName} (avg: $${month.avgExpense.toFixed(2)}/day vs overall avg: $${overallAvgExpense.toFixed(2)}/day). This is ${((month.avgExpense / overallAvgExpense - 1) * 100).toFixed(0)}% above average.`,
        severity: month.avgExpense > overallAvgExpense * 1.5 ? 'high' : 'medium',
        actionable: true,
        suggestedAction: `Plan ahead for ${month.monthName} by building a buffer in preceding months`,
        impact: (month.avgExpense - overallAvgExpense) * 30
      });
    });
  }

  // Find months with low balance
  const lowBalanceMonths = monthlyPatterns.filter(m => m.avgBalance < state.settings.startingBalance * 0.3);

  if (lowBalanceMonths.length > 0) {
    lowBalanceMonths.forEach(month => {
      insights.push({
        id: `seasonal-low-balance-${month.month}`,
        type: 'pattern',
        category: 'seasonal',
        title: `Cash Flow Tight in ${month.monthName}`,
        description: `Your balance tends to be lower in ${month.monthName} (avg: $${month.avgBalance.toFixed(2)}). Consider this when planning large expenses.`,
        severity: month.avgBalance < 0 ? 'high' : 'medium',
        actionable: true,
        suggestedAction: `Avoid scheduling large expenses in ${month.monthName}`
      });
    });
  }

  return insights;
}

// ============================================================================
// Cash Flow Pattern Analysis
// ============================================================================

function analyzeCashFlowPatterns(state: AppState, projection: ProjectionResult): AIInsight[] {
  const insights: AIInsight[] = [];

  // Find low balance periods (consecutive days with low balance)
  const lowBalanceThreshold = state.settings.startingBalance * 0.2;
  let lowBalancePeriods: { start: string; end: string; days: number; minBalance: number }[] = [];
  let currentPeriod: { start: string; minBalance: number; days: number } | null = null;

  projection.cal.forEach((day: CalendarRow, index: number) => {
    if (day.running < lowBalanceThreshold) {
      if (!currentPeriod) {
        currentPeriod = { start: day.date, minBalance: day.running, days: 1 };
      } else {
        currentPeriod.days++;
        currentPeriod.minBalance = Math.min(currentPeriod.minBalance, day.running);
      }
    } else if (currentPeriod) {
      if (currentPeriod.days >= 3) {
        const previousDay = projection.cal[index - 1];
        lowBalancePeriods.push({
          start: currentPeriod.start,
          end: previousDay.date,
          days: currentPeriod.days,
          minBalance: currentPeriod.minBalance
        });
      }
      currentPeriod = null;
    }
  });

  // Add final period if still ongoing
  if (currentPeriod !== null) {
    const period = currentPeriod as { start: string; minBalance: number; days: number };
    if (period.days >= 3) {
      const lastDay = projection.cal[projection.cal.length - 1];
      lowBalancePeriods.push({
        start: period.start,
        end: lastDay.date,
        days: period.days,
        minBalance: period.minBalance
      });
    }
  }

  // Report on significant low balance periods
  lowBalancePeriods.forEach((period, index) => {
    insights.push({
      id: `low-balance-period-${index}`,
      type: 'pattern',
      category: 'cashflow',
      title: 'Extended Low Balance Period',
      description: `Your balance will be consistently low from ${period.start} to ${period.end} (${period.days} days), with a minimum of $${period.minBalance.toFixed(2)}.`,
      severity: period.minBalance < 0 ? 'high' : period.minBalance < lowBalanceThreshold * 0.5 ? 'medium' : 'low',
      actionable: true,
      suggestedAction: 'Consider rescheduling discretionary expenses during this period',
      relatedDates: [period.start, period.end]
    });
  });

  // Analyze balance volatility
  const balances = projection.cal.map((d: CalendarRow) => d.running);
  const avgBalance = balances.reduce((a: number, b: number) => a + b, 0) / balances.length;
  const variance = balances.reduce((sum: number, b: number) => sum + Math.pow(b - avgBalance, 2), 0) / balances.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev > avgBalance * 0.5) {
    insights.push({
      id: 'high-volatility',
      type: 'pattern',
      category: 'cashflow',
      title: 'High Cash Flow Volatility',
      description: `Your balance fluctuates significantly (standard deviation: $${stdDev.toFixed(2)}). This indicates irregular cash flow patterns.`,
      severity: 'medium',
      actionable: true,
      suggestedAction: 'Consider smoothing out expenses by adjusting payment schedules'
    });
  }

  return insights;
}

// ============================================================================
// Optimization Suggestions
// ============================================================================

function generateOptimizationSuggestions(_state: AppState, projection: ProjectionResult): AIInsight[] {
  const insights: AIInsight[] = [];

  // Find recurring expenses that occur just before overdrafts
  const overdraftDays = projection.cal.filter((day: CalendarRow) => day.running < 0);

  overdraftDays.forEach((overdraftDay: CalendarRow) => {
    const overdraftDate = fromYMD(overdraftDay.date);

    // Look at expenses in the 5 days before the overdraft
    const daysBeforeOverdraft = projection.cal.filter((day: CalendarRow) => {
      const dayDate = fromYMD(day.date);
      const daysBetween = Math.ceil((overdraftDate.getTime() - dayDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysBetween > 0 && daysBetween <= 5;
    });

    // Find large recurring expenses
    daysBeforeOverdraft.forEach((day: CalendarRow) => {
      const largeExpenses = day.expenseDetails.filter((expense: any) => expense.amount > 100);

      largeExpenses.forEach((expense: any) => {
        // Find when the balance is healthy enough to handle this expense
        const healthyDays = projection.cal.filter((d: CalendarRow) => {
          const dDate = fromYMD(d.date);
          const oDate = fromYMD(overdraftDay.date);
          return dDate > oDate && d.running > expense.amount * 2;
        });

        if (healthyDays.length > 0) {
          const suggestedDate = healthyDays[0].date;
          const currentDate = fromYMD(day.date);
          const suggested = fromYMD(suggestedDate);
          const dayDiff = Math.ceil((suggested.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

          insights.push({
            id: `optimization-${expense.source}-${day.date}`,
            type: 'suggestion',
            category: 'optimization',
            title: `Timing Optimization: ${expense.source}`,
            description: `Moving "${expense.source}" from the ${currentDate.getDate()}${getOrdinalSuffix(currentDate.getDate())} to the ${suggested.getDate()}${getOrdinalSuffix(suggested.getDate())} would prevent an overdraft on ${overdraftDay.date}.`,
            severity: 'high',
            actionable: true,
            suggestedAction: `Reschedule ${expense.source} to occur ${dayDiff} days later`,
            relatedDates: [day.date, suggestedDate, overdraftDay.date],
            impact: Math.abs(overdraftDay.running)
          });
        }
      });
    });
  });

  // Deduplicate similar suggestions
  const uniqueInsights = insights.filter((insight, index, self) =>
    index === self.findIndex((i: any) => i.title === insight.title && i.description === insight.description)
  );

  return uniqueInsights.slice(0, 5); // Limit to top 5 optimization suggestions
}

// ============================================================================
// Trend Analysis & Predictions
// ============================================================================

function analyzeTrends(state: AppState, projection: ProjectionResult): AIInsight[] {
  const insights: AIInsight[] = [];

  // Analyze income vs expense trend
  const totalIncome = projection.totalIncome;
  const totalExpense = projection.totalExpenses;

  const netCashFlow = totalIncome - totalExpense;
  const avgDailyNet = netCashFlow / projection.cal.length;

  if (netCashFlow < 0) {
    insights.push({
      id: 'negative-trend',
      type: 'warning',
      category: 'trend',
      title: 'Negative Cash Flow Trend',
      description: `Your projected expenses ($${totalExpense.toFixed(2)}) exceed your income ($${totalIncome.toFixed(2)}) by $${Math.abs(netCashFlow).toFixed(2)} over the projection period.`,
      severity: 'high',
      actionable: true,
      suggestedAction: 'Review and reduce expenses or increase income to achieve positive cash flow',
      impact: Math.abs(netCashFlow)
    });
  } else if (avgDailyNet > 0) {
    // Positive trend - predict savings
    const yearlyProjection = avgDailyNet * 365;

    insights.push({
      id: 'positive-trend',
      type: 'prediction',
      category: 'trend',
      title: 'Positive Savings Trajectory',
      description: `Based on current patterns, you're saving an average of $${avgDailyNet.toFixed(2)}/day. At this rate, you could save approximately $${yearlyProjection.toFixed(2)} per year.`,
      severity: 'low',
      actionable: false
    });
  }

  // Analyze balance trend
  const firstBalance = projection.cal[0]?.running || state.settings.startingBalance;
  const lastBalance = projection.cal[projection.cal.length - 1]?.running || 0;
  const balanceChange = lastBalance - firstBalance;

  if (balanceChange < -state.settings.startingBalance * 0.5) {
    insights.push({
      id: 'declining-balance',
      type: 'warning',
      category: 'trend',
      title: 'Declining Balance Trend',
      description: `Your balance is projected to decline by $${Math.abs(balanceChange).toFixed(2)} from $${firstBalance.toFixed(2)} to $${lastBalance.toFixed(2)} over the projection period.`,
      severity: 'high',
      actionable: true,
      suggestedAction: 'Review recurring expenses and identify areas to cut costs',
      impact: Math.abs(balanceChange)
    });
  }

  return insights;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
