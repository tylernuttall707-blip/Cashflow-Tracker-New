/**
 * ComparisonChart Component - Multi-line chart for scenario comparison
 */

import { useEffect, useRef } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import type { ProjectionResult, Scenario } from '../types';
import { fromYMD } from '../modules/dateUtils';

// Register Chart.js components
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface ComparisonChartProps {
  baselineProjection: ProjectionResult;
  scenarioProjections: Record<string, ProjectionResult>;
  scenarios: Scenario[];
  selectedScenarioIds: string[];
  days?: number; // Number of days to show (default: 90)
}

export function ComparisonChart({
  baselineProjection,
  scenarioProjections,
  scenarios,
  selectedScenarioIds,
  days = 90,
}: ComparisonChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    // Prepare data
    const labels = baselineProjection.cal.slice(0, days).map((day) => {
      const date = fromYMD(day.date);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });

    const datasets = [];

    // Baseline dataset
    datasets.push({
      label: 'Baseline',
      data: baselineProjection.cal.slice(0, days).map((day) => day.running),
      borderColor: '#6b7280',
      backgroundColor: 'rgba(107, 116, 128, 0.1)',
      borderWidth: 2,
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 4,
    });

    // Scenario datasets
    selectedScenarioIds.forEach((scenarioId) => {
      const scenario = scenarios.find((s) => s.id === scenarioId);
      const projection = scenarioProjections[scenarioId];

      if (scenario && projection) {
        datasets.push({
          label: scenario.name,
          data: projection.cal.slice(0, days).map((day) => day.running),
          borderColor: scenario.color,
          backgroundColor: `${scenario.color}20`, // 20% opacity
          borderWidth: 2,
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 4,
        });
      }
    });

    // Create chart
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          title: {
            display: true,
            text: 'Balance Projection Comparison',
            font: {
              size: 16,
              weight: 'bold',
            },
          },
          tooltip: {
            callbacks: {
              label: (context: any) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (value === null || value === undefined) return label;
                return `${label}: $${value.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`;
              },
            },
          },
          legend: {
            display: true,
            position: 'bottom',
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Date',
            },
            ticks: {
              maxTicksLimit: 12,
              maxRotation: 45,
              minRotation: 45,
            },
          },
          y: {
            title: {
              display: true,
              text: 'Balance ($)',
            },
            ticks: {
              callback: (value: any) => {
                return '$' + (value as number).toLocaleString();
              },
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [baselineProjection, scenarioProjections, scenarios, selectedScenarioIds, days]);

  return (
    <div className="comparison-chart-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
