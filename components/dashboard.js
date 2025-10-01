export function createDashboardRenderer({
  getState,
  computeProjection,
  fmtMoney,
  fmtDate,
  query,
  Chart,
}) {
  let balanceChart;

  const $ = query;

  const renderDashboard = () => {
    const state = getState();
    const {
      cal,
      totalIncome,
      totalExpenses,
      endBalance,
      projectedWeeklyIncome,
      lowestBalance,
      lowestBalanceDate,
      peakBalance,
      peakBalanceDate,
      firstNegativeDate,
      negativeDays,
    } = computeProjection(state);

    $("#kpiEndBalance").textContent = fmtMoney(endBalance);
    $("#kpiIncome").textContent = fmtMoney(totalIncome);
    $("#kpiExpenses").textContent = fmtMoney(totalExpenses);
    const weeklyEl = $("#kpiWeeklyIncome");
    if (weeklyEl) weeklyEl.textContent = fmtMoney(projectedWeeklyIncome);
    const lowestEl = $("#kpiLowestBalance");
    if (lowestEl) lowestEl.textContent = fmtMoney(lowestBalance);
    const lowestDateEl = $("#kpiLowestDate");
    if (lowestDateEl) lowestDateEl.textContent = lowestBalanceDate ? `on ${fmtDate(lowestBalanceDate)}` : "—";
    const peakEl = $("#kpiPeakBalance");
    if (peakEl) peakEl.textContent = fmtMoney(peakBalance);
    const peakDateEl = $("#kpiPeakDate");
    if (peakDateEl) peakDateEl.textContent = peakBalanceDate ? `on ${fmtDate(peakBalanceDate)}` : "—";
    const negDaysEl = $("#kpiNegativeDays");
    if (negDaysEl) negDaysEl.textContent = String(negativeDays);
    const firstNegEl = $("#kpiFirstNegative");
    if (firstNegEl) firstNegEl.textContent = firstNegativeDate ? fmtDate(firstNegativeDate) : "—";

    const labels = cal.map((r) => r.date);
    const data = cal.map((r) => Number(r.running.toFixed(2)));

    const canvasEl = $("#balanceChart");
    if (!canvasEl || typeof Chart !== "function") return;

    const existingChart = typeof Chart?.getChart === "function" ? Chart.getChart(canvasEl) : null;
    if (existingChart) existingChart.destroy();

    if (balanceChart) {
      balanceChart.destroy();
      balanceChart = undefined;
    }

    const ctx = canvasEl.getContext("2d");
    const lineColors = {
      above: "#1b5e20",
      below: "#b71c1c",
    };
    const segmentColor = (segCtx) => {
      const { chart, p0, p1 } = segCtx || {};
      const y0 = p0?.parsed?.y;
      const y1 = p1?.parsed?.y;
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) return lineColors.above;
      if (y0 >= 0 && y1 >= 0) return lineColors.above;
      if (y0 <= 0 && y1 <= 0) return lineColors.below;

      const chartCtx = chart?.ctx;
      if (!chartCtx) return lineColors.above;
      const gradient = chartCtx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
      const total = Math.abs(y0) + Math.abs(y1);
      const ratio = total === 0 ? 0.5 : Math.abs(y0) / total;
      const startColor = y0 >= 0 ? lineColors.above : lineColors.below;
      const endColor = y1 >= 0 ? lineColors.above : lineColors.below;
      const midColor = y0 >= 0 ? lineColors.below : lineColors.above;
      gradient.addColorStop(0, startColor);
      gradient.addColorStop(Math.min(Math.max(ratio, 0), 1), startColor);
      gradient.addColorStop(Math.min(Math.max(ratio, 0), 1), midColor);
      gradient.addColorStop(1, endColor);
      return gradient;
    };

    balanceChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Projected Balance",
            data,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 0,
            borderColor: lineColors.above,
            segment: { borderColor: segmentColor },
            fill: {
              target: { value: 0 },
              above: "rgba(27, 94, 32, 0.15)",
              below: "rgba(183, 28, 28, 0.18)",
            },
          },
        ],
      },
      options: {
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 10 } },
          y: {
            beginAtZero: false,
            grid: {
              color: (gridCtx) => {
                const value = gridCtx.tick && typeof gridCtx.tick.value === "number" ? gridCtx.tick.value : null;
                return value === 0 ? "#0f172a" : "rgba(148, 163, 184, 0.2)";
              },
              lineWidth: (gridCtx) => {
                const value = gridCtx.tick && typeof gridCtx.tick.value === "number" ? gridCtx.tick.value : null;
                return value === 0 ? 2 : 1;
              },
            },
          },
        },
      },
    });

    const tbody = $("#upcomingTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const next14 = cal.slice(0, 14);
    for (const r of next14) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.date}</td>
        <td class="num">${fmtMoney(r.income)}</td>
        <td class="num">${fmtMoney(r.expenses)}</td>
        <td class="num">${fmtMoney(r.net)}</td>
        <td class="num">${fmtMoney(r.running)}</td>
      `;
      tbody.appendChild(tr);
    }
  };

  return { renderDashboard };
}
