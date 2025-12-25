// ========== 3) 游戏状态（存档核心） ==========
/**
 * 存档包含：
 * - 每个玩家：hand(手牌区/桌面阵列)、reserved(保留区)、tokens(token区)、name、isStarter
 */
let state = makeEmptyState();

let ui = {
  selectedTokenColors: new Set(), // for take actions
  selectedMarketCardId: null,     // for reserve/buy
  selectedReservedCard: null,     // {playerIndex, cardId}
  handPreviewPlayerIndex: null,
  errorMessage: "",
  tokenReturn: null,              // { playerIndex, required, selected: number[6] }
  sessionTimerInterval: null,
  pendingMasterBallConfirm: null, // { proceed, resolve }
  cheatPlayerIndex: 0,
};

const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const ensurePromise = (value) => (value && typeof value.then === "function") ? value : Promise.resolve(value);

let cardLibraryData = null;

function cloneCardForExport(card){
  if (!card) return null;
  const clone = { ...card };

  if (Array.isArray(card.cost)){
    clone.cost = card.cost.map(c => ({ ...c }));
  }
  if (card.reward){
    clone.reward = { ...card.reward };
  }
  if (card.evolution){
    clone.evolution = { ...card.evolution };
    if (card.evolution.cost){
      clone.evolution.cost = { ...card.evolution.cost };
    }
  }
  if (Array.isArray(card.stackedCards)){
    clone.stackedCards = card.stackedCards.map(cloneCardForExport);
  }
  if (Array.isArray(card.underCards)){
    clone.underCards = card.underCards.map(cloneCardForExport);
  }
  if (Array.isArray(card.consumedCards)){
    clone.consumedCards = card.consumedCards.map(cloneCardForExport);
  }

  return clone;
}

function cloneCardListForExport(list){
  return Array.isArray(list) ? list.map(cloneCardForExport) : [];
}

function makeEmptyState(){
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    sessionEndedAt: null,
    // 公共区（不要求存档也可以存，建议存：方便完全复现）
    tokenPool: [7,7,7,7,7,5], // 默认 4人
    market: {
      slotsByLevel: { 1: [], 2: [], 3: [], 4: [], 5: [] },
    },
    decks: {
      lv1: [],
      lv2: [],
      lv3: [],
      rare: [],
      legend: [],
    },

    players: [],

    turn: 1,
    currentPlayerIndex: 0,
    // 规则约束（每回合一次进化）
    perTurn: {
      evolved: false,
      primaryAction: null,
    },
    endTriggered: false,
    endTriggerTurn: null,
    victoryResolved: false,
  };
}

function ensurePerTurnDefaults(){
  if (!state.perTurn) state.perTurn = { evolved: false, primaryAction: null };
  if (state.perTurn.evolved === undefined) state.perTurn.evolved = false;
  if (state.perTurn.primaryAction === undefined) state.perTurn.primaryAction = null;
}

function getPlayerAiLevel(player, index){
  if (!player) return DISABLED_AI_LEVEL;
  if (typeof player.aiLevel === "number") return player.aiLevel;
  return index === 0 ? DISABLED_AI_LEVEL : DEFAULT_AI_LEVEL;
}

function ensurePlayerHasAiLevel(player, index){
  if (!player) return;
  player.aiLevel = getPlayerAiLevel(player, index);
}

function getPrimaryActionLabel(key){
  return PRIMARY_ACTION_LABELS[key] || "主要行动";
}

function hasTakenPrimaryAction(){
  ensurePerTurnDefaults();
  return !!state.perTurn.primaryAction;
}

function blockIfPrimaryActionLocked(){
  if (!hasTakenPrimaryAction()) return false;
  toast(`本回合已执行【${getPrimaryActionLabel(state.perTurn.primaryAction)}】，请结束回合后再进行其他主要行动`, { type: "error" });
  return true;
}

function markPrimaryAction(actionKey){
  ensurePerTurnDefaults();
  state.perTurn.primaryAction = actionKey;
}

// ========== 3.5) AI 模型输入导出 ==========
/**
 * 构建给外部 AI 模型使用的完整状态 JSON。
 * 说明：
 * - 不依赖 game.ai.js，可在任意调用点直接使用
 * - 默认导出当前轮到的玩家作为调用方，可传入 aiPlayerIndex 覆盖
 * - 返回值为 JSON 字符串，方便直接传给模型或持久化
 */
function makeAiModelInput(aiPlayerIndex = state.currentPlayerIndex){
  const aiPlayer = state.players[aiPlayerIndex] || null;
  const aiLevel = getPlayerAiLevel(aiPlayer, aiPlayerIndex);

  const players = state.players.map((p, idx) => ({
    index: idx,
    id: p.id,
    name: p.name,
    isStarter: !!p.isStarter,
    aiLevel: getPlayerAiLevel(p, idx),
    isHuman: getPlayerAiLevel(p, idx) === DISABLED_AI_LEVEL,
    tokens: Array.isArray(p.tokens) ? [...p.tokens] : [0,0,0,0,0,0],
    reserved: cloneCardListForExport(p.reserved),
    hand: cloneCardListForExport(p.hand),
    trophies: totalTrophiesOfPlayer(p),
    tokenTotal: totalTokensOfPlayer(p),
  }));

  const slotsByLevel = {};
  [1,2,3,4,5].forEach(level => {
    const slots = state.market.slotsByLevel?.[level] || [];
    slotsByLevel[level] = slots.map(cloneCardForExport);
  });

  const payload = {
    meta: {
      turn: state.turn,
      currentPlayerIndex: state.currentPlayerIndex,
      perTurn: state.perTurn,
      endTriggered: !!state.endTriggered,
      victoryResolved: !!state.victoryResolved,
    },
    aiCaller: {
      playerIndex: aiPlayerIndex,
      aiLevel,
      isHuman: aiLevel === DISABLED_AI_LEVEL,
    },
    tokenPool: Array.isArray(state.tokenPool) ? [...state.tokenPool] : [0,0,0,0,0,0],
    market: { slotsByLevel },
    decks: {
      lv1: cloneCardListForExport(state.decks?.lv1),
      lv2: cloneCardListForExport(state.decks?.lv2),
      lv3: cloneCardListForExport(state.decks?.lv3),
      rare: cloneCardListForExport(state.decks?.rare),
      legend: cloneCardListForExport(state.decks?.legend),
    },
    players,
  };

  return JSON.stringify(payload);
}
