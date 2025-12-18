// game.js

// ========== 1) 枚举：精灵球 ==========
const Ball = Object.freeze({
  poke_ball: 0,
  heal_ball: 1,
  great_ball: 2,
  quick_ball: 3,
  ultra_ball: 4,
  master_ball: 5,
});

const BALL_KEYS = [
  "poke_ball",
  "heal_ball",
  "great_ball",
  "quick_ball",
  "ultra_ball",
  "master_ball",
];
const BALL_NAMES = ["精灵球", "治愈球", "超级球", "先机球", "高级球", "大师球"];
const BALL_IMAGES = [
  "token_image/精灵球.png",
  "token_image/治愈球.png",
  "token_image/超级球.png",
  "token_image/先机球.png",
  "token_image/高级球.png",
  "token_image/大师球.png",
];
const STORAGE_KEY = "pokemon_splendor_save_v1";

const PRIMARY_ACTION_LABELS = {
  take3: "拿取异色标记",
  take2: "拿取同色标记",
  reserve: "保留卡牌",
  buy: "捕捉",
};

const DISABLED_AI_LEVEL = -1;
const DEFAULT_AI_LEVEL = 2; // 标准
const AI_LEVEL_OPTIONS = [
  { value: DISABLED_AI_LEVEL, label: "关闭" },
  { value: 0, label: "入门" },
  { value: 1, label: "简单" },
  { value: 2, label: "标准" },
  { value: 3, label: "进阶" },
  { value: 4, label: "大师" },
];
const AI_BLUNDER_RATE = [0.6, 0.4, 0.2, 0.05, 0.0];
const AI_DELAY_MS = 420;

// ========== 2) DOM ==========
const $ = (sel) => document.querySelector(sel);

const el = {
  tokenPool: $("#tokenPool"),
  market: $("#market"),
  players: $("#players"),

  playerCount: $("#playerCount"),
  btnNew: $("#btnNew"),
  btnSave: $("#btnSave"),
  btnLoad: $("#btnLoad"),
  btnResetStorage: $("#btnResetStorage"),
  btnAiInfo: $("#btnAiInfo"),

  modalOverlay: $("#modalOverlay"),
  confirmNewGameModal: $("#confirmNewGameModal"),
  victoryModal: $("#victoryModal"),
  playerCountModal: $("#playerCountModal"),
  btnSaveAndNew: $("#btnSaveAndNew"),
  btnNewWithoutSave: $("#btnNewWithoutSave"),
  btnCancelNew: $("#btnCancelNew"),
  btnConfirmPlayerCount: $("#btnConfirmPlayerCount"),
  btnCancelPlayerCount: $("#btnCancelPlayerCount"),
  btnVictoryConfirm: $("#btnVictoryConfirm"),
  victoryWinnerName: $("#victoryWinnerName"),
  victoryDetails: $("#victoryDetails"),

  aiInfoModal: $("#aiInfoModal"),
  btnCloseAiInfo: $("#btnCloseAiInfo"),

  handModal: $("#handModal"),
  handModalTitle: $("#handModalTitle"),
  handModalBody: $("#handModalBody"),
  btnCloseHandModal: $("#btnCloseHandModal"),

  tokenReturnModal: $("#tokenReturnModal"),
  tokenReturnInfo: $("#tokenReturnInfo"),
  tokenReturnList: $("#tokenReturnList"),
  btnConfirmTokenReturn: $("#btnConfirmTokenReturn"),

  errorBanner: $("#errorBanner"),

  actTake3: $("#actTake3"),
  actTake2: $("#actTake2"),
  actReserve: $("#actReserve"),
  actBuy: $("#actBuy"),
  actEvolve: $("#actEvolve"),
  actEndTurn: $("#actEndTurn"),
};

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
};

const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const ensurePromise = (value) => (value && typeof value.then === "function") ? value : Promise.resolve(value);

let cardLibraryData = null;

