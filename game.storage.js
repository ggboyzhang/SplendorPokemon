// ========== 9) 存档 / 读档 ==========
function saveToLocal(){
  const payload = makeSavePayload();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  showStatusMessage("已存档到本地 localStorage");
}

function loadFromLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return showStatusMessage("没有找到本地存档", { type: "error" });
  try{
    const parsed = JSON.parse(raw);
    applySavePayload(parsed);
    showStatusMessage("已从本地读档");
  }catch{
    showStatusMessage("读档失败：存档内容损坏", { type: "error" });
  }
}

function makeSavePayload(){
  return {
    version: state.version,
    createdAt: state.createdAt,
    turn: state.turn,
    currentPlayerIndex: state.currentPlayerIndex,
    endTriggered: state.endTriggered,
    endTriggerTurn: state.endTriggerTurn,
    victoryResolved: state.victoryResolved,
    perTurn: state.perTurn,

    tokenPool: state.tokenPool,
    market: state.market,
    decks: state.decks,

    players: state.players.map(p => ({
      name: p.name,
      isStarter: p.isStarter,
      aiLevel: p.aiLevel,
      hand: p.hand,
      reserved: p.reserved,
      tokens: p.tokens
    }))
  };
}

function applySavePayload(payload){
  // 最小校验
  if (!payload || !Array.isArray(payload.players)) throw new Error("bad payload");

  // 重新构建 state，避免残留
  state = makeEmptyState();

  state.turn = payload.turn ?? 1;
  state.currentPlayerIndex = payload.currentPlayerIndex ?? 0;
  state.endTriggered = !!payload.endTriggered;
  state.endTriggerTurn = payload.endTriggerTurn ?? null;
  state.victoryResolved = !!payload.victoryResolved;
  state.perTurn = payload.perTurn ?? { evolved:false, primaryAction: null };
  ensurePerTurnDefaults();

  state.tokenPool = payload.tokenPool ?? [7,7,7,7,7,5];

  state.market = { slotsByLevel: { 1: [], 2: [], 3: [], 4: [], 5: [] } };
  const savedMarket = payload.market && payload.market.slotsByLevel;
  if (savedMarket){
    for (const level of [1,2,3,4,5]){
      state.market.slotsByLevel[level] = Array.isArray(savedMarket[level]) ? savedMarket[level] : [];
    }
  }

  state.decks = {
    lv1: payload.decks?.lv1 || [],
    lv2: payload.decks?.lv2 || [],
    lv3: payload.decks?.lv3 || [],
    rare: payload.decks?.rare || [],
    legend: payload.decks?.legend || [],
  };

  for (const level of [1,2,3,4,5]){
    ensureMarketSlotsByLevel(level);
  }
  refillMarketFromDecks();

  // 玩家（必须包含你要的字段）
  state.players = payload.players.map((p, i) => ({
    id: `P${i}`,
    name: typeof p.name === "string" ? p.name : (i===0 ? "玩家" : `机器人${i}`),
    aiLevel: typeof p.aiLevel === "number" ? p.aiLevel : (i===0 ? DISABLED_AI_LEVEL : DEFAULT_AI_LEVEL),
    isStarter: !!p.isStarter,
    hand: Array.isArray(p.hand) ? p.hand : [],
    reserved: Array.isArray(p.reserved) ? p.reserved : [],
    tokens: Array.isArray(p.tokens) && p.tokens.length===6 ? p.tokens : [0,0,0,0,0,0],
  }));

  // 兜底：至少一个起始玩家
  if (!state.players.some(p => p.isStarter) && state.players[0]){
    state.players[0].isStarter = true;
  }

  clearSelections();
  renderAll();
}

