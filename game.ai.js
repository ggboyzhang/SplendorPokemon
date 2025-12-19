// ========== 11) AI 自动操作 ==========
let aiRunning = false;

function aiCardScore(card, player, ctx = {}){
  const point = Number(card?.point) || 0;
  const reward = Number(card?.reward?.number) || 0;
  const costSize = Array.isArray(card?.cost) ? card.cost.length : 0;
  const bonus = rewardBonusesOfPlayer(player || currentPlayer());
  let needPenalty = 0;
  (card?.cost || []).forEach(c => {
    const own = (player?.tokens?.[c.ball_color] || 0) + (bonus[c.ball_color] || 0);
    const lack = Math.max(0, (Number(c.number) || 0) - own);
    needPenalty += lack * 8;
  });
  let score = point * 120 + reward * 12 - costSize * 2 - needPenalty;
  if (ctx.threatBonus){
    score += ctx.threatBonus(card) || 0;
  }
  if (ctx.futurePromise){
    score += ctx.futurePromise(card) || 0;
  }
  return score;
}

function aiFuturePromise(card, knownDecks){
  if (!card) return 0;
  const deck = knownDecks?.[card.level];
  if (!deck || deck.length === 0) return 0;
  const next = deck[0];
  const nextScore = next ? (Number(next.point) || 0) : 0;
  return (nextScore && nextScore > (Number(card.point) || 0)) ? -5 : 5;
}

function aiEstimateTurnsToWin(player, ctx = {}){
  if (!player) return Infinity;
  const remain = Math.max(0, 18 - totalTrophiesOfPlayer(player));
  if (remain === 0) return 0;

  const rewardBonuses = rewardBonusesOfPlayer(player) || [];
  const bonusGain = Math.max(0, rewardBonuses.reduce((s, n) => s + (n || 0), 0) / 4);
  const recentRate = state.turn > 1 ? (totalTrophiesOfPlayer(player) / Math.max(1, state.turn - 1)) : 0;
  const baselineGain = Math.max(1, Math.min(5, 1 + bonusGain + recentRate));

  const estimateCtx = {
    level: ctx.level,
    knownDecks: ctx.knownDecks || {},
    opponentTurnDistance: () => Infinity,
    threatBonus: () => 0,
    futurePromise(card){ return aiFuturePromise(card, ctx.knownDecks); },
  };

  const goal = aiSelectGoalCard(player, estimateCtx) || aiSelectReserveTarget(player, estimateCtx);
  const bestPoint = Math.max(1, Number(goal?.card?.point) || 1);
  const turnsToCard = goal?.card ? (aiTurnsToAfford(player, goal.card, estimateCtx, true) + 1) : 2;
  const optimisticGain = Math.max(bestPoint, baselineGain);
  const cycles = Math.ceil(remain / optimisticGain);
  return Math.max(turnsToCard, cycles);
}

function aiBuildContext(player, level){
  const isSuperLv3 = level >= 3;
  const isSuperLv4 = level >= 4;
  const knownDecks = {};
  if (isSuperLv3){
    knownDecks[1] = state.decks[levelKey(1)] || [];
  }
  if (isSuperLv4){
    [1,2,3,4,5].forEach(lv => { knownDecks[lv] = state.decks[levelKey(lv)] || []; });
  }

  const opponentSnapshot = state.players
    .map((p, idx) => ({ p, idx }))
    .filter(item => item.p !== player);

  const baselineCtx = { level, knownDecks };
  const selfEstimatedTurns = aiEstimateTurnsToWin(player, baselineCtx);
  const urgentOpponents = opponentSnapshot.map(item => ({
    p: item.p,
    idx: item.idx,
    turns: aiEstimateTurnsToWin(item.p, baselineCtx),
    trophies: totalTrophiesOfPlayer(item.p),
  }));

  const dangerousOpponent = urgentOpponents.reduce((best, cur) => {
    if (!best || cur.turns < best.turns) return cur;
    return best;
  }, null);

  const mustBlock = dangerousOpponent &&
    dangerousOpponent.turns <= selfEstimatedTurns &&
    (dangerousOpponent.trophies >= 12 || dangerousOpponent.turns <= 3);

  return {
    level,
    knownDecks,
    urgentOpponents,
    selfEstimatedTurns,
    dangerousOpponent,
    mustBlock,
    threatBonus(card){
      if (level < 1 || !card) return 0;
      let bonus = 0;
      urgentOpponents.forEach(({ p, turns }) => {
        if (!p) return;
        if (canAfford(p, card)) bonus += 40 + (Number(card.point) || 0) * 15;
        else if (turns <= 3 && (Number(card.point) || 0) >= 2){
          bonus += 20;
        }
      });
      return bonus;
    },
    futurePromise(card){
      return aiFuturePromise(card, knownDecks);
    },
    opponentTurnDistance(card){
      if (!card) return Infinity;
      let best = Infinity;
      urgentOpponents.forEach(({ p }) => {
        const dist = aiTurnsToAfford(p, card, { level }, true);
        best = Math.min(best, dist);
      });
      return best;
    },
  };
}

