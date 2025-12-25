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
  if (el.cheatModal && !el.cheatModal.classList.contains("hidden")){
    renderCheatModal();
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

const SESSION_TIMEOUT_MS = (59 * 60 + 59) * 1000; // 59:59（超时）
function formatSessionDuration(ms){
  return ms > SESSION_TIMEOUT_MS ? "超时" : formatDuration(ms);
}

function updateSessionTimerDisplay(){
  if (!el.sessionTimer) return;
  el.sessionTimer.textContent = `⏱ ${formatSessionDuration(getSessionElapsedMs())}`;
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

function cheatAdjustToken(playerIndex, color, delta){
  const player = state.players[playerIndex];
  if (!player) return;
  if (delta > 0){
    if (state.tokenPool[color] <= 0) return;
    state.tokenPool[color] -= 1;
    player.tokens[color] += 1;
  } else if (delta < 0){
    if (player.tokens[color] <= 0) return;
    state.tokenPool[color] += 1;
    player.tokens[color] -= 1;
  }

  renderAll();
}

function renderCheatModal(){
  if (!el.cheatTokenList || !el.cheatPlayerSelect) return;
  const maxIndex = Math.max(0, state.players.length - 1);
  const selectedIndex = Math.min(Math.max(ui.cheatPlayerIndex ?? 0, 0), maxIndex);
  ui.cheatPlayerIndex = selectedIndex;

  el.cheatPlayerSelect.innerHTML = "";
  state.players.forEach((p, idx) => {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = `${idx + 1}号：${p.name}`;
    el.cheatPlayerSelect.appendChild(option);
  });
  el.cheatPlayerSelect.value = String(selectedIndex);

  const player = state.players[selectedIndex];
  if (!player) return;

  el.cheatTokenList.innerHTML = "";

  BALL_NAMES.forEach((name, color) => {
    const poolDepleted = state.tokenPool[color] <= 0;
    const wrap = document.createElement("div");
    wrap.className = "cheat-token-row";
    wrap.dataset.color = String(color);

    const info = document.createElement("div");
    info.className = "cheat-token-info";

    const img = document.createElement("img");
    img.src = BALL_IMAGES[color];
    img.alt = name;
    img.loading = "lazy";
    img.className = poolDepleted ? "depleted" : "";
    info.appendChild(img);

    const label = document.createElement("div");
    label.className = "cheat-token-label";
    label.textContent = name;
    info.appendChild(label);

    const counts = document.createElement("div");
    counts.className = "cheat-token-counts";
    counts.innerHTML = `
      <span>玩家：${player.tokens[color]}</span>
      <span>供应：${state.tokenPool[color]}</span>
    `;
    info.appendChild(counts);

    wrap.appendChild(info);

    const controls = document.createElement("div");
    controls.className = "cheat-token-controls";

    const incDisabled = poolDepleted;
    const decDisabled = player.tokens[color] <= 0;

    const inc = document.createElement("button");
    inc.type = "button";
    inc.className = "cheat-arrow up" + (incDisabled ? " disabled" : "");
    inc.textContent = "▲";
    inc.disabled = incDisabled;
    inc.title = incDisabled ? "供应区无可用精灵球标记" : "增加玩家该色标记";
    inc.addEventListener("click", () => cheatAdjustToken(selectedIndex, color, +1));

    const dec = document.createElement("button");
    dec.type = "button";
    dec.className = "cheat-arrow down" + (decDisabled ? " disabled" : "");
    dec.textContent = "▼";
    dec.disabled = decDisabled;
    dec.title = decDisabled ? "玩家没有该色精灵球标记" : "减少玩家该色标记";
    dec.addEventListener("click", () => cheatAdjustToken(selectedIndex, color, -1));

    controls.appendChild(inc);
    controls.appendChild(dec);
    wrap.appendChild(controls);

    el.cheatTokenList.appendChild(wrap);
  });
}
