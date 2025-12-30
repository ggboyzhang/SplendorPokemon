// ========== 11) AI 自动操作 ==========
let aiRunning = false;

const VISION_LEVELS = Object.freeze({
  SELF_ONLY: "self_only",          // 只能看到市场 + 自己信息
  STANDARD: "standard",            // 与真人相同：市场 + 所有玩家公开信息
  LEVEL1_SEQUENCE: "level1_seq",   // 额外知道 1 级牌的抽牌顺序
  FULL_SEQUENCE: "full_seq",       // 额外知道所有牌堆顺序
});

const AI_PROFILES = [
  {
    label: "入门",
    visionLevel: VISION_LEVELS.SELF_ONLY,
    planningDepth: 1,
    strategyConstraints: {
      canBlockOpponent: false,
      canPreemptiveReserve: false,
      canSpendMasterBallAggressively: false,
      mustKeepReserveSlot: true,
      allowedSacrificeLevel: 0,
    },
  },
  {
    label: "简单",
    visionLevel: VISION_LEVELS.STANDARD,
    planningDepth: 1,
    strategyConstraints: {
      canBlockOpponent: true,
      canPreemptiveReserve: false,
      canSpendMasterBallAggressively: false,
      mustKeepReserveSlot: true,
      allowedSacrificeLevel: 1,
    },
  },
  {
    label: "标准",
    visionLevel: VISION_LEVELS.STANDARD,
    planningDepth: 2,
    strategyConstraints: {
      canBlockOpponent: true,
      canPreemptiveReserve: true,
      canSpendMasterBallAggressively: true,
      mustKeepReserveSlot: false,
      allowedSacrificeLevel: 1,
      preferCaptureOverReserve: false,
    },
  },
  {
    label: "进阶",
    visionLevel: VISION_LEVELS.LEVEL1_SEQUENCE,
    planningDepth: 3,
    strategyConstraints: {
      canBlockOpponent: true,
      canPreemptiveReserve: true,
      canSpendMasterBallAggressively: true,
      mustKeepReserveSlot: false,
      allowedSacrificeLevel: 2,
      preferCaptureOverReserve: true,
    },
  },
  {
    label: "大师",
    visionLevel: VISION_LEVELS.FULL_SEQUENCE,
    planningDepth: 4,
    strategyConstraints: {
      canBlockOpponent: true,
      canPreemptiveReserve: true,
      canSpendMasterBallAggressively: true,
      mustKeepReserveSlot: false,
      allowedSacrificeLevel: 3,
      preferCaptureOverReserve: true,
    },
  },
];

function getAiProfile(level){
  if (level < 0) return null;
  return AI_PROFILES[level] || AI_PROFILES[AI_PROFILES.length - 1];
}

function cloneCard(card){
  if (!card) return null;
  return { ...card, cost: Array.isArray(card.cost) ? card.cost.map(c => ({ ...c })) : [] };
}

function getVisibleGameState(player, aiProfile){
  if (!player || !aiProfile) return null;
  const vision = aiProfile.visionLevel;
  const canSeePlayers = vision !== VISION_LEVELS.SELF_ONLY;
  const canSeeDeckLevel1 = vision === VISION_LEVELS.LEVEL1_SEQUENCE || vision === VISION_LEVELS.FULL_SEQUENCE;
  const canSeeAllDecks = vision === VISION_LEVELS.FULL_SEQUENCE;

  const players = state.players.map((p, idx) => {
    const isSelf = p === player;
    if (!isSelf && !canSeePlayers) return null;
    const snapshot = {
      index: idx,
      name: p.name,
      isSelf,
      trophies: totalTrophiesOfPlayer(p),
      tokens: { ...(p.tokens || {}) },
      reserved: (p.reserved || []).map(cloneCard),
      hand: (p.hand || []).map(cloneCard),
      isHuman: getPlayerAiLevel(p, idx) < 0,
      aiLevel: getPlayerAiLevel(p, idx),
    };
    return snapshot;
  }).filter(Boolean);

  const decks = {};
  if (canSeeDeckLevel1) decks[levelKey(1)] = (state.decks[levelKey(1)] || []).map(cloneCard);
  if (canSeeAllDecks){
    [1,2,3,4,5].forEach(lv => { decks[levelKey(lv)] = (state.decks[levelKey(lv)] || []).map(cloneCard); });
  }

  const market = Object.keys(state.market.slotsByLevel || {}).reduce((map, key) => {
    const level = Number(key);
    map[level] = (state.market.slotsByLevel[level] || []).map(cloneCard);
    return map;
  }, {});

  return {
    turn: state.turn,
    tokenPool: { ...(state.tokenPool || {}) },
    market,
    decks,
    players,
  };
}