function aiSelectBuyTarget(player, ctx){
  const candidates = [];
  player.reserved.forEach(card => {
    if (card && canAfford(player, card)) candidates.push({ source: "reserved", card });
  });
  marketCardsByLevels().forEach(({ card }) => {
    if (card && canAfford(player, card)) candidates.push({ source: "market", card });
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => aiCardScore(b.card, player, ctx) - aiCardScore(a.card, player, ctx));
  return candidates[0];
}

function aiSelectEvolveTarget(player, ctx){
  const options = [];
  for (const { card } of marketCardsByLevels()){
    if (!card) continue;
    const base = player.hand.find(c => c?.evolution?.name === card.name && canAffordEvolution(player, c));
    if (!base) continue;
    const cost = (card.cost || []).reduce((s, c) => s + (Number(c.number) || 0), 0);
    if (ctx.level >= 2 && cost > 0 && totalTokensOfPlayer(player) < 6) continue; // 避免用主行动硬进化
    options.push({ card });
  }
  if (!options.length) return null;
  options.sort((a, b) => aiCardScore(b.card, player, ctx) - aiCardScore(a.card, player, ctx));
  return options[0];
}

function aiReserveScore(card, player, ctx){
  if (!card) return -Infinity;
  const earlyFill = player.reserved.length >= 2 && totalTrophiesOfPlayer(player) < 12;
  const preciousMaster = ctx.level >= 2 && card.level <= 1 && state.tokenPool[Ball.master_ball] <= 1;
  let score = aiCardScore(card, player, ctx);
  if (earlyFill) score -= 30; // B/E: 保留区留空间
  if (preciousMaster) score -= 15; // C: 不乱花大师球
  if (ctx.level === 0) score -= 10; // 入门少保留
  const opponentDistance = ctx.opponentTurnDistance(card);
  if (opponentDistance <= 1) score += 45; // 阻断必胜路径
  else if (opponentDistance <= 2) score += 25;
  return score;
}

function aiSelectReserveTarget(player, ctx){
  const reservable = marketCardsByLevels([1,2,3]).filter(({ card }) => card);
  if (!reservable.length) return null;
  reservable.sort((a, b) => aiReserveScore(b.card, player, ctx) - aiReserveScore(a.card, player, ctx));
  return reservable[0];
}

function aiSelectGoalCard(player, ctx){
  const candidates = [];
  player.reserved.forEach(card => { if (card) candidates.push({ source: "reserved", card }); });
  marketCardsByLevels().forEach(({ card, level }) => { if (card) candidates.push({ source: level, card }); });
  if (!candidates.length) return null;

  function planScore(card){
    const base = aiCardScore(card, player, ctx);
    const turnCost = aiTurnsToAfford(player, card, ctx, ctx.level >= 2);
    const threatDistance = ctx.opponentTurnDistance(card);
    let score = base - turnCost * (15 + (ctx.level >= 3 ? 5 : 0));
    if (threatDistance <= 1) score += 40;
    else if (threatDistance <= 2) score += 20;
    else if (threatDistance <= 3) score += 8;
    return score;
  }

  candidates.sort((a, b) => planScore(b.card) - planScore(a.card));
  return candidates[0];
}

function aiColorNeedScore(player, color){
  const bonus = rewardBonusesOfPlayer(player);
  return (player.tokens[color] + (bonus[color] || 0));
}

function aiCostDeficit(card, player){
  if (!card) return [0,0,0,0,0,0];
  const bonus = rewardBonusesOfPlayer(player);
  const deficit = [0,0,0,0,0,0];
  (card.cost || []).forEach(c => {
    const owned = (player.tokens[c.ball_color] || 0) + (bonus[c.ball_color] || 0);
    deficit[c.ball_color] = Math.max(deficit[c.ball_color], Math.max(0, (Number(c.number) || 0) - owned));
  });
  return deficit;
}

function aiTurnsToAfford(player, card, ctx, allowMasterBall = true){
  if (!card || !player) return Infinity;
  const bonus = rewardBonusesOfPlayer(player);
  const deficit = aiCostDeficit(card, player);
  let flexible = allowMasterBall ? ((player.tokens[Ball.master_ball] || 0) + (bonus[Ball.master_ball] || 0)) : 0;
  let required = 0;
  deficit.forEach(need => {
    const use = Math.min(flexible, need);
    flexible -= use;
    required += need - use;
  });
  if (required <= 0) return 0;

  const tokenSpace = Math.max(0, 10 - totalTokensOfPlayer(player));
  const gainPerTurn = Math.max(1, Math.min(3, tokenSpace));
  return Math.ceil(required / gainPerTurn);
}

function aiWouldSpendMasterBall(player, card){
  if (!card || !player) return false;
  let shortfall = 0;
  const bonus = rewardBonusesOfPlayer(player);
  (card.cost || []).forEach(c => {
    const need = Number(c.number) || 0;
    const owned = (player.tokens[c.ball_color] || 0) + (bonus[c.ball_color] || 0);
    shortfall += Math.max(0, need - owned);
  });
  const master = (player.tokens[Ball.master_ball] || 0) + (bonus[Ball.master_ball] || 0);
  return shortfall > 0 && master > 0;
}

function aiPlanOpponentImpact(decision, ctx){
  const card = decision?.target?.card;
  const nextCard = decision?.planMeta?.revealNext;
  if (!card && !nextCard) return 0;
  const distances = [card, nextCard]
    .filter(Boolean)
    .map(c => ctx.opponentTurnDistance(c));
  const best = Math.min(...distances, Infinity);
  if (best <= 1) return 2;
  if (best <= 2) return 1;
  return 0;
}

function aiDetectPlanType(decision, ctx){
  if (!decision) return "develop";
  if (decision.planMeta?.revealNext) return "reveal";
  const isBlock = decision.target?.card && ctx.opponentTurnDistance(decision.target.card) <= 2;
  if (isBlock) return "block";
  if (decision.type === "take3" || decision.type === "take2") return "economy";
  return "develop";
}

function aiEvaluatePlan(decision, player, ctx, planType){
  if (!decision) return null;
  const usesMasterBall = decision.target?.card && aiWouldSpendMasterBall(player, decision.target.card);
  const selfGain = Number(decision.target?.card?.point) || 0;
  const projectedSelf = Math.max(0, ctx.selfEstimatedTurns - (selfGain > 0 ? 1 : 0));
  const opponentImpact = aiPlanOpponentImpact(decision, ctx);
  const projectedOpponent = ctx.dangerousOpponent ? ctx.dangerousOpponent.turns + opponentImpact : Infinity;
  const relativeSafety = ctx.dangerousOpponent ? (projectedOpponent - ctx.selfEstimatedTurns) : 0;
  const impactScore = opponentImpact * 28 + relativeSafety * 6;
  const tempoWeight = ctx.level >= 3 ? 8 : 12;
  const selfGainWeight = ctx.level >= 3 ? 8 : 6;
  const tempoScore = -projectedSelf * tempoWeight + (selfGain * selfGainWeight);
  const masterPenalty = usesMasterBall ? (8 - Math.min(3, ctx.level || 0)) : 0;
  let planScore = (decision.score || 0) + impactScore + tempoScore - masterPenalty;
  if (planType === "block") planScore += 15;
  if (planType === "reveal") planScore += 12;
  if (ctx.level >= 4 && ctx.mustBlock && planType === "block") planScore += 30;

  return {
    decision,
    planType,
    projectedSelf,
    opponentImpact,
    usesMasterBall,
    planScore,
  };
}

function aiPickTake3Colors(player, targetCard, ctx){
  const available = BALL_KEYS
    .map((_, idx) => idx)
    .filter(idx => idx !== Ball.master_ball && state.tokenPool[idx] > 0);
  if (!available.length) return [];
  const targetNeed = aiCostDeficit(targetCard, player);
  available.sort((a, b) => {
    const needDiff = (targetNeed[b] || 0) - (targetNeed[a] || 0);
    if (needDiff !== 0) return needDiff;
    const needScore = aiColorNeedScore(player, a) - aiColorNeedScore(player, b);
    if (needScore !== 0) return needScore;
    return state.tokenPool[b] - state.tokenPool[a];
  });
  const picked = available.slice(0, Math.min(3, available.length));
  if (ctx.level === 0) return picked.slice().reverse();
  return picked;
}

function aiPickTake2Color(player, targetCard){
  const options = BALL_KEYS
    .map((_, idx) => idx)
    .filter(idx => idx !== Ball.master_ball && canTakeTwoSame(idx));
  if (!options.length) return null;
  const targetNeed = aiCostDeficit(targetCard, player);
  options.sort((a, b) => {
    const needDiff = (targetNeed[b] || 0) - (targetNeed[a] || 0);
    if (needDiff !== 0) return needDiff;
    const needScore = aiColorNeedScore(player, a) - aiColorNeedScore(player, b);
    if (needScore !== 0) return needScore;
    return state.tokenPool[b] - state.tokenPool[a];
  });
  return options[0];
}

function aiShouldReserve(player, ctx, target){
  if (!target) return false;
  if (player.reserved.length >= 3) return false;
  const opponentDistance = ctx.opponentTurnDistance(target.card);
  if (opponentDistance > 1 && player.reserved.length >= 2 && totalTrophiesOfPlayer(player) < 15) return false; // E
  if (player.reserved.length >= 1 && ctx.level === 0) return false; // B 入门少保留
  if (ctx.level >= 2 && state.tokenPool[Ball.master_ball] <= 0 && player.reserved.length >= 2) return false; // C
  return true;
}

function aiSelectRevealDecision(player, ctx, availability){
  if (ctx.level < 3) return null;
  let best = null;
  for (const { card, level } of marketCardsByLevels([1,2,3])){
    if (!card) continue;
    const deck = ctx.knownDecks[level];
    if (!deck || !deck.length) continue;
    const next = deck[0];
    if (!next) continue;
    const pressure = aiCardScore(next, player, ctx) - aiCardScore(card, player, ctx);
    if (pressure < 8 && ctx.level < 4) continue;
    if (pressure < 14 && ctx.mustBlock) continue;
    const canBuyNow = availability.buy && canAfford(player, card);
    const canReserveNow = availability.reserve && (player.reserved.length < 3 || state.tokenPool[Ball.master_ball] > 0);
    if (!canBuyNow && !canReserveNow) continue;
    const decision = {
      type: canBuyNow ? "buy" : "reserve",
      target: { source: "market", card },
      score: pressure + (canBuyNow ? 10 : 0),
      planMeta: { revealNext: next },
    };
    if (!best || decision.score > best.score){
      best = decision;
    }
  }
  return best;
}

function chooseAiAction(player, level){
  const availability = getActionAvailability();
  const ctx = aiBuildContext(player, level);
  const decisions = [];
  const goal = aiSelectGoalCard(player, ctx);

  if (availability.buy){
    const target = aiSelectBuyTarget(player, ctx);
    if (target) decisions.push({ type: "buy", target, score: aiCardScore(target.card, player, ctx) + 20 });
  }

  if (availability.evolve){
    const target = aiSelectEvolveTarget(player, ctx);
    if (target) decisions.push({ type: "evolve", target, score: aiCardScore(target.card, player, ctx) });
  }

  if (availability.reserve){
    const target = aiSelectReserveTarget(player, ctx);
    if (aiShouldReserve(player, ctx, target)){
      decisions.push({ type: "reserve", target, score: aiReserveScore(target?.card, player, ctx) - 5 });
    }
  }

  const revealDecision = aiSelectRevealDecision(player, ctx, availability);
  if (revealDecision) decisions.push(revealDecision);

  const desireCard = decisions.length ? decisions[0].target?.card : aiSelectReserveTarget(player, ctx)?.card;
  const plannedCard = goal?.card || desireCard;

  if (availability.take3){
    const colors = aiPickTake3Colors(player, plannedCard, ctx);
    if (colors.length) decisions.push({ type: "take3", colors, score: 10 + colors.length });
  }

  if (availability.take2){
    const color = aiPickTake2Color(player, plannedCard);
    if (color !== null && color !== undefined) decisions.push({ type: "take2", colors: [color], score: 9 });
  }

  if (!decisions.length) return null;

  const plans = [];
  decisions.forEach(decision => {
    const planType = aiDetectPlanType(decision, ctx);
    const plan = aiEvaluatePlan(decision, player, ctx, planType);
    if (plan) plans.push(plan);
  });

  if (plans.length < 2 && decisions.length > 1){
    const second = decisions[1];
    const planType = aiDetectPlanType(second, ctx);
    const plan = aiEvaluatePlan(second, player, ctx, planType);
    if (plan) plans.push(plan);
  }

  const blockPlan = plans
    .filter(p => p && p.planType === "block")
    .sort((a, b) => (b.planScore || 0) - (a.planScore || 0))[0];

  const strongestDelayPlan = plans
    .filter(p => p && (p.opponentImpact > 0 || p.planType === "block"))
    .sort((a, b) => (b.opponentImpact || 0) - (a.opponentImpact || 0) || (b.planScore || 0) - (a.planScore || 0))[0];

  if (ctx.mustBlock && blockPlan){
    return blockPlan.decision;
  }

  if (ctx.mustBlock && strongestDelayPlan){
    return strongestDelayPlan.decision;
  }

  plans.sort((a, b) => (b.planScore || 0) - (a.planScore || 0));

  const blunder = level >= 0 ? (AI_BLUNDER_RATE[level] ?? 0) : 0;
  if (Math.random() < blunder){
    return plans[Math.floor(Math.random() * plans.length)]?.decision || decisions[0];
  }

  return plans[0]?.decision || decisions[0];
}

function autoReturnTokensForAI(player){
  if (!ui.tokenReturn || ui.tokenReturn.playerIndex !== state.currentPlayerIndex) return false;
  let remaining = ui.tokenReturn.required;

  while (remaining > 0){
    const ranked = player.tokens
      .map((count, color) => ({ count, color }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count || aiColorNeedScore(player, b.color) - aiColorNeedScore(player, a.color));
    if (!ranked.length) break;
    const pick = ranked[0].color;
    player.tokens[pick] -= 1;
    state.tokenPool[pick] += 1;
    remaining -= 1;
  }

  ui.tokenReturn = null;
  closeModals({ force: true });
  renderAll();
  return true;
}

function executeAiDecision(decision){
  if (!decision) return Promise.resolve(false);
  switch (decision.type){
    case "buy":{
      ui.selectedMarketCardId = null;
      ui.selectedReservedCard = null;
      if (decision.target.source === "reserved"){
        ui.selectedReservedCard = { playerIndex: state.currentPlayerIndex, cardId: decision.target.card.id };
      } else {
        ui.selectedMarketCardId = decision.target.card.id;
      }
      return ensurePromise(actionBuy());
    }
    case "evolve":{
      ui.selectedReservedCard = null;
      ui.selectedMarketCardId = decision.target.card.id;
      return ensurePromise(actionEvolve());
    }
    case "reserve":{
      ui.selectedReservedCard = null;
      ui.selectedMarketCardId = decision.target.card.id;
      return ensurePromise(actionReserve());
    }
    case "take3":{
      ui.selectedTokenColors = new Set(decision.colors || []);
      return ensurePromise(actionTake3Different());
    }
    case "take2":{
      ui.selectedTokenColors = new Set(decision.colors || []);
      return ensurePromise(actionTake2Same());
    }
    default:
      return Promise.resolve(false);
  }
}

async function runAiTurn(){
  let safety = 0;
  while (safety < 15){
    safety += 1;
    const player = currentPlayer();
    const level = getPlayerAiLevel(player, state.currentPlayerIndex);
    if (!player || level < 0 || state.victoryResolved) break;

    if (ui.tokenReturn && ui.tokenReturn.playerIndex === state.currentPlayerIndex){
      autoReturnTokensForAI(player);
      await wait(AI_DELAY_MS);
      continue;
    }

    if (!state.perTurn.primaryAction){
      const decision = chooseAiAction(player, level);
      if (!decision) break;
      await executeAiDecision(decision);
      await wait(AI_DELAY_MS);
    } else {
      endTurn();
      await wait(AI_DELAY_MS);
    }

    const nextPlayer = currentPlayer();
    if (!nextPlayer || getPlayerAiLevel(nextPlayer, state.currentPlayerIndex) < 0) break;
  }
}

function maybeAutoPlay(){
  if (aiRunning) return;
  const player = currentPlayer();
  const level = getPlayerAiLevel(player, state.currentPlayerIndex);
  if (state.victoryResolved || level < 0) return;

  aiRunning = true;
  wait(AI_DELAY_MS).then(() => runAiTurn()).finally(() => {
    aiRunning = false;
  });
}

function renderTokenPool(){
  if (!el.tokenPool) return;
  el.tokenPool.innerHTML = "";
  for (let c=0;c<BALL_NAMES.length;c++){
    const btn = document.createElement("div");
    btn.className = "token-chip" + (ui.selectedTokenColors.has(c) ? " selected" : "");
    btn.dataset.color = String(c);
    btn.title = BALL_NAMES[c];

    const img = document.createElement("img");
    img.src = BALL_IMAGES[c];
    img.alt = BALL_NAMES[c];
    img.className = "token-image";
    btn.appendChild(img);

    if (state.tokenPool[c] > 0){
      const count = document.createElement("div");
      count.className = "count-badge";
      count.textContent = String(state.tokenPool[c]);
      btn.appendChild(count);
    } else {
      btn.classList.add("ghost");
    }

    btn.addEventListener("click", () => {
      // toggle selection
      if (ui.selectedTokenColors.has(c)) ui.selectedTokenColors.delete(c);
      else ui.selectedTokenColors.add(c);
      renderTokenPool();
    });

    el.tokenPool.appendChild(btn);
  }
}

function renderMarket(){
  if (!el.market) return;
  el.market.innerHTML = "";

  const main = document.createElement("div");
  main.className = "market-main";
  const side = document.createElement("div");
  side.className = "market-side";

  const mainGroups = [
    { level: 1, deckClass: "level-1-back", slots: 4 },
    { level: 2, deckClass: "level-2-back", slots: 4 },
    { level: 3, deckClass: "level-3-back", slots: 4 },
  ];

  for (const group of mainGroups){
    main.appendChild(renderMarketRow(group));
  }

  const sideGroups = [
    { level: 4, deckClass: "rare-back", slots: 1 },
    { level: 5, deckClass: "legend-back", slots: 1 },
  ];

  for (const group of sideGroups){
    side.appendChild(renderVerticalMarket(group));
  }

  el.market.appendChild(main);
  el.market.appendChild(side);
}

function renderMarketRow(group){
  const section = document.createElement("div");
  section.className = "market-section";

  const remain = state.decks[levelKey(group.level)]?.length || 0;
  section.appendChild(renderDeckIndicator(group.deckClass, remain));

  const grid = document.createElement("div");
  grid.className = "market";
  grid.style.gridTemplateColumns = `repeat(${group.slots}, var(--card-w))`;
  grid.style.gridAutoRows = "var(--card-h)";

  const cards = state.market.slotsByLevel[group.level] || [];
  for (let i=0; i<group.slots; i++){
    const card = cards[i];
    grid.appendChild(card ? renderMarketCard(card) : renderEmptySlot(remain === 0));
  }

  section.appendChild(grid);
  return section;
}

function renderVerticalMarket(group){
  const wrap = document.createElement("div");
  wrap.className = "market-vertical";

  const remain = state.decks[levelKey(group.level)]?.length || 0;
  wrap.appendChild(renderDeckIndicator(group.deckClass, remain));

  const slotBox = document.createElement("div");
  slotBox.className = "market-single-slot";

  const card = (state.market.slotsByLevel[group.level] || [])[0];
  slotBox.appendChild(card ? renderMarketCard(card) : renderEmptySlot(remain === 0));

  wrap.appendChild(slotBox);
  return wrap;
}

function renderDeckIndicator(deckClass, remain){
  const deck = document.createElement("div");
  deck.className = `deck-indicator ${deckClass}` + (remain === 0 ? " ghost" : "");

  const back = document.createElement("div");
  back.className = `card-back ${deckClass}`;
  deck.appendChild(back);
  return deck;
}

function renderEmptySlot(isGhost){
  const placeholder = document.createElement("div");
  placeholder.className = "market-card empty" + (isGhost ? " ghost" : "");

  const visual = document.createElement("div");
  visual.className = "market-visual";
  placeholder.appendChild(visual);

  return placeholder;
}

function renderMarketCard(card){
  const div = document.createElement("div");
  div.className = "market-card" + (ui.selectedMarketCardId === card.id ? " selected" : "");
  div.dataset.cardId = card.id;

  const visual = document.createElement("div");
  visual.className = "market-visual";
  if (card.src){
    const img = document.createElement("img");
    img.className = "market-img";
    img.src = card.src;
    img.alt = card.name || "卡牌";
    visual.appendChild(img);
  }
  div.appendChild(visual);

  div.addEventListener("click", () => {
    ui.selectedReservedCard = null;
    ui.selectedMarketCardId = (ui.selectedMarketCardId === card.id) ? null : card.id;
    renderMarket();
    renderPlayers();
  });

  return div;
}

function renderMiniCard(card, selected){
  const mini = renderCardVisual(card, "mini-card");
  mini.dataset.cardId = card.id;
  if (selected) mini.classList.add("selected");
  return mini;
}

function renderCardVisual(card, className){
  const div = document.createElement("div");
  div.className = className + (card?.src ? "" : " card-missing");

  if (card?.src){
    const img = document.createElement("img");
    img.src = card.src;
    img.alt = card.name || "卡牌";
    img.loading = "lazy";
    div.appendChild(img);
  }

  return div;
}

function renderPlayers(){
  if (!el.players) return;
  el.players.innerHTML = "";
  state.players.forEach((p, idx) => {
    ensurePlayerHasAiLevel(p, idx);
    const wrap = document.createElement("div");
    wrap.className = "player";
    wrap.dataset.playerIndex = String(idx);

    const head = document.createElement("div");
    head.className = "player-head";

    const name = document.createElement("div");
    name.className = "player-name";
    name.innerHTML = `
      ${p.isStarter ? `<span class="starter" title="起始玩家">★</span>` : ""}
      <span>${escapeHtml(p.name)}</span>
      ${idx === state.currentPlayerIndex ? `<span class="pip">当前</span>` : ""}
      <span class="pip">奖杯 ${totalTrophiesOfPlayer(p)}</span>
      <span class="pip">精灵球标记 ${totalTokensOfPlayer(p)}/10</span>
    `;
    head.appendChild(name);

    if (idx > 0){
      const aiWrap = document.createElement("label");
      aiWrap.className = "ai-level";
      aiWrap.title = "切换电脑玩家的 AI 难度";
      aiWrap.textContent = "AI";

      const select = document.createElement("select");
      select.className = "ai-select";
      AI_LEVEL_OPTIONS.forEach(opt => {
        const option = document.createElement("option");
        option.value = String(opt.value);
        option.textContent = opt.label;
        select.appendChild(option);
      });
      select.value = String(getPlayerAiLevel(p, idx));
      select.addEventListener("change", () => {
        p.aiLevel = Number(select.value);
        renderPlayers();
        maybeAutoPlay();
      });

      aiWrap.appendChild(select);
      head.appendChild(aiWrap);
    }

    wrap.appendChild(head);

    const zones = document.createElement("div");
    zones.className = "zonegrid";

    zones.appendChild(renderHandZone(p.hand, idx));
    zones.appendChild(renderReserveZone(p.reserved, idx));
    zones.appendChild(renderTokenZone(p.tokens, rewardBonusesOfPlayer(p)));

    wrap.appendChild(zones);
    el.players.appendChild(wrap);
  });
}

function renderHandZone(cards, playerIndex){
  const zone = document.createElement("div");
  zone.className = "zone hand-zone";

  const items = document.createElement("div");
  items.className = "zone-items hand-items";

  const displayCards = cards.slice(0, 10);
  const offset = 16;

  displayCards.forEach((card, idx) => {
    const mini = renderMiniCard(card, false);
    mini.style.left = `${idx * offset}px`;
    mini.style.zIndex = String(1 + idx);
    items.appendChild(mini);
  });

  zone.appendChild(items);
  items.addEventListener("click", (ev) => {
    const cardEl = ev.target.closest(".mini-card");
    if (!cardEl) return;
    openHandModal(playerIndex);
  });

  zone.addEventListener("click", (ev) => {
    if (ev.target.closest(".mini-card")) return;
    openHandModal(playerIndex);
  });
  return zone;
}

function renderReserveZone(cards, playerIndex){
  const zone = document.createElement("div");
  zone.className = "zone reserve-zone";

  const items = document.createElement("div");
  items.className = "zone-items reserve-items";

  for (const card of cards){
    const selected = ui.selectedReservedCard &&
      ui.selectedReservedCard.cardId === card.id &&
      ui.selectedReservedCard.playerIndex === playerIndex;

    const mini = renderMiniCard(card, selected);
    mini.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ui.selectedMarketCardId = null;
      const same = ui.selectedReservedCard &&
        ui.selectedReservedCard.cardId === card.id &&
        ui.selectedReservedCard.playerIndex === playerIndex;

      ui.selectedReservedCard = same ? null : { playerIndex, cardId: card.id };
      renderPlayers();
      renderMarket();
    });

    items.appendChild(mini);
  }

  zone.appendChild(items);
  return zone;
}

