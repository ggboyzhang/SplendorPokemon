// ========== 6) 规则工具 ==========
function currentPlayer(){ return state.players[state.currentPlayerIndex]; }

function totalTokensOfPlayer(p){
  return p.tokens.reduce((a,b)=>a+b,0);
}

function rewardBonusesOfPlayer(p){
  const bonus = [0,0,0,0,0,0];
  p.hand.forEach(card => {
    if (!card) return;
    const r = card.reward;
    if (r && r.ball_color >= 0 && r.ball_color < bonus.length){
      bonus[r.ball_color] += Number(r.number) || 0;
    }
  });
  return bonus;
}

function flattenHandCards(p, includeStacked = false){
  const collected = [];
  function collect(card){
    if (!card) return;
    collected.push(card);
    if (includeStacked){
      getStackedCards(card).forEach(collect);
    }
  }
  p.hand.forEach(collect);
  return collected;
}

function totalTrophiesOfPlayer(p){
  return flattenHandCards(p).reduce((sum, c)=>sum + (c.point > 0 ? c.point : 0), 0);
}

function penaltyHandCount(p){
  return Math.max(0, flattenHandCards(p, true).length - flattenHandCards(p, false).length);
}

function trophyCardCount(p){
  return flattenHandCards(p, false).length;
}

function canTakeTwoSame(color){
  return state.tokenPool[color] >= 4;
}

function clampTokenLimit(p){
  const required = totalTokensOfPlayer(p) - 10;
  if (required <= 0) return false;

  const playerIndex = state.players.indexOf(p);
  if (playerIndex < 0) return false;

  ui.tokenReturn = {
    playerIndex,
    required,
    selected: [0,0,0,0,0,0],
  };

  renderTokenReturnModal();
  showModal(el.tokenReturnModal);
  return true;
}

function handleTokenReturnSelection(btn){
  if (!ui.tokenReturn) return;
  const color = Number(btn.dataset.color);
  if (!Number.isInteger(color)) return;

  const selectedTotal = ui.tokenReturn.selected.reduce((a,b)=>a+b,0);
  if (btn.classList.contains("selected")){
    btn.classList.remove("selected");
    ui.tokenReturn.selected[color] = Math.max(0, ui.tokenReturn.selected[color] - 1);
  }else{
    if (selectedTotal >= ui.tokenReturn.required) return;
    btn.classList.add("selected");
    ui.tokenReturn.selected[color] += 1;
  }

  updateTokenReturnInfo();
}

function updateTokenReturnInfo(){
  if (!ui.tokenReturn) return;
  const ctx = ui.tokenReturn;
  const player = state.players[ctx.playerIndex];
  if (!player) return;

  const selectedTotal = ctx.selected.reduce((a,b)=>a+b,0);
  if (el.tokenReturnInfo){
    el.tokenReturnInfo.textContent = `你持有 ${totalTokensOfPlayer(player)} 个精灵球标记，需要归还 ${ctx.required} 个（已选择 ${selectedTotal}/${ctx.required}）`;
  }
  if (el.btnConfirmTokenReturn){
    el.btnConfirmTokenReturn.disabled = selectedTotal !== ctx.required;
  }
}

function renderTokenReturnModal(){
  if (!ui.tokenReturn || !el.tokenReturnList) return;
  const ctx = ui.tokenReturn;
  const player = state.players[ctx.playerIndex];
  if (!player){
    ui.tokenReturn = null;
    closeModals({ force: true });
    return;
  }

  el.tokenReturnList.innerHTML = "";
  player.tokens.forEach((count, color) => {
    for (let i=0;i<count;i++){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "token-mini token-return-chip";
      btn.dataset.color = String(color);

      const img = document.createElement("img");
      img.src = BALL_IMAGES[color];
      img.alt = BALL_NAMES[color];
      btn.appendChild(img);

      btn.addEventListener("click", () => handleTokenReturnSelection(btn));
      el.tokenReturnList.appendChild(btn);
    }
  });

  updateTokenReturnInfo();
}

