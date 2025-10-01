export function createWhatIfRenderer({
  getState,
  getSandbox,
  setSandbox,
  sanitizeWhatIfState,
  saveWhatIf,
  cloneStateForSandbox,
  defaultState,
  isValidYMDString,
  compareYMD,
  clampPercent,
  clampCurrency,
  round2,
  computeProjection,
  estimateOccurrencesPerWeek,
  computeEffectiveAmount,
  fmtMoney,
  fmtDate,
  escapeHtml,
  describeNameAndCategory,
  formatPercentLabel,
  formatMoneyDelta,
  formatNumberDelta,
  applyDeltaClass,
  describeFirstNegative,
  describeFirstNegativeDelta,
  createSaleEntry,
  uid,
  query,
}) {
  const $ = query;

  const renderWhatIf = () => {
    const panel = $("#whatif");
    if (!panel) return;

    const state = getState();
    const prevSandbox = getSandbox();
    const prevKeys =
      prevSandbox?.tweaks?.streams && typeof prevSandbox.tweaks.streams === "object"
        ? Object.keys(prevSandbox.tweaks.streams)
        : [];

    let sandbox = sanitizeWhatIfState(prevSandbox, state);
    setSandbox(sandbox);

    const nextKeys =
      sandbox?.tweaks?.streams && typeof sandbox.tweaks.streams === "object"
        ? Object.keys(sandbox.tweaks.streams)
        : [];
    if (nextKeys.length !== prevKeys.length) {
      saveWhatIf(sandbox);
    }

    const tweaks = sandbox.tweaks || {};
    const baseState = cloneStateForSandbox(sandbox.base);
    const baseSettings = baseState.settings || defaultState().settings;
    const startDate = isValidYMDString(tweaks.startDate) ? tweaks.startDate : baseSettings.startDate;
    let endDate = isValidYMDString(tweaks.endDate) ? tweaks.endDate : baseSettings.endDate;
    if (compareYMD(startDate, endDate) > 0) endDate = startDate;
    baseState.settings = { ...baseSettings, startDate, endDate };

    const globalTweaks = tweaks.global || (tweaks.global = { pct: 0, delta: 0, lastEdited: "pct" });
    globalTweaks.pct = clampPercent(globalTweaks.pct, { min: -1, max: 2, fallback: 0 });
    globalTweaks.delta = clampCurrency(globalTweaks.delta, 0);
    if (!["pct", "delta", "effective"].includes(globalTweaks.lastEdited)) {
      globalTweaks.lastEdited = "pct";
    }

    const streamTweaks = tweaks.streams || (tweaks.streams = {});
    const saleTweaks = tweaks.sale || (tweaks.sale = { enabled: false, entries: [] });
    saleTweaks.enabled = Boolean(saleTweaks.enabled);
    if (!Array.isArray(saleTweaks.entries)) {
      saleTweaks.entries = [];
    }
    let saleMutated = false;
    const validSaleEntries = [];
    for (const entry of saleTweaks.entries) {
      if (!entry || typeof entry !== "object") {
        saleMutated = true;
        continue;
      }
      const start = isValidYMDString(entry.startDate) ? entry.startDate : startDate;
      let finish = isValidYMDString(entry.endDate) ? entry.endDate : start;
      if (compareYMD(start, finish) > 0) finish = start;
      const pct = clampPercent(entry.pct, { min: -1, max: 5, fallback: 0 });
      const topup = clampCurrency(entry.topup, 0);
      const lastEdited = entry.lastEdited === "topup" ? "topup" : "pct";
      const id = typeof entry.id === "string" ? entry.id : uid();
      validSaleEntries.push({
        id,
        name: typeof entry.name === "string" ? entry.name.trim().slice(0, 120) : "",
        pct,
        topup,
        startDate: start,
        endDate: finish,
        businessDaysOnly: Boolean(entry.businessDaysOnly),
        lastEdited,
      });
    }
    if (validSaleEntries.length !== saleTweaks.entries.length) {
      saleMutated = true;
    }
    saleTweaks.entries = validSaleEntries;
    if (saleTweaks.enabled && !saleTweaks.entries.length) {
      saleTweaks.entries.push(createSaleEntry(startDate));
      saleMutated = true;
    }

    const actualProjection = computeProjection(state);

    const streamInfo = [];
    const streamMap = new Map();
    let mutated = saleMutated;

    for (const stream of baseState.incomeStreams) {
      if (!stream || typeof stream !== "object") continue;
      if (typeof stream.id !== "string") stream.id = uid();
      const streamId = stream.id;
      if (!streamTweaks[streamId]) {
        streamTweaks[streamId] = { pct: 0, delta: 0, effective: null, weeklyTarget: null, lastEdited: "pct" };
        mutated = true;
      }
      const entry = streamTweaks[streamId];
      entry.pct = clampPercent(entry.pct, { min: -1, max: 2, fallback: 0 });
      entry.delta = clampCurrency(entry.delta, 0);
      if (!["pct", "delta", "effective", "weekly"].includes(entry.lastEdited)) {
        entry.lastEdited = "pct";
        mutated = true;
      }
      if (entry.lastEdited !== "effective" && entry.effective !== null) {
        entry.effective = null;
        mutated = true;
      } else if (entry.lastEdited === "effective" && entry.effective !== null) {
        entry.effective = round2(entry.effective);
      }
      if (entry.lastEdited !== "weekly" && entry.weeklyTarget !== null) {
        entry.weeklyTarget = null;
        mutated = true;
      } else if (entry.lastEdited === "weekly") {
        if (!Number.isFinite(Number(entry.weeklyTarget))) {
          entry.weeklyTarget = null;
          entry.lastEdited = "pct";
          mutated = true;
        } else {
          entry.weeklyTarget = round2(entry.weeklyTarget);
        }
      }
      const baseAmount = Math.abs(Number(stream.amount || 0));
      const occurrences = estimateOccurrencesPerWeek(stream);
      if (entry.lastEdited === "weekly" && (!occurrences || occurrences <= 0)) {
        entry.lastEdited = "pct";
        entry.weeklyTarget = null;
        mutated = true;
      }

      const baseAfterGlobal = computeEffectiveAmount(baseAmount, globalTweaks.pct, globalTweaks.delta);
      let finalAmount = baseAfterGlobal;
      if (entry.lastEdited === "weekly" && entry.weeklyTarget !== null && occurrences > 0) {
        finalAmount = round2(entry.weeklyTarget / occurrences);
      } else if (entry.lastEdited === "effective" && entry.effective !== null) {
        finalAmount = round2(entry.effective);
      } else {
        finalAmount = computeEffectiveAmount(baseAfterGlobal, entry.pct, entry.delta);
      }

      streamInfo.push({ id: streamId, stream, baseAmount, baseAfterGlobal, occurrences, entry, finalAmount });
      streamMap.set(streamId, { entry, occurrences });
    }

    if (mutated) {
      saveWhatIf(sandbox);
    }

    const startInput = $("#whatifStartDate");
    if (startInput && document.activeElement !== startInput) startInput.value = startDate || "";
    const endInput = $("#whatifEndDate");
    if (endInput && document.activeElement !== endInput) endInput.value = endDate || "";

    const pctInput = $("#whatifGlobalPct");
    if (pctInput && document.activeElement !== pctInput) pctInput.value = String(Math.round(globalTweaks.pct * 100));
    const pctSlider = $("#whatifGlobalPctSlider");
    if (pctSlider && document.activeElement !== pctSlider) pctSlider.value = String(Math.round(globalTweaks.pct * 100));
    const deltaInput = $("#whatifGlobalDelta");
    if (deltaInput && document.activeElement !== deltaInput) deltaInput.value = String(round2(globalTweaks.delta));
    const globalEffective = computeEffectiveAmount(100, globalTweaks.pct, globalTweaks.delta);
    const effectiveInput = $("#whatifGlobalEffective");
    if (effectiveInput && document.activeElement !== effectiveInput) effectiveInput.value = globalEffective.toFixed(2);
    const globalSummary = $("#whatifGlobalSummary");
    if (globalSummary) {
      const pctLabel = formatPercentLabel(globalTweaks.pct);
      globalSummary.textContent = `Applied before per-stream tweaks · ${pctLabel} & ${formatMoneyDelta(globalTweaks.delta)} per occurrence · $100 → ${fmtMoney(globalEffective)}`;
    }

    const streamContainer = $("#whatifStreams");
    if (streamContainer) {
      if (!streamInfo.length) {
        streamContainer.innerHTML = '<p class="whatif-streams-empty">No recurring income streams in sandbox.</p>';
      } else {
        streamContainer.innerHTML = streamInfo
          .map(({ id, stream, baseAmount, baseAfterGlobal, occurrences, entry, finalAmount }) => {
            const name = escapeHtml(describeNameAndCategory(stream, "Income Stream"));
            const pctValue = String(Math.round(entry.pct * 100));
            const deltaValue = entry.delta.toFixed(2);
            const effectiveValue = finalAmount.toFixed(2);
            const weeklyValue = entry.lastEdited === "weekly" && entry.weeklyTarget !== null ? entry.weeklyTarget.toFixed(2) : "";
            const weeklyDisabled = !occurrences || occurrences <= 0;
            const weeklyLabel = occurrences && occurrences > 0 ? `${round2(occurrences)} / week` : "n/a";
            const isLocked = entry.lastEdited === "effective" || entry.lastEdited === "weekly";
            const lockIcon = isLocked ? "🔒" : "🔗";
            const lockTitle = isLocked ? "Unlock to use %/$ tweaks" : "Lock current effective amount";
            const baseLabel = baseAmount === baseAfterGlobal
              ? `Base: ${fmtMoney(baseAmount)}`
              : `Base: ${fmtMoney(baseAmount)} · Post-global: ${fmtMoney(baseAfterGlobal)}`;
            return `
<div class="whatif-stream" data-stream="${id}">
  <div class="whatif-stream-head">
    <div>
      <h4>${name}</h4>
      <p>${baseLabel}</p>
    </div>
    <div class="whatif-stream-lock" data-stream="${id}" data-locked="${isLocked ? "1" : "0"}" title="${lockTitle}">${lockIcon}</div>
  </div>
  <div class="whatif-stream-body">
    <label>% <input type="number" class="whatif-stream-pct" data-stream="${id}" value="${pctValue}" ${entry.lastEdited === "pct" ? "" : "disabled"}></label>
    <label>Δ $ <input type="number" step="0.01" class="whatif-stream-delta" data-stream="${id}" value="${deltaValue}" ${entry.lastEdited === "delta" ? "" : "disabled"}></label>
    <label>Effective <input type="number" step="0.01" class="whatif-stream-effective" data-stream="${id}" value="${effectiveValue}" ${entry.lastEdited === "effective" ? "" : "disabled"}></label>
    <label class="weekly">
      Weekly target
      <input type="number" step="0.01" class="whatif-stream-weekly" data-stream="${id}" value="${weeklyValue}" ${entry.lastEdited === "weekly" ? "" : "disabled"} ${weeklyDisabled ? "disabled" : ""}>
      <small>${weeklyLabel}</small>
    </label>
  </div>
</div>`;
          })
          .join("");
      }
    }

    const projection = computeProjection(baseState, {
      transformStreamAmount: ({ stream, baseAmount, date }) => {
        const info = streamMap.get(stream.id);
        if (!info) return baseAmount;
        const { entry, occurrences } = info;
        if (entry.lastEdited === "weekly" && entry.weeklyTarget !== null && occurrences > 0) {
          return entry.weeklyTarget / occurrences;
        }
        if (entry.lastEdited === "effective" && entry.effective !== null) {
          return entry.effective;
        }
        return computeEffectiveAmount(baseAmount, entry.pct, entry.delta);
      },
      sale: saleTweaks.enabled
        ? { enabled: true, entries: saleTweaks.entries }
        : null,
    });

    $("#whatifProjectedBalance").textContent = fmtMoney(projection.endBalance);
    $("#whatifProjectedIncome").textContent = fmtMoney(projection.totalIncome);
    $("#whatifProjectedExpenses").textContent = fmtMoney(projection.totalExpenses);

    const deltas = {
      balance: projection.endBalance - actualProjection.endBalance,
      income: projection.totalIncome - actualProjection.totalIncome,
      expenses: projection.totalExpenses - actualProjection.totalExpenses,
      lowest: projection.lowestBalance - actualProjection.lowestBalance,
      peak: projection.peakBalance - actualProjection.peakBalance,
      negatives: projection.negativeDays - actualProjection.negativeDays,
    };

    $("#whatifProjectedBalanceDelta").textContent = formatMoneyDelta(deltas.balance);
    $("#whatifProjectedIncomeDelta").textContent = formatMoneyDelta(deltas.income);
    $("#whatifProjectedExpensesDelta").textContent = formatMoneyDelta(deltas.expenses);
    $("#whatifProjectedLowest").textContent = fmtMoney(projection.lowestBalance);
    $("#whatifProjectedPeak").textContent = fmtMoney(projection.peakBalance);
    $("#whatifProjectedNegativeDays").textContent = String(projection.negativeDays);
    $("#whatifProjectedFirstNegative").textContent = describeFirstNegative(projection.firstNegativeDate);

    applyDeltaClass($("#whatifProjectedBalanceDelta"), deltas.balance);
    applyDeltaClass($("#whatifProjectedIncomeDelta"), deltas.income);
    applyDeltaClass($("#whatifProjectedExpensesDelta"), deltas.expenses, { positiveIsGood: false });
    applyDeltaClass($("#whatifProjectedNegativeDaysDelta"), deltas.negatives, { positiveIsGood: false });

    const lowestDelta = describeFirstNegativeDelta(actualProjection.lowestBalanceDate, projection.lowestBalanceDate);
    $("#whatifProjectedLowestDelta").textContent = lowestDelta.text;
    applyDeltaClass($("#whatifProjectedLowestDelta"), lowestDelta.delta, { positiveIsGood: false });

    const peakDelta = describeFirstNegativeDelta(actualProjection.peakBalanceDate, projection.peakBalanceDate);
    $("#whatifProjectedPeakDelta").textContent = peakDelta.text;
    applyDeltaClass($("#whatifProjectedPeakDelta"), peakDelta.delta);

    const firstNegDelta = describeFirstNegativeDelta(actualProjection.firstNegativeDate, projection.firstNegativeDate);
    $("#whatifProjectedFirstNegativeDelta").textContent = firstNegDelta.text;
    applyDeltaClass($("#whatifProjectedFirstNegativeDelta"), firstNegDelta.delta, { positiveIsGood: false });

    const saleContainer = $("#whatifSaleEntries");
    if (saleContainer) {
      saleContainer.innerHTML = saleTweaks.entries
        .map((entry) => {
          const name = escapeHtml(entry.name || "Sale");
          const pct = formatPercentLabel(entry.pct);
          const topup = formatMoneyDelta(entry.topup);
          return `
<li data-sale-id="${entry.id}">
  <strong>${name}</strong>
  <span>${entry.startDate} → ${entry.endDate}</span>
  <span>${pct}, top-up ${topup}</span>
</li>`;
        })
        .join("");
    }
  };

  return { renderWhatIf };
}