function renderTokenZone(tokens, rewardBonuses = []){
  const zone = document.createElement("div");
  zone.className = "zone token-zone";

  const items = document.createElement("div");
  items.className = "zone-items token-items";

  for (let c=0;c<BALL_NAMES.length;c++){
    const t = document.createElement("div");
    t.className = "token-mini";
    t.dataset.color = String(c);

    const img = document.createElement("img");
    img.src = BALL_IMAGES[c];
    img.alt = BALL_NAMES[c];
    img.loading = "lazy";
    t.appendChild(img);

    const count = document.createElement("div");
    count.className = "count-badge";
    count.textContent = `×${tokens[c]}`;
    t.appendChild(count);

    const reward = document.createElement("div");
    reward.className = "reward-badge";
    reward.textContent = `+${rewardBonuses[c] ?? 0}`;
    t.appendChild(reward);

    items.appendChild(t);
  }
  zone.appendChild(items);
  return zone;
}

function renderFullCard(card){
  return renderCardVisual(card, "full-card");
}

function renderCardStack(card){
  const stack = document.createElement("div");
  stack.className = "card-stack";

  const main = renderFullCard(card);
  stack.appendChild(main);

  const underCards = getStackedCards(card);
  underCards.forEach((under, idx) => {
    const underEl = renderFullCard(under);
    underEl.classList.add("stacked-card");
    underEl.style.top = `${14 * (idx + 1)}px`;
    underEl.style.left = `${(idx + 1) * 18}px`;
    underEl.style.zIndex = String(idx + 1);
    stack.appendChild(underEl);
  });

  return stack;
}

