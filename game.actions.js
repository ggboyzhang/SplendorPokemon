// ========== 7) 行动实现 ==========
function actionTake3Different(){
  if (blockIfPrimaryActionLocked()) return Promise.resolve(false);
  const p = currentPlayer();
  const colors = [...ui.selectedTokenColors];
  const playerIndex = state.currentPlayerIndex;
  if (colors.length === 0) return Promise.resolve(toast("先选择精灵球标记", { type: "error" }));
  if (colors.includes(Ball.master_ball)) return Promise.resolve(toast("大师球只能在保留卡牌时获得", { type: "error" }));

  const availableColors = BALL_KEYS
    .map((_, idx) => idx)
    .filter((idx) => idx !== Ball.master_ball && state.tokenPool[idx] > 0);

  if (availableColors.length === 0) return Promise.resolve(toast("供应区没有可拿的精灵球标记", { type: "error" }));

  if (availableColors.length >= 3){
    if (colors.length !== 3) return Promise.resolve(toast("场上至少 3 种颜色时，必须拿 3 个不同颜色的精灵球标记", { type: "error" }));
  } else {
    if (colors.length !== availableColors.length){
      return Promise.resolve(toast(`场上仅剩 ${availableColors.length} 种颜色，必须全部拿取`, { type: "error" }));
    }
  }

  if (colors.some((c) => state.tokenPool[c] <= 0)){
    return Promise.resolve(toast("所选颜色的精灵球标记供应不足", { type: "error" }));
  }

  const animations = colors.map((c) => ({
    start: document.querySelector(`.token-chip[data-color="${c}"]`),
    target: findPlayerTokenSlot(playerIndex, c),
  }));

  // 实际可拿：供应区有的才拿
  for (const c of colors){
    state.tokenPool[c] -= 1;
    p.tokens[c] += 1;
  }

  markPrimaryAction("take3");
  clampTokenLimit(p);
  clearSelections();
  return animateTokenBatch(animations).then(() => {
    renderAll();
    toast(`拿取 ${colors.length} 个不同颜色精灵球标记`);
    return true;
  });
}

function actionTake2Same(){
  if (blockIfPrimaryActionLocked()) return Promise.resolve(false);
  const p = currentPlayer();
  const colors = [...ui.selectedTokenColors];
  const playerIndex = state.currentPlayerIndex;
  if (colors.length === 0) return Promise.resolve(toast("先选择精灵球标记", { type: "error" }));
  if (colors.length !== 1) return Promise.resolve(toast("该行动只能选择 1 种精灵球标记颜色", { type: "error" }));
  const c = colors[0];
  if (c === Ball.master_ball) return Promise.resolve(toast("大师球只能在保留卡牌时获得", { type: "error" }));
  if (!canTakeTwoSame(c)) return Promise.resolve(toast("该颜色精灵球标记供应不足 4 个，不能拿 2 个同色", { type: "error" }));

  const animations = [
    { start: document.querySelector(`.token-chip[data-color="${c}"]`), target: findPlayerTokenSlot(playerIndex, c) },
    { start: document.querySelector(`.token-chip[data-color="${c}"]`), target: findPlayerTokenSlot(playerIndex, c) },
  ];

  state.tokenPool[c] -= 2;
  p.tokens[c] += 2;

  markPrimaryAction("take2");
  clampTokenLimit(p);
  clearSelections();
  return animateTokenBatch(animations).then(() => {
    renderAll();
    toast("拿取 2 个同色精灵球标记");
    return true;
  });
}