function visibleMarketCards(visibleState, levels = [1,2,3,4,5]){
  if (!visibleState?.market) return [];
  const requested = new Set(levels);
  return Object.keys(visibleState.market)
    .map(k => Number(k))
    .filter(level => requested.has(level))
    .flatMap(level => (visibleState.market[level] || []).map(card => ({ level, card })));
}

function visiblePlayerSnapshot(visibleState, player){
  if (!visibleState?.players) return null;
  const idx = state.players.indexOf(player);
  return visibleState.players.find(p => p.index === idx) || null;
}

function visibleOpponents(visibleState, player){
  const selfIdx = state.players.indexOf(player);
  return (visibleState?.players || []).filter(p => p.index !== selfIdx);
}

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

function aiEstimateTurnsToWin(player, visibleState, ctx = {}){
  if (!player || !visibleState) return Infinity;
  const playerView = visiblePlayerSnapshot(visibleState, player);
  const trophies = playerView ? playerView.trophies : totalTrophiesOfPlayer(player);
  const remain = Math.max(0, 18 - trophies);
  if (remain === 0) return 0;

  const rewardBonuses = rewardBonusesOfPlayer(player) || [];
  const bonusGain = Math.max(0, rewardBonuses.reduce((s, n) => s + (n || 0), 0) / 4);
  const recentRate = visibleState.turn > 1 ? (trophies / Math.max(1, visibleState.turn - 1)) : 0;
  const baselineGain = Math.max(1, Math.min(5, 1 + bonusGain + recentRate));

  const estimateCtx = {
    level: ctx.level,
    knownDecks: ctx.knownDecks || {},
    visibleState,
    opponentTurnDistance: () => Infinity,
    threatBonus: () => 0,
    futurePromise(card){ return aiFuturePromise(card, ctx.knownDecks); },
  };

  const goal = aiSelectGoalCard(player, estimateCtx, visibleState) || aiSelectReserveTarget(player, estimateCtx, visibleState);
  const bestPoint = Math.max(1, Number(goal?.card?.point) || 1);
  const turnsToCard = goal?.card ? (aiTurnsToAfford(player, goal.card, estimateCtx, true) + 1) : 2;
  const optimisticGain = Math.max(bestPoint, baselineGain);
  const cycles = Math.ceil(remain / optimisticGain);
  return Math.max(turnsToCard, cycles);
}