function getStackedCards(card){
  return card?.underCards || card?.stackedCards || card?.consumedCards || [];
}

function openHandModal(playerIndex){
  ui.handPreviewPlayerIndex = playerIndex;
  renderHandModal(playerIndex);
  showModal(el.handModal);
}

function renderHandModal(playerIndex = ui.handPreviewPlayerIndex){
  if (!el.handModalBody) return;
  if (playerIndex === null || playerIndex === undefined) return;
  const player = state.players[playerIndex];
  if (!player) return;

  el.handModalTitle.textContent = `${player.name} 的卡牌`;
  el.handModalBody.innerHTML = "";

  const groups = groupCardsByReward(player.hand);
  const order = [...BALL_NAMES.map((_, i) => i), -1];
  const sections = [];

  for (const color of order){
    const list = groups[color] || [];
    if (!list.length) continue;

    const section = document.createElement("div");
    section.className = "hand-group";

    const title = document.createElement("div");
    title.className = "hand-group-title";
    title.textContent = color >= 0 ? `${BALL_NAMES[color]} 奖励` : "未分类";
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "hand-group-grid";
    list.forEach(card => {
      grid.appendChild(renderCardStack(card));
    });

    section.appendChild(grid);
    sections.push({ color, section });
  }

  const coloredSections = sections.filter(s => s.color >= 0);
  const colorKinds = coloredSections.length;
  const needsTwoColumns = colorKinds === 4 || colorKinds === 5;

  el.handModalBody.classList.toggle("two-column", needsTwoColumns);

  if (needsTwoColumns){
    const leftCol = document.createElement("div");
    leftCol.className = "hand-modal-column";
    const rightCol = document.createElement("div");
    rightCol.className = "hand-modal-column";

    coloredSections.forEach((entry, idx) => {
      const target = idx < 3 ? leftCol : rightCol;
      target.appendChild(entry.section);
    });

    sections.filter(s => s.color < 0).forEach(entry => rightCol.appendChild(entry.section));

    el.handModalBody.appendChild(leftCol);
    el.handModalBody.appendChild(rightCol);
  }else if (sections.length){
    sections.forEach(entry => el.handModalBody.appendChild(entry.section));
  }

  if (!sections.length){
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "暂无卡牌";
    el.handModalBody.appendChild(hint);
  }

  requestAnimationFrame(applyHandStackingLayout);
}