function confirmTokenReturn(){
  if (!ui.tokenReturn) return;
  const ctx = ui.tokenReturn;
  const player = state.players[ctx.playerIndex];
  if (!player) return;

  const selectedTotal = ctx.selected.reduce((a,b)=>a+b,0);
  if (selectedTotal !== ctx.required) return;

  ctx.selected.forEach((count, color) => {
    if (count > 0){
      player.tokens[color] -= count;
      state.tokenPool[color] += count;
    }
  });

  ui.tokenReturn = null;
  closeModals({ force: true });
  renderAll();
  toast(`已归还 ${selectedTotal} 个精灵球标记`);
}

function canAfford(p, card){
  // 紫色大师球可当万能：支付时先用对应色，不够再用紫；奖励视为永久折扣
  const need = [0,0,0,0,0,0];
  for (const item of card.cost){
    if (item.ball_color >= 0 && item.ball_color <= 5){
      need[item.ball_color] += item.number;
    }
  }

  const bonus = rewardBonusesOfPlayer(p);
  const tokens = [...p.tokens];
  let purplePool = tokens[5] + bonus[5];

  for (let c=0;c<5;c++){
    let required = need[c];
    const useBonus = Math.min(bonus[c], required);
    required -= useBonus;

    const useToken = Math.min(tokens[c], required);
    tokens[c] -= useToken;
    required -= useToken;

    if (required > 0){
      purplePool -= required;
      if (purplePool < 0) return false;
    }
  }

  const purpleCost = need[5];
  purplePool -= purpleCost;

  return purplePool >= 0;
}

function payCost(p, card){
  // 按 canAfford 假设可支付
  const need = [0,0,0,0,0,0];
  for (const item of card.cost){
    if (item.ball_color >= 0 && item.ball_color <= 5){
      need[item.ball_color] += item.number;
    }
  }

  const bonus = rewardBonusesOfPlayer(p);
  const spent = [0,0,0,0,0,0];
  let purpleBonus = bonus[5];
  let purpleTokens = p.tokens[5];

  for (let c=0;c<5;c++){
    let required = need[c];
    const useBonus = Math.min(bonus[c], required);
    required -= useBonus;

    const useToken = Math.min(p.tokens[c], required);
    p.tokens[c] -= useToken;
    spent[c] += useToken;
    required -= useToken;

    if (required > 0){
      const usePurpleBonus = Math.min(purpleBonus, required);
      purpleBonus -= usePurpleBonus;
      required -= usePurpleBonus;

      const usePurpleToken = Math.min(purpleTokens, required);
      purpleTokens -= usePurpleToken;
      spent[5] += usePurpleToken;
      required -= usePurpleToken;
    }
  }

  let purpleRequired = need[5];
  const usePurpleBonus = Math.min(purpleBonus, purpleRequired);
  purpleBonus -= usePurpleBonus;
  purpleRequired -= usePurpleBonus;

  if (purpleRequired > 0){
    const usePurpleToken = Math.min(purpleTokens, purpleRequired);
    purpleTokens -= usePurpleToken;
    spent[5] += usePurpleToken;
  }

  p.tokens[5] = purpleTokens;

  for (let i=0;i<spent.length;i++){
    if (spent[i] > 0){
      state.tokenPool[i] += spent[i];
    }
  }
}