function aiBuildContext(player, profile, visibleState){
  const level = AI_PROFILES.indexOf(profile);
  const planningDepth = profile?.planningDepth || 1;
  const knownDecks = {};
  if (profile.visionLevel === VISION_LEVELS.LEVEL1_SEQUENCE || profile.visionLevel === VISION_LEVELS.FULL_SEQUENCE){
    knownDecks[1] = visibleState?.decks?.[levelKey(1)] || [];
  }
  if (profile.visionLevel === VISION_LEVELS.FULL_SEQUENCE){
    [1,2,3,4,5].forEach(lv => { knownDecks[lv] = visibleState?.decks?.[levelKey(lv)] || []; });
  }

  const opponentSnapshot = visibleOpponents(visibleState, player);
  const baselineCtx = { level, knownDecks, visibleState };
  const selfEstimatedTurns = aiEstimateTurnsToWin(player, visibleState, baselineCtx);
  const urgentOpponents = opponentSnapshot.map(item => ({
    view: item,
    turns: aiEstimateTurnsToWin(state.players[item.index], visibleState, baselineCtx),
    trophies: item.trophies,
    isHuman: item.isHuman,
  }));

  const fastestOpponent = urgentOpponents.reduce((best, cur) => {
    if (!best || cur.turns < best.turns) return cur;
    return best;
  }, null);

  const dangerousOpponent = fastestOpponent;
  const dangerousOpponentEstimatedTurnsToWin = dangerousOpponent ? dangerousOpponent.turns : Infinity;
  const threatWindow = Math.min(planningDepth + 1, 4);

  const mustBlock = dangerousOpponent && planningDepth > 0 && (
    dangerousOpponentEstimatedTurnsToWin <= selfEstimatedTurns ||
    (18 - dangerousOpponent.trophies) <= threatWindow ||
    dangerousOpponentEstimatedTurnsToWin <= threatWindow
  );

  return {
    level,
    planningDepth,
    knownDecks,
    urgentOpponents,
    selfEstimatedTurns,
    dangerousOpponent,
    dangerousOpponentEstimatedTurnsToWin,
    myEstimatedTurnsToWin: selfEstimatedTurns,
    blockOrLose: !!mustBlock,
    mustBlock,
    threatBonus(card){
      if (level < 1 || !card) return 0;
      let bonus = 0;
      urgentOpponents.forEach(({ view, turns }) => {
        const opponent = state.players[view.index];
        if (!opponent) return;
        if (canAfford(opponent, card)) bonus += 40 + (Number(card.point) || 0) * 15;
        else if (turns <= planningDepth + 1 && (Number(card.point) || 0) >= 2){
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
      urgentOpponents.forEach(({ view }) => {
        const opponent = state.players[view.index];
        const dist = aiTurnsToAfford(opponent, card, { level }, true);
        best = Math.min(best, dist);
      });
      return best;
    },
  };
}

function aiSelectBuyTarget(player, ctx, visibleState){
  const candidates = [];
  player.reserved.forEach(card => {
    if (card && canAfford(player, card)) candidates.push({ source: "reserved", card });
  });
  visibleMarketCards(visibleState).forEach(({ card }) => {
    if (card && canAfford(player, card)) candidates.push({ source: "market", card });
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => aiCardScore(b.card, player, ctx) - aiCardScore(a.card, player, ctx));
  return candidates[0];
}

function aiSelectEvolveTarget(player, ctx, visibleState){
  const options = [];
  const candidates = [
    ...visibleMarketCards(visibleState).map(({ card }) => ({ card, source: "market" })),
    ...player.reserved.map(card => ({ card, source: "reserved" })),
  ];

  for (const { card, source } of candidates){
    if (!card) continue;
    const base = player.hand.find(c => c?.evolution?.name === card.name && canAffordEvolution(player, c));
    if (!base) continue;
    const cost = (card.cost || []).reduce((s, c) => s + (Number(c.number) || 0), 0);
    if (ctx.level >= 2 && cost > 0 && totalTokensOfPlayer(player) < 6) continue; // 避免用主行动硬进化
    options.push({ card, source });
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

function aiSelectReserveTarget(player, ctx, visibleState){
  const reservable = visibleMarketCards(visibleState, [1,2,3]).filter(({ card }) => card);
  if (!reservable.length) return null;
  reservable.sort((a, b) => aiReserveScore(b.card, player, ctx) - aiReserveScore(a.card, player, ctx));
  return reservable[0];
}

function aiSelectGoalCard(player, ctx, visibleState){
  const candidates = [];
  player.reserved.forEach(card => { if (card) candidates.push({ source: "reserved", card }); });
  visibleMarketCards(visibleState).forEach(({ card, level }) => { if (card) candidates.push({ source: level, card }); });
  if (!candidates.length) return null;

  function planScore(card){
    const base = aiCardScore(card, player, ctx);
    const turnCost = aiTurnsToAfford(player, card, ctx, ctx.level >= 2);
    const threatDistance = ctx.opponentTurnDistance(card);
    const turnCostWeight = ctx.level >= 3 ? 10 : 15; // 高难度放松长线惩罚，鼓励节奏
    let score = base - turnCost * turnCostWeight;
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
  const dangerousView = ctx.dangerousOpponent?.view;
  const dangerous = dangerousView ? state.players[dangerousView.index] : null;
  const cards = [card, nextCard].filter(Boolean);
  if (!cards.length) return 0;

  function distanceTo(cardCandidate){
    if (!cardCandidate) return Infinity;
    if (dangerous) return aiTurnsToAfford(dangerous, cardCandidate, { level: ctx.level }, true);
    return ctx.opponentTurnDistance(cardCandidate);
  }

  let best = Infinity;
  cards.forEach(c => {
    best = Math.min(best, distanceTo(c));
  });

  if (best <= 1) return 2;
  if (best <= 2) return 1;
  return 0;
}

function aiDetectPlanType(decision, ctx, profile){
  if (!decision) return "develop";
  const planningWindow = profile?.planningDepth || 1;
  const threatDistance = decision.target?.card ? ctx.opponentTurnDistance(decision.target.card) : Infinity;
  const withinWindow = Number.isFinite(threatDistance) && threatDistance <= planningWindow + 1;
  if (decision.planMeta?.opponentThreat) return "block";
  if (withinWindow && ctx.blockOrLose) return "block";
  if (decision.planMeta?.revealNext) return "reveal";
  if (decision.type === "take3" || decision.type === "take2") return "economy";
  return "develop";
}

function aiEvaluatePlan(decision, player, ctx, planType, profile, visibleState){
  if (!decision) return null;
  const constraints = profile?.strategyConstraints || {};
  const usesMasterBall = decision.target?.card && aiWouldSpendMasterBall(player, decision.target.card);
  if (planType === "block" && !constraints.canBlockOpponent) return null;
  if (decision.type === "reserve" && constraints.mustKeepReserveSlot && player.reserved.length >= 2) return null;
  if (decision.type === "reserve" && !constraints.canPreemptiveReserve){
    const threatDistance = decision.target?.card ? ctx.opponentTurnDistance(decision.target.card) : Infinity;
    if (threatDistance > (ctx.planningDepth || 1)) return null;
  }
  if (usesMasterBall && !constraints.canSpendMasterBallAggressively){
    const mustUseMaster = decision.type === "buy" && !!decision.target?.card && !canAfford(player, decision.target.card, true);
    if (!mustUseMaster) return null;
  }

  const selfGain = Number(decision.target?.card?.point) || 0;
  const turnsToAfford = decision.target?.card
    ? aiTurnsToAfford(player, decision.target.card, ctx, constraints.canSpendMasterBallAggressively)
    : 0;
  const selfTurns = Number.isFinite(ctx.selfEstimatedTurns) ? ctx.selfEstimatedTurns : 8;
  const projectedSelf = Math.max(0, selfTurns - (selfGain > 0 ? 1 : 0));
  const opponentImpact = aiPlanOpponentImpact(decision, ctx);
  const projectedOpponent = ctx.dangerousOpponent ? ctx.dangerousOpponent.turns + opponentImpact : Infinity;
  const baseOpponentTurns = Number.isFinite(ctx.dangerousOpponentEstimatedTurnsToWin)
    ? ctx.dangerousOpponentEstimatedTurnsToWin
    : Infinity;
  const delayOpponentBy = (Number.isFinite(baseOpponentTurns) && Number.isFinite(projectedOpponent))
    ? Math.max(0, baseOpponentTurns - projectedOpponent)
    : 0;

  const tempoWeight = 12 - Math.min(6, ctx.planningDepth * 2);
  const selfProgressScore = (selfGain * 80) - (turnsToAfford * tempoWeight) + (decision.score || 0);
  const opponentDelayScore = (planType === "block" ? 30 : 0) + delayOpponentBy * 40 + opponentImpact * 30;
  const overflowPenalty = decision.planMeta?.overflow ? 30 : 0;
  const masterPenalty = usesMasterBall ? (constraints.canSpendMasterBallAggressively ? 6 : 20) : 0;
  const reservePenalty = (decision.type === "reserve" && constraints.mustKeepReserveSlot && player.reserved.length >= 1) ? 10 : 0;
  const reservePriorityPenalty = (decision.type === "reserve" && constraints.preferCaptureOverReserve)
    ? (20 + Math.max(0, player.reserved.length - 1) * 10)
    : 0;
  const riskCost = overflowPenalty + masterPenalty + reservePenalty + reservePriorityPenalty;

  let resourceEfficiency = 0;
  if (decision.type === "take3" || decision.type === "take2"){
    resourceEfficiency = 10 + (decision.colors?.length || 0) * 5;
  } else if (decision.type === "buy" || decision.type === "evolve"){
    resourceEfficiency = 20 + (decision.target?.card?.reward?.number || 0) * 4;
  } else if (decision.type === "reserve"){
    resourceEfficiency = 8;
  }

  const compositeScore = selfProgressScore + opponentDelayScore + resourceEfficiency - riskCost;

  return {
    decision,
    planType,
    projectedSelf,
    opponentImpact,
    delayOpponentBy,
    usesMasterBall,
    selfGain,
    evaluation: {
      selfProgressScore,
      opponentDelayScore,
      riskCost,
      resourceEfficiency,
    },
    compositeScore,
  };
}

function aiPickTake3Colors(player, targetCard, ctx, visibleState){
  const available = BALL_KEYS
    .map((_, idx) => idx)
    .filter(idx => idx !== Ball.master_ball && (visibleState?.tokenPool?.[idx] || 0) > 0);
  if (!available.length) return [];
  const targetNeed = aiCostDeficit(targetCard, player);
  available.sort((a, b) => {
    const needDiff = (targetNeed[b] || 0) - (targetNeed[a] || 0);
    if (needDiff !== 0) return needDiff;
    const needScore = aiColorNeedScore(player, a) - aiColorNeedScore(player, b);
    if (needScore !== 0) return needScore;
    return (visibleState?.tokenPool?.[b] || 0) - (visibleState?.tokenPool?.[a] || 0);
  });
  const picked = available.slice(0, Math.min(3, available.length));
  if (ctx.level === 0) return picked.slice().reverse();
  return picked;
}

function aiPickTake2Color(player, targetCard, visibleState){
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
    return (visibleState?.tokenPool?.[b] || 0) - (visibleState?.tokenPool?.[a] || 0);
  });
  return options[0];
}

function aiShouldReserve(player, ctx, target, profile, visibleState, availability){
  if (!target) return false;
  if (player.reserved.length >= 3) return false;
  const opponentDistance = ctx.opponentTurnDistance(target.card);
  if (opponentDistance > 1 && player.reserved.length >= 2 && totalTrophiesOfPlayer(player) < 15) return false; // E
  if (player.reserved.length >= 1 && ctx.level === 0) return false; // B 入门少保留
  if (profile?.strategyConstraints?.mustKeepReserveSlot && player.reserved.length >= 2) return false;
  if (ctx.level >= 2 && (visibleState?.tokenPool?.[Ball.master_ball] || 0) <= 0 && player.reserved.length >= 2) return false; // C
  if (profile?.strategyConstraints?.preferCaptureOverReserve && player.reserved.length >= 1 && availability?.buy){
    const canBuyAny = visibleMarketCards(visibleState).some(({ card }) => card && canAfford(player, card));
    if (canBuyAny) return false;
  }
  return true;
}

function aiSelectRevealDecision(player, ctx, availability, visibleState){
  if (ctx.level < 3) return null;
  let best = null;
  for (const { card, level } of visibleMarketCards(visibleState, [1,2,3])){
    if (!card) continue;
    const deck = ctx.knownDecks[level];
    if (!deck || !deck.length) continue;
    const next = deck[0];
    if (!next) continue;
    const pressure = aiCardScore(next, player, ctx) - aiCardScore(card, player, ctx);
    const opp = ctx.dangerousOpponent?.p;
    const nextThreatDistance = opp ? aiTurnsToAfford(opp, next, { level: ctx.level }, true) : Infinity;
    const opponentThreat = Number(next.point) >= 3 || nextThreatDistance <= 2;
    if (pressure < 8 && ctx.level < 4 && !opponentThreat) continue;
    if (pressure < 14 && ctx.mustBlock && !opponentThreat) continue;
    const canBuyNow = availability.buy && canAfford(player, card);
    const canReserveNow = availability.reserve && (player.reserved.length < 3 || state.tokenPool[Ball.master_ball] > 0);
    if (!canBuyNow && !canReserveNow) continue;
    const decision = {
      type: canBuyNow ? "buy" : "reserve",
      target: { source: "market", card },
      score: pressure + (canBuyNow ? 10 : 0) + (opponentThreat ? 20 : 0),
      planMeta: { revealNext: next, opponentThreat },
    };
    if (!best || decision.score > best.score){
      best = decision;
    }
  }
  return best;
}

function chooseAiAction(player, level){
  const profile = getAiProfile(level);
  const visibleState = getVisibleGameState(player, profile);
  const availability = getActionAvailability();
  const ctx = aiBuildContext(player, profile, visibleState);
  const decisions = [];
  const goal = aiSelectGoalCard(player, ctx, visibleState);
  const blockOrLose = ctx.blockOrLose;

  if (availability.buy){
    const target = aiSelectBuyTarget(player, ctx, visibleState);
    if (target) decisions.push({ type: "buy", target, score: aiCardScore(target.card, player, ctx) + 20 });
  }

  if (availability.evolve){
    const target = aiSelectEvolveTarget(player, ctx, visibleState);
    if (target) decisions.push({ type: "evolve", target, score: aiCardScore(target.card, player, ctx) });
  }

  if (availability.reserve){
    const target = aiSelectReserveTarget(player, ctx, visibleState);
    if (aiShouldReserve(player, ctx, target, profile, visibleState, availability)){
      decisions.push({ type: "reserve", target, score: aiReserveScore(target?.card, player, ctx) - 5 });
    }
  }

  const revealDecision = aiSelectRevealDecision(player, ctx, availability, visibleState);
  if (revealDecision) decisions.push(revealDecision);

  const desireCard = decisions.length ? decisions[0].target?.card : aiSelectReserveTarget(player, ctx, visibleState)?.card;
  const plannedCard = goal?.card || desireCard;

  if (availability.take3){
    const colors = aiPickTake3Colors(player, plannedCard, ctx, visibleState);
    const projectedTokens = totalTokensOfPlayer(player) + colors.length;
    if (colors.length){
      const overflow = projectedTokens > 10;
      decisions.push({ type: "take3", colors, score: 10 + colors.length, planMeta: { overflow } });
    }
  }

  if (availability.take2){
    const color = aiPickTake2Color(player, plannedCard, visibleState);
    const projectedTokens = totalTokensOfPlayer(player) + 2;
    if (color !== null && color !== undefined){
      const overflow = projectedTokens > 10;
      decisions.push({ type: "take2", colors: [color], score: 9, planMeta: { overflow } });
    }
  }

  if (!decisions.length) return null;

  const plans = [];
  decisions.forEach(decision => {
    const planType = aiDetectPlanType(decision, ctx, profile);
    const plan = aiEvaluatePlan(decision, player, ctx, planType, profile, visibleState);
    if (plan) plans.push(plan);
  });

  if (!plans.length && (availability.take3 || availability.take2)){
    decisions.forEach(decision => {
      if (!decision.planMeta) decision.planMeta = {};
      decision.planMeta.overflow = true;
      const planType = aiDetectPlanType(decision, ctx, profile);
      const plan = aiEvaluatePlan(decision, player, ctx, planType, profile, visibleState);
      if (plan) plans.push(plan);
    });
  }

  if (!plans.length){
    const fallback = decisions.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    return fallback || null;
  }

  const bestSelf = plans.reduce((best, cur) => {
    if (!best || cur.evaluation.selfProgressScore > best.evaluation.selfProgressScore) return cur;
    return best;
  }, null);

  const allowedSacrifice = profile.strategyConstraints.allowedSacrificeLevel || 0;
  const filteredPlans = plans.filter(plan => {
    if (!bestSelf) return true;
    const sacrifice = bestSelf.evaluation.selfProgressScore - plan.evaluation.selfProgressScore;
    if (plan.planType === "block" && sacrifice / 40 > allowedSacrifice) return false;
    return true;
  });

  const candidates = filteredPlans.length ? filteredPlans : plans;

  if (blockOrLose){
    candidates.sort((a, b) => {
      const blockWeightA = a.planType === "block" ? 1 : 0;
      const blockWeightB = b.planType === "block" ? 1 : 0;
      if (blockWeightA !== blockWeightB) return blockWeightB - blockWeightA;
      return (b.compositeScore || 0) - (a.compositeScore || 0);
    });
  } else {
    candidates.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
  }

  const topScore = candidates[0]?.compositeScore;
  const topPlans = candidates.filter(p => Math.abs((p.compositeScore || 0) - topScore) < 1e-6);
  if (topPlans.length > 1){
    return topPlans[Math.floor(Math.random() * topPlans.length)]?.decision || candidates[0].decision;
  }

  return candidates[0]?.decision || decisions[0];
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
      ui.selectedMarketCardId = null;
      if (decision.target.source === "reserved"){
        ui.selectedReservedCard = { playerIndex: state.currentPlayerIndex, cardId: decision.target.card.id };
      } else {
        ui.selectedMarketCardId = decision.target.card.id;
      }
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
      if (!decision){
        const availability = getActionAvailability();
        const canAct = availability.buy || availability.reserve || availability.take3 || availability.take2 || availability.evolve;
        if (!canAct){
          // 无可用主要行动时，视为跳过以推进回合，避免 AI 卡住
          markPrimaryAction("skip");
          endTurn();
          await wait(AI_DELAY_MS);
          continue;
        }
        break;
      }
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
  const selected = ui.selectedMarketCardId === card.id;
  const buyable = canCurrentPlayerBuyCardNow(card);
  const classes = ["market-card"];
  if (selected) classes.push("selected");
  else if (buyable) classes.push("glow-gold");
  div.className = classes.join(" ");
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

function renderMiniCard(card, selected, extraClass = ""){
  const mini = renderCardVisual(card, "mini-card" + (extraClass ? ` ${extraClass}` : ""));
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
    const highlight = canCurrentPlayerEvolveCard(card);
    const mini = renderMiniCard(card, false, highlight ? "glow-silver" : "");
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
    const highlight = canCurrentPlayerBuyReservedCard(card, playerIndex) && !selected;

    const mini = renderMiniCard(card, selected, highlight ? "glow-gold" : "");
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

function renderFullCard(card, extraClass = ""){
  return renderCardVisual(card, "full-card" + (extraClass ? ` ${extraClass}` : ""));
}

function renderCardStack(card, { highlightClass = "" } = {}){
  const stack = document.createElement("div");
  stack.className = "card-stack";

  const main = renderFullCard(card, highlightClass);
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
      const highlight = canCurrentPlayerEvolveCard(card) ? "glow-silver" : "";
      grid.appendChild(renderCardStack(card, { highlightClass: highlight }));
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