function applyHandStackingLayout(){
  if (!el.handModalBody) return;

  const handModalContent = el.handModal?.querySelector?.(".hand-modal-content");
  const handModalStyles = handModalContent ? getComputedStyle(handModalContent) : null;
  const handBodyStyles = el.handModalBody ? getComputedStyle(el.handModalBody) : null;

  const cardWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-w")) || 160;
  const normalGap = 10;

  const modalMaxWidth = Math.floor(window.innerWidth * 0.8);
  const contentPadding = handModalStyles
    ? (parseFloat(handModalStyles.paddingLeft || "0") + parseFloat(handModalStyles.paddingRight || "0"))
    : 40;
  const isTwoColumn = el.handModalBody.classList.contains("two-column");
  const columnGap = isTwoColumn
    ? (parseFloat(handBodyStyles?.columnGap || handBodyStyles?.gap || "0") || 0)
    : 0;

  const columns = Array.from(el.handModalBody.querySelectorAll(".hand-modal-column"));

  const grids = el.handModalBody.querySelectorAll(".hand-group-grid");

  let widestNormal = 0;
  const columnWidths = columns.length ? Array(columns.length).fill(0) : [0];
  grids.forEach(grid => {
    const stacks = grid.querySelectorAll(".card-stack");
    if (!stacks.length) return;

    const totalNormal = stacks.length * cardWidth + (stacks.length - 1) * normalGap;
    widestNormal = Math.max(widestNormal, totalNormal);

    const columnIndex = columns.length ? columns.findIndex(col => col.contains(grid)) : 0;
    if (columnIndex >= 0){
      columnWidths[columnIndex] = Math.max(columnWidths[columnIndex], totalNormal);
    }
  });

  if (handModalContent){
    const combinedColumnWidth = columnWidths.reduce((sum, w) => sum + w, 0);
    const desiredContentWidth = combinedColumnWidth + columnGap * Math.max(columnWidths.length - 1, 0);
    const desired = Math.min(modalMaxWidth, Math.max(360, desiredContentWidth + contentPadding));
    handModalContent.style.width = `${desired}px`;
    handModalContent.style.maxWidth = `${modalMaxWidth}px`;
  }

  grids.forEach(grid => {
    grid.classList.remove("stacked");
    grid.style.removeProperty("--hand-stack-overlap");
    grid.style.removeProperty("min-width");

    const stacks = grid.querySelectorAll(".card-stack");
    if (stacks.length <= 1) return;

    const normalWidth = stacks.length * cardWidth + (stacks.length - 1) * normalGap;
    const modalWidth = handModalContent?.getBoundingClientRect().width || modalMaxWidth;
    const effectiveColumns = columns.length || 1;
    const widthPerColumn = Math.max(
      (modalWidth - contentPadding - columnGap * Math.max(effectiveColumns - 1, 0)) / effectiveColumns,
      0
    );

    const fitsWithinCap = normalWidth <= widthPerColumn;
    if (fitsWithinCap){
      grid.style.minWidth = `${normalWidth}px`;
      return;
    }

    const spacing = (Math.max(widthPerColumn, cardWidth) - cardWidth) / (stacks.length - 1);
    const overlap = spacing - cardWidth;

    grid.classList.add("stacked");
    grid.style.setProperty("--hand-stack-overlap", `${overlap}px`);
  });
}

