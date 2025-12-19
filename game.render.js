// ========== 10) 渲染 ==========
function renderAll(){
  ensurePerTurnDefaults();
  ensureSessionTimerTicking();
  renderTokenPool();
  renderMarket();
  renderPlayers();
  renderErrorBanner();
  renderActionButtons();
  if (el.handModal && !el.handModal.classList.contains("hidden")){
    renderHandModal(ui.handPreviewPlayerIndex);
  }
  maybeAutoPlay();
}

function renderErrorBanner(){
  if (!el.errorBanner) return;
  const message = ui.errorMessage || (lastLoadError ? `资源加载失败：${lastLoadError}` : "");

  if (message){
    el.errorBanner.textContent = message;
    el.errorBanner.classList.remove("hidden");
  } else {
    el.errorBanner.textContent = "";
    el.errorBanner.classList.add("hidden");
  }
}

function formatDuration(ms){
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hours > 0){
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function getSessionElapsedMs(){
  if (!state?.createdAt) return 0;
  const startTs = new Date(state.createdAt).getTime();
  const endTs = state.sessionEndedAt ? new Date(state.sessionEndedAt).getTime() : Date.now();
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 0;
  return Math.max(0, endTs - startTs);
}

function updateSessionTimerDisplay(){
  if (!el.sessionTimer) return;
  el.sessionTimer.textContent = `⏱ ${formatDuration(getSessionElapsedMs())}`;
}

function ensureSessionTimerTicking(){
  if (!el.sessionTimer) return;
  updateSessionTimerDisplay();
  if (ui.sessionTimerInterval) return;
  ui.sessionTimerInterval = setInterval(updateSessionTimerDisplay, 1000);
}

function resetSessionTimer(){
  if (ui.sessionTimerInterval){
    clearInterval(ui.sessionTimerInterval);
    ui.sessionTimerInterval = null;
  }
  ensureSessionTimerTicking();
}

function marketCardsByLevels(levels = [1,2,3,4,5]){
  const cards = [];
  const slots = state.market?.slotsByLevel || {};
  levels.forEach(level => {
    (slots[level] || []).forEach(card => {
      if (card) cards.push({ level, card });
    });
  });
  return cards;
}

function hasReservableMarketCard(){
  return marketCardsByLevels([1,2,3]).length > 0;
}

function canReserveAnyCard(p){
  if (!p) return false;
  if (p.reserved.length >= 3){
    return state.tokenPool[Ball.master_ball] > 0;
  }
  return hasReservableMarketCard();
}

function canBuyAnyCard(p){
  if (!p) return false;
  if (p.reserved.some(card => card && canAfford(p, card))) return true;
  return marketCardsByLevels().some(({ card }) => card && canAfford(p, card));
}

function canEvolveAnyCard(p){
  if (!p) return false;
  const candidates = [
    ...marketCardsByLevels().map(({ card }) => card),
    ...p.reserved,
  ];
  for (const marketCard of candidates){
    if (!marketCard) continue;
    const bases = p.hand.filter(c => c?.evolution?.name === marketCard.name);
    if (!bases.length) continue;
    if (bases.some(c => canAffordEvolution(p, c))) return true;
  }
  return false;
}

function getActionAvailability(){
  const player = currentPlayer();
  const hasDifferent = BALL_KEYS.some((_, idx) => idx !== Ball.master_ball && state.tokenPool[idx] > 0);
  const hasSame = BALL_KEYS.some((_, idx) => idx !== Ball.master_ball && canTakeTwoSame(idx));
  const reserveAvailable = canReserveAnyCard(player);
  const buyAvailable = canBuyAnyCard(player);
  const evolveAvailable = !state.perTurn?.evolved && canEvolveAnyCard(player);

  return {
    take3: hasDifferent,
    take2: hasSame,
    reserve: reserveAvailable,
    buy: buyAvailable,
    evolve: evolveAvailable,
    endTurn: !!state.perTurn.primaryAction || state.victoryResolved,
  };
}

function renderActionButtons(){
  if (!el.actTake3) return;
  const availability = getActionAvailability();
  const taken = state.perTurn.primaryAction;
  const hasLockedPrimary = hasTakenPrimaryAction();
  const primarySet = new Set(["take3", "take2", "reserve", "buy"]);

  const mapping = [
    { key: "take3", el: el.actTake3 },
    { key: "take2", el: el.actTake2 },
    { key: "reserve", el: el.actReserve },
    { key: "buy", el: el.actBuy },
    { key: "evolve", el: el.actEvolve },
    { key: "endTurn", el: el.actEndTurn },
  ];

  mapping.forEach(({ key, el }) => {
    if (!el) return;
    const lockedByPrimary = hasLockedPrimary && primarySet.has(key) && taken !== key;
    const disabled = !availability[key] || lockedByPrimary;
    el.disabled = disabled;
    el.classList.toggle("completed", taken === key);
  });
}
