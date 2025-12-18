// ========== 10) 渲染 ==========
function renderAll(){
  ensurePerTurnDefaults();
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
  for (const { card: marketCard } of marketCardsByLevels()){
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