function groupCardsByReward(cards){
  const groups = {};
  cards.forEach(card => {
    const color = card?.reward?.ball_color ?? -1;
    if (!groups[color]) groups[color] = [];
    groups[color].push(card);
  });
  return groups;
}

function showModal(modal){
  if (ui.tokenReturn && modal !== el.tokenReturnModal) return;
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  if (!modal) return;
  el.modalOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  modal.classList.remove("hidden");
}

function closeModals({ force = false } = {}){
  if (ui.tokenReturn && !force) return;
  if (force) ui.tokenReturn = null;
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  el.modalOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  ui.handPreviewPlayerIndex = null;
}

/* 自检说明：
1) 页面加载无 ReferenceError/TypeError：未新增外部依赖，仅复用现有全局函数与变量。
2) 开局正常开始：AI 流程保持 maybeAutoPlay/runAiTurn 入口不变，未修改初始化路径。
3) AI 回合可自动行动结束：chooseAiAction/executeAiDecision 仍驱动完整行动链。
4) 触发超额精灵球归还：autoReturnTokensForAI 逻辑未改，可继续执行归还并刷新界面。
5) 0~4 难度差异：
   - 0 视野受限且保守保留，决策更随意（高 blunder，反向取色）。
   - 1/2 具正常视野并有基础阻断、保留约束，2 额外珍惜大师球。
   - 3 读取 lv1 牌库顺序，通过 knownDecks 给 futurePromise 调整策略。
   - 4 读取全部牌库并估算对手胜利回合，用 threatBonus 提升阻断与规划深度。
*/
