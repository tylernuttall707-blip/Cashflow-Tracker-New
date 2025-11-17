/**
 * PDF generation utilities for Cash Flow Tracker
 * Uses jsPDF and autoTable plugin
 */

import type { ProjectionResult, AppState, YMDString, TransactionDetail } from '../types';
import { fmtMoney } from '../modules/calculations';
import { toYMD, fromYMD, compareYMD } from '../modules/dateUtils';

declare const window: any;

/**
 * Get jsPDF library from window
 */
function getJsPDF(): any {
  const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
  if (typeof jsPDF !== 'function') {
    throw new Error('PDF generator not available.');
  }
  return jsPDF;
}

/**
 * Check if autoTable plugin is available
 */
function checkAutoTable(doc: any): void {
  if (typeof doc.autoTable !== 'function') {
    throw new Error('PDF table plugin not available.');
  }
}

/**
 * Format date for display in PDF (or return dash)
 */
function formatDateOrDash(ymd: YMDString | null): string {
  if (!ymd) return '—';
  try {
    const d = fromYMD(ymd);
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return ymd;
  }
}

/**
 * Generate PDF for next 30 days cash flow
 */
export function generateNext30DaysPDF(
  projection: ProjectionResult,
  todayYMD: YMDString
): void {
  try {
    const jsPDF = getJsPDF();
    const { cal } = projection;

    // Calculate date range
    const end = fromYMD(todayYMD);
    end.setDate(end.getDate() + 29);
    const endYMD = toYMD(end);

    // Filter to next 30 days
    const next30 = cal.filter(
      (row) =>
        compareYMD(row.date, todayYMD) >= 0 && compareYMD(row.date, endYMD) <= 0
    );

    if (!next30.length) {
      alert('No projection data for the next 30 days.');
      return;
    }

    // Create PDF document
    const doc = new jsPDF({ orientation: 'landscape' });
    checkAutoTable(doc);

    // Title and header
    doc.setFontSize(16);
    doc.text('Next 30 Days Cash Flow', 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated on ${todayYMD}`, 14, 22);

    // Prepare table data
    const tableBody = next30.map((row) => {
      const incomeDetails =
        Array.isArray(row.incomeDetails) && row.incomeDetails.length
          ? row.incomeDetails
              .map((item: TransactionDetail) => `${item.source}: ${fmtMoney(item.amount)}`)
              .join('\n')
          : '—';

      const expenseDetails =
        Array.isArray(row.expenseDetails) && row.expenseDetails.length
          ? row.expenseDetails
              .map((item: TransactionDetail) => `${item.source}: ${fmtMoney(item.amount)}`)
              .join('\n')
          : '—';

      return [
        row.date,
        fmtMoney(row.income),
        incomeDetails,
        fmtMoney(row.expenses),
        expenseDetails,
        fmtMoney(row.running),
      ];
    });

    // Generate table
    doc.autoTable({
      startY: 28,
      head: [['Date', 'Income', 'Income Sources', 'Expenses', 'Expense Sources', 'Bank Balance']],
      body: tableBody,
      styles: { valign: 'top', fontSize: 9 },
      columnStyles: {
        2: { cellWidth: 70 },
        4: { cellWidth: 70 },
      },
      headStyles: { fillColor: [15, 23, 42] },
    });

    // Save PDF
    doc.save(`cashflow-next-30-days-${todayYMD}.pdf`);
  } catch (error) {
    if (error instanceof Error) {
      alert(error.message);
    } else {
      alert('Failed to generate PDF');
    }
    console.error('PDF generation error:', error);
  }
}

/**
 * Generate comprehensive snapshot PDF with metrics, chart, and upcoming table
 */
export function generateSnapshotPDF(
  projection: ProjectionResult,
  state: AppState,
  todayYMD: YMDString,
  chartCanvas: HTMLCanvasElement | null
): void {
  try {
    const jsPDF = getJsPDF();
    const doc = new jsPDF({ orientation: 'landscape' });
    checkAutoTable(doc);

    const { settings } = state;

    // Title and header
    doc.setFontSize(18);
    doc.text('Cash Flow Snapshot', 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated on ${todayYMD}`, 14, 22);

    if (settings?.startDate || settings?.endDate) {
      const rangeText = `Model Range: ${settings?.startDate || '—'} to ${settings?.endDate || '—'}`;
      doc.text(rangeText, 14, 28);
    }

    // Quick stats table
    const quickStatsRows = [
      ['Projected End Balance', fmtMoney(projection.endBalance), '—'],
      ['Total Planned Income', fmtMoney(projection.totalIncome), '—'],
      ['Projected Weekly Income', fmtMoney(projection.projectedWeeklyIncome), '—'],
      ['Total Planned Expenses', fmtMoney(projection.totalExpenses), '—'],
      [
        'Lowest Projected Balance',
        fmtMoney(projection.lowestBalance),
        formatDateOrDash(projection.lowestBalanceDate),
      ],
      [
        'Peak Projected Balance',
        fmtMoney(projection.peakBalance),
        formatDateOrDash(projection.peakBalanceDate),
      ],
      ['Days Below $0', String(projection.negativeDays), '—'],
      ['First Negative Day', formatDateOrDash(projection.firstNegativeDate), '—'],
    ];

    doc.autoTable({
      startY: 35,
      head: [['Metric', 'Value', 'Date / Notes']],
      body: quickStatsRows,
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [15, 23, 42] },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 45 },
      },
    });

    // Add chart image
    const chartStartY = (doc.lastAutoTable?.finalY || 35) + 10;
    if (chartCanvas) {
      try {
        const chartDataUrl = chartCanvas.toDataURL('image/png', 1.0);
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 14;
        const availableWidth = pageWidth - margin * 2;

        let imageY = chartStartY;
        if (imageY + 10 > pageHeight) imageY = margin;

        const availableHeight = pageHeight - imageY - margin;

        if (availableWidth > 0 && availableHeight > 0) {
          const imgProps = doc.getImageProperties(chartDataUrl);
          let imgWidth = availableWidth;
          let imgHeight = (imgProps.height * imgWidth) / imgProps.width;

          if (imgHeight > availableHeight) {
            imgHeight = availableHeight;
            imgWidth = (imgProps.width * imgHeight) / imgProps.height;
          }

          doc.addImage(chartDataUrl, 'PNG', margin, imageY, imgWidth, imgHeight);
        }
      } catch (err) {
        console.warn('Failed to render chart in PDF', err);
        doc.setFontSize(12);
        doc.text('Projected balance chart unavailable for export.', 14, chartStartY);
      }
    } else {
      doc.setFontSize(12);
      doc.text('Projected balance chart unavailable for export.', 14, chartStartY);
    }

    // Add new page for upcoming 14 days
    doc.addPage();
    doc.setFontSize(16);
    doc.text('Upcoming 14 Days', 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated on ${todayYMD}`, 14, 22);

    const next14 = Array.isArray(projection.cal) ? projection.cal.slice(0, 14) : [];

    if (next14.length) {
      const upcomingBody = next14.map((row) => [
        row.date,
        fmtMoney(row.income),
        fmtMoney(row.expenses),
        fmtMoney(row.net),
        fmtMoney(row.running),
      ]);

      doc.autoTable({
        startY: 28,
        head: [['Date', 'Income', 'Expenses', 'Net', 'Running']],
        body: upcomingBody,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: {
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 35 },
          4: { cellWidth: 35 },
        },
      });
    } else {
      doc.setFontSize(12);
      doc.text('No projection data available for the next 14 days.', 14, 32);
    }

    // Save PDF
    doc.save(`cash-flow-snapshot-${todayYMD}.pdf`);
  } catch (error) {
    if (error instanceof Error) {
      alert(error.message);
    } else {
      alert('Failed to generate PDF');
    }
    console.error('PDF generation error:', error);
  }
}

/**
 * Check if PDF libraries are available
 */
export function isPDFAvailable(): boolean {
  try {
    const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
    return typeof jsPDF === 'function';
  } catch {
    return false;
  }
}