function simulatePayCost(p, card){
  const need = [0,0,0,0,0,0];
  for (const item of card.cost){
    if (item.ball_color >= 0 && item.ball_color <= 5){
      need[item.ball_color] += item.number;
    }
  }

  const bonus = rewardBonusesOfPlayer(p);
  const spent = [0,0,0,0,0,0];
  let purpleBonus = bonus[5];
  let purpleTokens = p.tokens[5];
  let masterAsWildcard = false;

  for (let c=0;c<5;c++){
    let required = need[c];
    const useBonus = Math.min(bonus[c], required);
    required -= useBonus;

    const useToken = Math.min(p.tokens[c], required);
    required -= useToken;
    spent[c] += useToken;

    if (required > 0){
      const usePurpleBonus = Math.min(purpleBonus, required);
      purpleBonus -= usePurpleBonus;
      required -= usePurpleBonus;

      const usePurpleToken = Math.min(purpleTokens, required);
      purpleTokens -= usePurpleToken;
      spent[5] += usePurpleToken;
      if (usePurpleToken > 0) masterAsWildcard = true;
      required -= usePurpleToken;
    }
  }

  let purpleRequired = need[5];
  const usePurpleBonus = Math.min(purpleBonus, purpleRequired);
  purpleBonus -= usePurpleBonus;
  purpleRequired -= usePurpleBonus;

  if (purpleRequired > 0){
    const usePurpleToken = Math.min(purpleTokens, purpleRequired);
    purpleTokens -= usePurpleToken;
    spent[5] += usePurpleToken;
  }

  return { spentTokens: spent, masterAsWildcard };
}

function canAffordEvolution(p, card){
  const evoCost = card?.evolution?.cost;
  if (!evoCost || evoCost.ball_color === undefined || evoCost.number === undefined) return false;
  const color = evoCost.ball_color;
  const need = evoCost.number;
  if (color < 0 || color >= p.tokens.length) return false;
  const bonus = rewardBonusesOfPlayer(p);

  if (color === Ball.master_ball){
    const purplePool = p.tokens[Ball.master_ball] + bonus[Ball.master_ball];
    return purplePool >= need;
  }

  let remaining = need;
  const useBonus = Math.min(bonus[color], remaining);
  remaining -= useBonus;

  const useTokens = Math.min(p.tokens[color], remaining);
  remaining -= useTokens;

  if (remaining <= 0) return true;

  const purplePool = p.tokens[Ball.master_ball] + bonus[Ball.master_ball];
  return purplePool >= remaining;
}

function payEvolutionCost(p, card){
  const evoCost = card?.evolution?.cost;
  if (!evoCost) return;
  const color = evoCost.ball_color;
  let remaining = evoCost.number;
  if (color < 0 || color >= p.tokens.length) return;

  const bonus = rewardBonusesOfPlayer(p);

  if (color !== Ball.master_ball){
    const useBonus = Math.min(bonus[color], remaining);
    remaining -= useBonus;

    const spendColor = Math.min(p.tokens[color], remaining);
    p.tokens[color] -= spendColor;
    state.tokenPool[color] += spendColor;
    remaining -= spendColor;
  }

  if (remaining > 0){
    const spendPurpleBonus = Math.min(bonus[Ball.master_ball], remaining);
    remaining -= spendPurpleBonus;
  }

  if (remaining > 0){
    const spendPurple = Math.min(p.tokens[Ball.master_ball], remaining);
    p.tokens[Ball.master_ball] -= spendPurple;
    state.tokenPool[Ball.master_ball] += spendPurple;
  }
}

function simulatePayEvolutionCost(p, card){
  const evoCost = card?.evolution?.cost;
  if (!evoCost) return { spentTokens: [0,0,0,0,0,0], masterAsWildcard: false };
  const color = evoCost.ball_color;
  let remaining = evoCost.number;
  const bonus = rewardBonusesOfPlayer(p);
  const spent = [0,0,0,0,0,0];
  let masterAsWildcard = false;

  if (color !== Ball.master_ball){
    const useBonus = Math.min(bonus[color], remaining);
    remaining -= useBonus;

    const spendColor = Math.min(p.tokens[color], remaining);
    spent[color] += spendColor;
    remaining -= spendColor;
  }

  if (remaining > 0){
    const spendPurpleBonus = Math.min(bonus[Ball.master_ball], remaining);
    remaining -= spendPurpleBonus;
  }

  if (remaining > 0){
    const spendPurple = Math.min(p.tokens[Ball.master_ball], remaining);
    spent[Ball.master_ball] += spendPurple;
    if (color !== Ball.master_ball && spendPurple > 0) masterAsWildcard = true;
  }

  return { spentTokens: spent, masterAsWildcard };
}

function isRareOrLegend(card){
  return card?.level >= 4;
}

