// ========== 5) 新游戏初始化 ==========
async function newGame(playerCount){
  const lib = await loadCardLibrary();
  const trainers = await loadTrainers();
  lastLoadError = null;
  state = makeEmptyState();
  ui.errorMessage = "";
  state.createdAt = new Date().toISOString();
  state.sessionEndedAt = null;

  state.tokenPool = makeTokenPoolByPlayerCount(playerCount);

  state.players = [];
  for (let i=0;i<playerCount;i++){
    state.players.push({
      id: `P${i}`,
      name: trainers[i].name,
      aiLevel: i === 0 ? DISABLED_AI_LEVEL : DEFAULT_AI_LEVEL,
      isStarter: false,
      hand: [],      // bought/captured cards on table
      reserved: [],  // reserved cards
      tokens: [0,0,0,0,0,0], // counts by color
    });
  }
  state.players[0].isStarter = true;
  state.currentPlayerIndex = 0;
  state.turn = 1;
  state.perTurn = { evolved: false, primaryAction: null };

  state.decks = buildDecksFromLibrary(lib);
  refillMarketFromDecks();

  clearSelections();
  resetSessionTimer();
  renderAll();
}

// token 数量按人数
function makeTokenPoolByPlayerCount(n){
  if (n === 2) return [4,4,4,4,4,5];
  if (n === 3) return [6,6,6,6,6,5];
  return [7,7,7,7,7,5];
}

function levelKey(level){
  if (level === 1) return "lv1";
  if (level === 2) return "lv2";
  if (level === 3) return "lv3";
  if (level === 4) return "rare";
  return "legend";
}

function drawFromDeck(level){
  const deck = state.decks[levelKey(level)];
  return deck?.length ? deck.pop() : null;
}

function ensureMarketSlotsByLevel(level){
  const sizes = { 1: 4, 2: 4, 3: 4, 4: 1, 5: 1 };
  const want = sizes[level] || 0;
  const slots = state.market.slotsByLevel[level] || [];
  while (slots.length < want){
    slots.push(null);
  }
  state.market.slotsByLevel[level] = slots;
}

function refillMarketFromDecks(){
  for (const level of [1,2,3,4,5]){
    ensureMarketSlotsByLevel(level);
    const slots = state.market.slotsByLevel[level];
    for (let i=0;i<slots.length;i++){
      if (!slots[i]){
        slots[i] = drawFromDeck(level);
      }
    }
  }
}

function findMarketCard(cardId){
  for (const level of [1,2,3,4,5]){
    const slots = state.market.slotsByLevel[level] || [];
    const idx = slots.findIndex(c => c && c.id === cardId);
    if (idx >= 0){
      return { level, idx, card: slots[idx] };
    }
  }
  return null;
}