function actionReserve(){
  if (blockIfPrimaryActionLocked()) return Promise.resolve(false);
  const p = currentPlayer();
  const playerIndex = state.currentPlayerIndex;
  if (p.reserved.length >= 3){
    if (state.tokenPool[Ball.master_ball] <= 0) return Promise.resolve(toast("保留区已满且没有可拿的大师球精灵球标记", { type: "error" }));
    const animations = [{
      start: document.querySelector(`.token-chip[data-color="${Ball.master_ball}"]`),
      target: findPlayerTokenSlot(playerIndex, Ball.master_ball),
    }];
    state.tokenPool[Ball.master_ball] -= 1;
    p.tokens[Ball.master_ball] += 1;
    markPrimaryAction("reserve");
    clampTokenLimit(p);
    clearSelections();
    return animateTokenBatch(animations).then(() => {
      renderAll();
      toast("保留区已满，本次仅拿取 1 个大师球精灵球标记");
      return true;
    });
  }

  if (!ui.selectedMarketCardId) return Promise.resolve(toast("先点击展示区选择要保留的卡", { type: "error" }));

  const found = findMarketCard(ui.selectedMarketCardId);
  if (!found) return Promise.resolve(toast("选择的卡不在展示区", { type: "error" }));

  const { level, idx, card } = found;
  if (level >= 4) return Promise.resolve(toast("稀有或传说卡牌不能被保留", { type: "error" }));
  const startEl = document.querySelector(`.market-card[data-card-id="${card.id}"]`);
  const targetZone = findPlayerZone(state.currentPlayerIndex, ".reserve-zone .zone-items");

  state.market.slotsByLevel[level][idx] = null;
  p.reserved.push(card);

  let gotMaster = false;
  const animations = [];
  if (state.tokenPool[Ball.master_ball] > 0){
    state.tokenPool[Ball.master_ball] -= 1;
    p.tokens[Ball.master_ball] += 1;
    gotMaster = true;
    animations.push({
      start: document.querySelector(`.token-chip[data-color="${Ball.master_ball}"]`),
      target: findPlayerTokenSlot(playerIndex, Ball.master_ball),
    });
  }

  markPrimaryAction("reserve");
  clampTokenLimit(p);
  clearSelections();

  return Promise.all([
    animateCardMove(startEl, targetZone),
    animateTokenBatch(animations),
  ]).then(() => {
    state.market.slotsByLevel[level][idx] = drawFromDeck(level);
    renderAll();
    toast(`已保留 1 张${gotMaster ? "，并获得 1 个大师球精灵球标记" : ""}`);
    return true;
  });
}

function actionBuy(){
  if (blockIfPrimaryActionLocked()) return Promise.resolve(false);
  const p = currentPlayer();

  // 优先：买保留牌
  if (ui.selectedReservedCard){
    const { playerIndex, cardId } = ui.selectedReservedCard;
    if (playerIndex !== state.currentPlayerIndex) return Promise.resolve(toast("只能捕捉自己保留区的卡", { type: "error" }));
    const rIdx = p.reserved.findIndex(c => c.id === cardId);
    if (rIdx < 0) return Promise.resolve(toast("该卡不在你的保留区", { type: "error" }));

    const card = p.reserved[rIdx];
    if (!canAfford(p, card)) return Promise.resolve(toast("精灵球标记不足，无法捕捉该卡", { type: "error" }));

    const reserveZone = findPlayerZone(state.currentPlayerIndex, ".reserve-zone");
    const startEl = reserveZone ? reserveZone.querySelector(`.mini-card[data-card-id="${card.id}"]`) : null;
    const handZone = findPlayerZone(state.currentPlayerIndex, ".hand-zone .zone-items");

    payCost(p, card);
    p.reserved.splice(rIdx, 1);
    p.hand.push(card);

    markPrimaryAction("buy");

    clearSelections();

    return animateCardMove(startEl, handZone).then(() => {
      renderAll();
      toast("已捕捉保留区卡牌");
      checkEndTrigger();
      return true;
    });
  }

  // 购买展示区卡
  if (!ui.selectedMarketCardId) return Promise.resolve(toast("先点击展示区选择要捕捉的卡", { type: "error" }));
  const found = findMarketCard(ui.selectedMarketCardId);
  if (!found) return Promise.resolve(toast("选择的卡不在展示区", { type: "error" }));

  const { level, idx, card } = found;
  if (!canAfford(p, card)) return Promise.resolve(toast("精灵球标记不足，无法捕捉该卡", { type: "error" }));

  const startEl = document.querySelector(`.market-card[data-card-id="${card.id}"]`);
  const handZone = findPlayerZone(state.currentPlayerIndex, ".hand-zone .zone-items");

  payCost(p, card);
  p.hand.push(card);

  markPrimaryAction("buy");

  // 补牌在动画结束后进行
  state.market.slotsByLevel[level][idx] = null;

  clearSelections();

  return animateCardMove(startEl, handZone).then(() => {
    state.market.slotsByLevel[level][idx] = drawFromDeck(level);
    renderAll();
    toast("已捕捉展示区卡牌");
    checkEndTrigger();
    return true;
  });
}