function isAiPlayer(playerIndex){
  const player = state.players[playerIndex];
  return getPlayerAiLevel(player, playerIndex) !== DISABLED_AI_LEVEL;
}

function shouldConfirmMasterBallForBuy(playerIndex, card){
  if (!card) return false;
  if (isRareOrLegend(card)) return false;
  if (isAiPlayer(playerIndex)) return false;
  const p = state.players[playerIndex];
  if (!p) return false;
  const { spentTokens, masterAsWildcard } = simulatePayCost(p, card);
  return masterAsWildcard && spentTokens[Ball.master_ball] > 0;
}

function shouldConfirmMasterBallForEvolution(playerIndex, card){
  if (!card) return false;
  if (isAiPlayer(playerIndex)) return false;
  const evoCost = card?.evolution?.cost;
  if (!evoCost) return false;
  if (evoCost.ball_color === Ball.master_ball) return false;
  const p = state.players[playerIndex];
  if (!p) return false;
  const { spentTokens, masterAsWildcard } = simulatePayEvolutionCost(p, card);
  return masterAsWildcard && spentTokens[Ball.master_ball] > 0;
}

function requestMasterBallConfirmation(playerIndex, proceed){
  if (!el.masterBallConfirmModal) return ensurePromise(proceed());
  return new Promise(resolve => {
    ui.pendingMasterBallConfirm = { proceed, resolve };
    showModal(el.masterBallConfirmModal);
  });
}

function resolveMasterBallConfirmation(confirmed){
  if (!ui.pendingMasterBallConfirm) return;
  const { proceed, resolve } = ui.pendingMasterBallConfirm;
  ui.pendingMasterBallConfirm = null;
  if (!confirmed){
    closeModals();
    resolve(false);
    return;
  }
  closeModals();
  ensurePromise(proceed()).then(resolve);
}

function cleanStackData(card){
  if (!card) return card;
  const clone = { ...card };
  delete clone.stackedCards;
  delete clone.underCards;
  delete clone.consumedCards;
  return clone;
}

function replaceWithEvolution(player, baseCard, evolvedTemplate){
  const idx = player.hand.findIndex(c => c.id === baseCard.id);
  if (idx < 0) return;

  const existingStack = getStackedCards(baseCard);
  const stack = [...existingStack.map(cleanStackData), cleanStackData(baseCard)];
  const evolved = { ...evolvedTemplate, stackedCards: stack };

  player.hand.splice(idx, 1, evolved);
  return evolved;
}

function findPlayerZone(playerIndex, zoneSelector){
  return document.querySelector(`.player[data-player-index="${playerIndex}"] ${zoneSelector}`);
}

function findPlayerTokenSlot(playerIndex, color){
  return document.querySelector(`.player[data-player-index="${playerIndex}"] .token-zone .token-mini[data-color="${color}"]`);
}

function calculateReserveSlotOffset(targetEl, slotIndex){
  if (!targetEl) return { offsetX: 0, offsetY: 0 };
  if (slotIndex !== 0 && slotIndex !== 2) return { offsetX: 0, offsetY: 0 };

  const targetRect = targetEl.getBoundingClientRect();
  if (!targetRect.width) return { offsetX: 0, offsetY: 0 };

  const rootStyles = getComputedStyle(document.documentElement);
  const targetStyles = getComputedStyle(targetEl);
  const miniWidth = parseFloat(rootStyles.getPropertyValue("--mini-card-w")) || targetRect.width / 3;
  const gap = parseFloat(targetStyles.columnGap || targetStyles.gap || "0") || 0;

  const contentWidth = miniWidth * 3 + gap * 2;
  const leftPadding = Math.max(0, (targetRect.width - contentWidth) / 2);
  const slotCenterX = targetRect.left + leftPadding + miniWidth * (slotIndex + 0.5) + gap * slotIndex;
  const targetCenterX = targetRect.left + targetRect.width / 2;

  return { offsetX: slotCenterX - targetCenterX, offsetY: 0 };
}