function makeEmptyState(){
  return {
    version: 1,
    createdAt: new Date().toISOString(),
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

function isAIControlledPlayer(index){
  return getPlayerAiLevel(state.players[index], index) >= 0 && index > 0;
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

// ========== 4) 卡牌数据：真实 cards ==========
let cardLibraryPromise = null;
let lastLoadError = null;

function loadCardLibrary(){
  if (!cardLibraryPromise){
    const url = new URL("cards.json", window.location.href).toString();

    cardLibraryPromise = fetch(url, { cache: "no-store", headers: { "Accept": "application/json" } })
      .then(res => {
        if (!res.ok) throw new Error(`cards.json 加载失败（${res.status}）`);
        return res.json();
      })
      .catch(err => {
        // 失败后允许重新尝试加载
        cardLibraryPromise = null;
        const isFileProtocol = window.location.protocol === "file:";
        if (isFileProtocol){
          lastLoadError = "无法在 file:// 下加载 cards.json，请在本地服务器上打开";
        } else {
          lastLoadError = err?.message || "Failed to fetch";
        }
        throw err;
      });
  }
  return cardLibraryPromise.then(lib => {
    cardLibraryData = lib;
    return lib;
  });
}

function normalizeCard(raw, level){
  return {
    ...raw,
    id: raw.md5 || raw.id || `${level}-${Math.random().toString(16).slice(2)}`,
    level: raw.level ?? level,
  };
}

function buildDecksFromLibrary(lib){
  return {
    lv1: shuffle((lib.level_1 || []).map(c => normalizeCard(c, 1))),
    lv2: shuffle((lib.level_2 || []).map(c => normalizeCard(c, 2))),
    lv3: shuffle((lib.level_3 || []).map(c => normalizeCard(c, 3))),
    rare: shuffle((lib.rare || []).map(c => normalizeCard(c, 4))),
    legend: shuffle((lib.legend || []).map(c => normalizeCard(c, 5))),
  };
}

// ========== 5) 新游戏初始化 ==========
async function newGame(playerCount){
  const lib = await loadCardLibrary();
  lastLoadError = null;
  state = makeEmptyState();
  ui.errorMessage = "";

  state.tokenPool = makeTokenPoolByPlayerCount(playerCount);

  state.players = [];
  for (let i=0;i<playerCount;i++){
    state.players.push({
      id: `P${i}`,
      name: i === 0 ? "玩家" : `机器人${i}`,
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
  const key = levelKey(level);
  const deck = state.decks[key];
  if (!deck || deck.length === 0) return null;
  return deck.pop();
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

function totalScoreOfPlayer(p){
  return flattenHandCards(p).reduce((sum, c)=>sum + (Number(c.point) || 0), 0);
}

function penaltyHandCount(p){
  return flattenHandCards(p).filter(c => (Number(c.point) || 0) < 0).length;
}

function trophyCardCount(p){
  return flattenHandCards(p).filter(c => (Number(c.point) || 0) > 0).length;
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

function animateCardMove(startEl, targetEl, duration = 800){
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

// ========== 7) 行动实现 ==========
function actionTake3Different(){
  if (blockIfPrimaryActionLocked()) return Promise.resolve(false);
  const p = currentPlayer();
  const colors = [...ui.selectedTokenColors];
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

  // 实际可拿：供应区有的才拿
  for (const c of colors){
    state.tokenPool[c] -= 1;
    p.tokens[c] += 1;
  }

  markPrimaryAction("take3");
  clampTokenLimit(p);
  clearSelections();
  renderAll();
  toast(`拿取 ${colors.length} 个不同颜色精灵球标记`);
  return Promise.resolve(true);
}

function actionTake2Same(){
  if (blockIfPrimaryActionLocked()) return Promise.resolve(false);
  const p = currentPlayer();
  const colors = [...ui.selectedTokenColors];
  if (colors.length === 0) return Promise.resolve(toast("先选择精灵球标记", { type: "error" }));
  if (colors.length !== 1) return Promise.resolve(toast("该行动只能选择 1 种精灵球标记颜色", { type: "error" }));
  const c = colors[0];
  if (c === Ball.master_ball) return Promise.resolve(toast("大师球只能在保留卡牌时获得", { type: "error" }));
  if (!canTakeTwoSame(c)) return Promise.resolve(toast("该颜色精灵球标记供应不足 4 个，不能拿 2 个同色", { type: "error" }));

  state.tokenPool[c] -= 2;
  p.tokens[c] += 2;

  markPrimaryAction("take2");
  clampTokenLimit(p);
  clearSelections();
  renderAll();
  toast("拿取 2 个同色精灵球标记");
  return Promise.resolve(true);
}

function actionReserve(){
  if (blockIfPrimaryActionLocked()) return Promise.resolve(false);
  const p = currentPlayer();
  if (p.reserved.length >= 3){
    if (state.tokenPool[Ball.master_ball] <= 0) return Promise.resolve(toast("保留区已满且没有可拿的大师球精灵球标记", { type: "error" }));
    state.tokenPool[Ball.master_ball] -= 1;
    p.tokens[Ball.master_ball] += 1;
    markPrimaryAction("reserve");
    clampTokenLimit(p);
    clearSelections();
    renderAll();
    toast("保留区已满，本次仅拿取 1 个大师球精灵球标记");
    return Promise.resolve(true);
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
  if (state.tokenPool[Ball.master_ball] > 0){
    state.tokenPool[Ball.master_ball] -= 1;
    p.tokens[Ball.master_ball] += 1;
    gotMaster = true;
  }

  markPrimaryAction("reserve");
  clampTokenLimit(p);
  clearSelections();

  return animateCardMove(startEl, targetZone).then(() => {
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

// ========== 8) 终局触发（≥18 奖杯） ==========
function checkEndTrigger(){
  for (const p of state.players){
    if (totalTrophiesOfPlayer(p) >= 18 && !state.endTriggered){
      state.endTriggered = true;
      state.endTriggerTurn = state.turn;
      toast(`终局触发：${p.name} 奖杯≥18（将在回合平衡后结算）`);
      break;
    }
  }
}

function hasAnyPlayerReachedVictoryThreshold(){
  return state.players.some(p => totalTrophiesOfPlayer(p) >= 18);
}

function shouldResolveVictory(isLastPlayerOfRound){
  if (state.victoryResolved) return false;

  if (!state.endTriggered && hasAnyPlayerReachedVictoryThreshold()){
    state.endTriggered = true;
    state.endTriggerTurn = state.turn;
  }

  if (!state.endTriggered) return false;

  if (state.turn > state.endTriggerTurn) return true;
  if (state.turn === state.endTriggerTurn && isLastPlayerOfRound) return true;
  return false;
}

function resolveVictory(){
  const ranking = state.players.map((p, idx) => ({
    player: p,
    index: idx,
    score: totalScoreOfPlayer(p),
    penalty: penaltyHandCount(p),
    trophyCards: trophyCardCount(p),
  })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.penalty !== a.penalty) return b.penalty - a.penalty;
    if (b.trophyCards !== a.trophyCards) return b.trophyCards - a.trophyCards;
    return a.index - b.index;
  });

  const winner = ranking[0];
  state.victoryResolved = true;
  showVictoryModal(winner);
}

function showVictoryModal(winner){
  if (!winner){
    toast("未找到胜利者", { type: "error" });
    return;
  }

  if (el.victoryWinnerName){
    el.victoryWinnerName.textContent = `${winner.player.name} 获胜！`;
  }

  if (el.victoryDetails){
    el.victoryDetails.innerHTML = `
      <div>分数：${winner.score}</div>
      <div>倒扣手牌：${winner.penalty}</div>
      <div>奖杯卡牌数：${winner.trophyCards}</div>
    `;
  }

  if (el.victoryModal){
    showModal(el.victoryModal);
  }else{
    toast(`终局结算：${winner.player.name} 获胜！（分数：${winner.score}）`);
  }
}

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

// ========== 11) AI 自动操作 ==========
let aiRunning = false;

function aiCardScore(card){
  const point = Number(card?.point) || 0;
  const reward = Number(card?.reward?.number) || 0;
  const costSize = Array.isArray(card?.cost) ? card.cost.length : 0;
  return point * 100 + reward * 10 - costSize;
}

function aiSelectBuyTarget(player){
  const candidates = [];
  player.reserved.forEach(card => {
    if (card && canAfford(player, card)) candidates.push({ source: "reserved", card });
  });
  marketCardsByLevels().forEach(({ card }) => {
    if (card && canAfford(player, card)) candidates.push({ source: "market", card });
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => aiCardScore(b.card) - aiCardScore(a.card));
  return candidates[0];
}

function aiSelectEvolveTarget(player){
  const options = [];
  for (const { card } of marketCardsByLevels()){
    if (!card) continue;
    const hasBase = player.hand.some(c => c?.evolution?.name === card.name && canAffordEvolution(player, c));
    if (hasBase) options.push({ card });
  }
  if (!options.length) return null;
  options.sort((a, b) => aiCardScore(b.card) - aiCardScore(a.card));
  return options[0];
}

function aiSelectReserveTarget(){
  const reservable = marketCardsByLevels([1,2,3]).filter(({ card }) => card);
  if (!reservable.length) return null;
  reservable.sort((a, b) => aiCardScore(b.card) - aiCardScore(a.card));
  return reservable[0];
}

function aiColorNeedScore(player, color){
  const bonus = rewardBonusesOfPlayer(player);
  return (player.tokens[color] + (bonus[color] || 0));
}

function aiPickTake3Colors(player){
  const available = BALL_KEYS
    .map((_, idx) => idx)
    .filter(idx => idx !== Ball.master_ball && state.tokenPool[idx] > 0);
  available.sort((a, b) => {
    const needDiff = aiColorNeedScore(player, a) - aiColorNeedScore(player, b);
    if (needDiff !== 0) return needDiff;
    return state.tokenPool[b] - state.tokenPool[a];
  });
  return available.slice(0, Math.min(3, available.length));
}

function aiPickTake2Color(player){
  const options = BALL_KEYS
    .map((_, idx) => idx)
    .filter(idx => idx !== Ball.master_ball && canTakeTwoSame(idx));
  if (!options.length) return null;
  options.sort((a, b) => {
    const needDiff = aiColorNeedScore(player, a) - aiColorNeedScore(player, b);
    if (needDiff !== 0) return needDiff;
    return state.tokenPool[b] - state.tokenPool[a];
  });
  return options[0];
}

function chooseAiAction(player, level){
  const availability = getActionAvailability();
  const decisions = [];

  if (availability.buy){
    const target = aiSelectBuyTarget(player);
    if (target) decisions.push({ type: "buy", target });
  }

  if (availability.evolve){
    const target = aiSelectEvolveTarget(player);
    if (target) decisions.push({ type: "evolve", target });
  }

  if (availability.reserve){
    const target = aiSelectReserveTarget();
    if (target) decisions.push({ type: "reserve", target });
  }

  if (availability.take3){
    const colors = aiPickTake3Colors(player);
    if (colors.length) decisions.push({ type: "take3", colors });
  }

  if (availability.take2){
    const color = aiPickTake2Color(player);
    if (color !== null && color !== undefined) decisions.push({ type: "take2", colors: [color] });
  }

  if (!decisions.length) return null;

  const blunder = level >= 0 ? (AI_BLUNDER_RATE[level] ?? 0) : 0;
  if (Math.random() < blunder){
    return decisions[Math.floor(Math.random() * decisions.length)];
  }

  return decisions[0];
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

// ========== 11) 事件绑定 ==========
if (el.btnNew) el.btnNew.addEventListener("click", () => {
  showModal(el.confirmNewGameModal);
});

const ensureModalOverlay = () => {
  if (el.modalOverlay) return el.modalOverlay;
  const overlay = document.createElement("div");
  overlay.id = "modalOverlay";
  overlay.className = "modal-overlay hidden";
  document.body.appendChild(overlay);
  el.modalOverlay = overlay;
  overlay.addEventListener("click", () => {
    if (ui.tokenReturn) return;
    closeModals();
  });
  return overlay;
};

if (el.btnAiInfo) el.btnAiInfo.addEventListener("click", () => {
  ensureModalOverlay();
  showModal(el.aiInfoModal);
});

if (el.btnSave) el.btnSave.addEventListener("click", saveToLocal);
if (el.btnLoad) el.btnLoad.addEventListener("click", loadFromLocal);

if (el.btnResetStorage) el.btnResetStorage.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  toast("已清空本地存档");
});

if (el.btnSaveAndNew) el.btnSaveAndNew.addEventListener("click", () => {
  saveToLocal();
  showModal(el.playerCountModal);
});

if (el.btnNewWithoutSave) el.btnNewWithoutSave.addEventListener("click", () => {
  showModal(el.playerCountModal);
});

if (el.btnCancelNew) el.btnCancelNew.addEventListener("click", closeModals);

if (el.btnVictoryConfirm) el.btnVictoryConfirm.addEventListener("click", () => {
  showModal(el.playerCountModal);
});

if (el.btnConfirmPlayerCount) el.btnConfirmPlayerCount.addEventListener("click", async () => {
  const n = Number(el.playerCount.value);
  await newGame(Number.isFinite(n) ? n : 4);
  toast("已开始新游戏");
  closeModals();
});

if (el.btnCancelPlayerCount) el.btnCancelPlayerCount.addEventListener("click", closeModals);
if (el.btnCloseHandModal) el.btnCloseHandModal.addEventListener("click", closeModals);
if (el.btnCloseCardDetailModal) el.btnCloseCardDetailModal.addEventListener("click", closeModals);
if (el.btnCloseAiInfo) el.btnCloseAiInfo.addEventListener("click", closeModals);
if (el.btnConfirmTokenReturn) el.btnConfirmTokenReturn.addEventListener("click", confirmTokenReturn);

if (el.modalOverlay) el.modalOverlay.addEventListener("click", () => {
  if (ui.tokenReturn) return;
  closeModals();
});

window.addEventListener("resize", () => {
  if (!el.handModal || el.handModal.classList.contains("hidden")) return;
  requestAnimationFrame(applyHandStackingLayout);
});

if (el.actTake3) el.actTake3.addEventListener("click", actionTake3Different);
if (el.actTake2) el.actTake2.addEventListener("click", actionTake2Same);
if (el.actReserve) el.actReserve.addEventListener("click", actionReserve);
if (el.actBuy) el.actBuy.addEventListener("click", actionBuy);
if (el.actEvolve) el.actEvolve.addEventListener("click", actionEvolve);
if (el.actEndTurn) el.actEndTurn.addEventListener("click", endTurn);

// ========== 12) 启动 ==========
(async function boot(){
  try{
    await loadCardLibrary();
    // 自动尝试读档；没有就开新局
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw){
      try{
        applySavePayload(JSON.parse(raw));
        toast("已自动读取本地存档");
        return;
      }catch{}
    }
    renderAll();
    showModal(el.playerCountModal);
  }catch(err){
    console.error("加载游戏失败", err);
    lastLoadError = err?.message || lastLoadError || "Failed to fetch";
    const hint = lastLoadError ? `资源加载失败：${lastLoadError}` : "资源加载失败：Failed to fetch";
    ui.errorMessage = hint;
    // 即使卡牌未加载成功，也尝试渲染现有 UI，方便用户看到错误提示
    renderAll();
  }
})();

// ========== 13) 工具 ==========
function clearSelections(){
  ui.selectedTokenColors.clear();
  ui.selectedMarketCardId = null;
  ui.selectedReservedCard = null;
}

function toast(msg, { type = "info" } = {}){
  console.log("[toast]", msg);
  if (type === "error"){
    return showStatusMessage(msg, { type });
  }
}

function showStatusMessage(msg, { type = "info" } = {}){
  ui.errorMessage = msg;
  renderErrorBanner();
}

function shuffle(arr){
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