function actionEvolve(){
  if (state.perTurn.evolved) return Promise.resolve(toast("本回合已完成一次进化", { type: "error" }));

  const p = currentPlayer();
  if (!ui.selectedMarketCardId) return Promise.resolve(toast("先点击展示区选择要用于进化的卡牌", { type: "error" }));
  const found = findMarketCard(ui.selectedMarketCardId);
  if (!found) return Promise.resolve(toast("选择的卡不在展示区", { type: "error" }));

  const { level, idx, card: marketCard } = found;
  const matchingBases = p.hand.filter(c => c?.evolution?.name === marketCard.name);
  if (!matchingBases.length) return Promise.resolve(toast("该展示区卡牌无法进化你的任何手牌", { type: "error" }));

  const baseCard = matchingBases.find(c => canAffordEvolution(p, c));
  if (!baseCard) return Promise.resolve(toast("精灵球标记不足，无法用该卡进行进化", { type: "error" }));

  payEvolutionCost(p, baseCard);

  const startEl = document.querySelector(`.market-card[data-card-id="${marketCard.id}"]`);
  const handZone = findPlayerZone(state.currentPlayerIndex, ".hand-zone .zone-items");

  state.market.slotsByLevel[level][idx] = null;

  const evolved = replaceWithEvolution(p, baseCard, marketCard);

  state.perTurn.evolved = true;
  ui.selectedMarketCardId = null;

  return animateCardMove(startEl, handZone).then(() => {
    state.market.slotsByLevel[level][idx] = drawFromDeck(level);
    renderAll();
    toast(`${baseCard.name} 已进化为 ${marketCard.name}`);
    return true;
  });
}

function endTurn(){
  ensurePerTurnDefaults();
  if (!state.victoryResolved && !state.perTurn.primaryAction){
    toast("请先完成本回合的主要行动再结束回合", { type: "error" });
    return;
  }

  // 每回合结束：检查 token 上限已在拿/保留时处理，这里再兜底
  if (clampTokenLimit(currentPlayer())){
    renderAll();
    return;
  }

  checkEndTrigger();

  const isLastPlayerOfRound = state.currentPlayerIndex === state.players.length - 1;
  const shouldResolve = shouldResolveVictory(isLastPlayerOfRound);

  if (shouldResolve){
    resolveVictory();
  }

  if (state.victoryResolved){
    clearSelections();
    renderAll();
    return;
  }

  // 终局触发：当有人≥18，触发后需要“回合数平衡”
  // 这里做一个简化：记录触发回合，之后所有玩家各再走到同回合数就结算提示
  if (state.endTriggered){
    // 如果已经触发，并且回到起始玩家且回合已平衡，提示结算
    // 这里简单：当回合走到触发回合 + (玩家数-1) 且当前玩家回到起始玩家 -> 提示
    const doneTurn = state.turn >= state.endTriggerTurn + (state.players.length - 1);
    if (doneTurn && state.currentPlayerIndex === 0){
      toast("终局回合已平衡：请进行最终结算（占位：你可在此加结算面板）");
    }
  }

  // 下一位玩家
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  if (state.currentPlayerIndex === 0){
    state.turn += 1;
  }
  state.perTurn = { evolved: false, primaryAction: null };
  ui.errorMessage = "";

  clearSelections();
  renderAll();
  return true;
}