function animateCardMove(startEl, targetEl, duration = 800, options = {}){
  if (!startEl || !targetEl) return Promise.resolve();
  const startRect = startEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  if (!startRect.width || !targetRect.width) return Promise.resolve();

  const startCenter = {
    x: startRect.left + startRect.width / 2,
    y: startRect.top + startRect.height / 2,
  };
  const targetCenter = {
    x: targetRect.left + targetRect.width / 2 + (options.offsetX || 0),
    y: targetRect.top + targetRect.height / 2 + (options.offsetY || 0),
  };

  const rootStyles = getComputedStyle(document.documentElement);
  const miniWidth = parseFloat(rootStyles.getPropertyValue("--mini-card-w"));
  const miniHeight = parseFloat(rootStyles.getPropertyValue("--mini-card-h"));

  const targetWidth = Number.isFinite(miniWidth) && miniWidth > 0 ? miniWidth : targetRect.width;
  const targetHeight = Number.isFinite(miniHeight) && miniHeight > 0 ? miniHeight : targetRect.height;

  const scaleX = targetWidth / startRect.width;
  const scaleY = targetHeight / startRect.height;
  const scale = Math.min(scaleX, scaleY);

  const clone = startEl.cloneNode(true);
  clone.classList.add("flying-card");
  Object.assign(clone.style, {
    position: "fixed",
    left: `${startRect.left}px`,
    top: `${startRect.top}px`,
    width: `${startRect.width}px`,
    height: `${startRect.height}px`,
    transform: "translate(0,0) scale(1)",
    transformOrigin: "center center",
    transition: `transform ${Math.min(duration, 1000)}ms ease, opacity ${Math.min(duration, 1000)}ms ease`,
    zIndex: 9999,
    margin: "0",
    opacity: "1",
    visibility: "visible",
  });

  document.body.appendChild(clone);
  startEl.style.visibility = "hidden";

  const dx = targetCenter.x - startCenter.x;
  const dy = targetCenter.y - startCenter.y;

  // 强制一次回流，确保过渡生效
  clone.getBoundingClientRect();

  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    clone.style.opacity = "0.92";
  });

  return new Promise(resolve => {
    clone.addEventListener("transitionend", () => {
      clone.remove();
      resolve();
    }, { once: true });
  });
}

function animateTokenMove(startEl, targetEl, duration = 600){
  if (!startEl || !targetEl) return Promise.resolve();
  const startRect = startEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  if (!startRect.width || !targetRect.width) return Promise.resolve();

  const startCenter = {
    x: startRect.left + startRect.width / 2,
    y: startRect.top + startRect.height / 2,
  };
  const targetCenter = {
    x: targetRect.left + targetRect.width / 2,
    y: targetRect.top + targetRect.height / 2,
  };

  const scaleX = targetRect.width / startRect.width;
  const scaleY = targetRect.height / startRect.height;
  const scale = Math.min(scaleX, scaleY);

  const clone = startEl.cloneNode(true);
  clone.classList.add("flying-card");
  Object.assign(clone.style, {
    position: "fixed",
    left: `${startRect.left}px`,
    top: `${startRect.top}px`,
    width: `${startRect.width}px`,
    height: `${startRect.height}px`,
    transform: "translate(0,0) scale(1)",
    transformOrigin: "center center",
    transition: `transform ${Math.min(duration, 1000)}ms ease, opacity ${Math.min(duration, 1000)}ms ease`,
    zIndex: 9999,
    margin: "0",
    opacity: "1",
    visibility: "visible",
  });

  document.body.appendChild(clone);

  const dx = targetCenter.x - startCenter.x;
  const dy = targetCenter.y - startCenter.y;

  clone.getBoundingClientRect();

  clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  clone.style.opacity = "0";

  return new Promise((resolve) => {
    const cleanup = () => {
      clone.remove();
      resolve();
    };

    clone.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, duration + 50);
  });
}

function animateTokenBatch(movements, duration = 600){
  if (!Array.isArray(movements) || movements.length === 0) return Promise.resolve();
  return Promise.all(movements.map(({ start, target }) => animateTokenMove(start, target, duration)));
}
