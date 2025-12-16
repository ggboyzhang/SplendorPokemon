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

  btnReplaceOne: $("#btnReplaceOne"),

  modalOverlay: $("#modalOverlay"),
  confirmNewGameModal: $("#confirmNewGameModal"),
  playerCountModal: $("#playerCountModal"),
  btnSaveAndNew: $("#btnSaveAndNew"),
  btnNewWithoutSave: $("#btnNewWithoutSave"),
  btnCancelNew: $("#btnCancelNew"),
  btnConfirmPlayerCount: $("#btnConfirmPlayerCount"),
  btnCancelPlayerCount: $("#btnCancelPlayerCount"),

  turnBadge: $("#turnBadge"),
  currentPlayerBadge: $("#currentPlayerBadge"),
  trophyBadge: $("#trophyBadge"),

  actTake3: $("#actTake3"),
  actTake2: $("#actTake2"),
  actReserve: $("#actReserve"),
  actBuy: $("#actBuy"),
  actEvolve: $("#actEvolve"),
  actEndTurn: $("#actEndTurn"),
};

// ========== 3) 游戏状态（存档核心） ==========
/**
 * 你要求存档内容：
 * - 每个玩家：hand(手牌区/桌面阵列)、reserved(保留区)、tokens(token区)、name、isStarter
 */
let state = makeEmptyState();

// UI 交互选择
let ui = {
  selectedTokenColors: new Set(), // for take actions
  selectedMarketCardId: null,     // for reserve/buy
  selectedReservedCard: null,     // {playerIndex, cardId}
};

function makeEmptyState(){
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    // 公共区（不要求存档也可以存，建议存：方便完全复现）
    tokenPool: [7,7,7,7,7,5], // 默认 4人
    market: { // 展示区（占位卡）
      slots: [], // card objects
    },
    decks: { // 占位：以后接真实 cards.json 分堆
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
    },
    endTriggered: false,
    endTriggerTurn: null,
  };
}

// ========== 4) 卡牌数据：占位生成 / 以后替换为真实 90 张 ==========
function makePlaceholderCard(id, level){
  // 成本：随机 1~3 个颜色，数量 1~4（只为可试玩）
  const colors = shuffle([0,1,2,3,4]).slice(0, randInt(1,3));
  const cost = colors.map(c => ({ ball_color: c, number: randInt(1,4) }));
  return {
    id,
    name: `占位宝可梦 #${id}`,
    src: "",
    level,
    point: Math.max(0, level-1) + (Math.random() < 0.2 ? 1 : 0),
    evolution: { name:"", cost:{ ball_color:-1, number:-1 } },
    reward: { ball_color:-1, number:-1 },
    cost
  };
}

function buildPlaceholderMarket(){
  const slots = [];
  for (let i=0;i<4;i++) slots.push(makePlaceholderCard(`L1-${i}-${Date.now()}`, 1));
  for (let i=0;i<4;i++) slots.push(makePlaceholderCard(`L2-${i}-${Date.now()}`, 2));
  for (let i=0;i<4;i++) slots.push(makePlaceholderCard(`L3-${i}-${Date.now()}`, 3));
  // 你规则里有稀有/传说，这里也给 4+4 占位
  for (let i=0;i<4;i++) slots.push(makePlaceholderCard(`R-${i}-${Date.now()}`, 4));
  for (let i=0;i<4;i++) slots.push(makePlaceholderCard(`LEG-${i}-${Date.now()}`, 5));
  return slots;
}

// ========== 5) 新游戏初始化 ==========
function newGame(playerCount){
  state = makeEmptyState();

  // token pool 按人数调整（按你规则）
  state.tokenPool = makeTokenPoolByPlayerCount(playerCount);

  // 玩家命名：玩家 + 机器人1~3
  state.players = [];
  for (let i=0;i<playerCount;i++){
    state.players.push({
      id: `P${i}`,
      name: i === 0 ? "玩家" : `机器人${i}`,
      isStarter: false,
      // 你要求：手牌区(这里当作“已捕捉展示区”)、保留区、token区
      hand: [],      // bought/captured cards on table
      reserved: [],  // reserved cards
      tokens: [0,0,0,0,0,0], // counts by color
    });
  }
  state.players[0].isStarter = true;
  state.currentPlayerIndex = 0;
  state.turn = 1;
  state.perTurn.evolved = false;

  // 展示区：占位
  state.market.slots = buildPlaceholderMarket();

  clearSelections();
  renderAll();
}

// token 数量按人数
function makeTokenPoolByPlayerCount(n){
  // 默认 4人：红/粉/蓝/黄/黑 各7，紫5
  let pool = [7,7,7,7,7,5];
  if (n === 3){
    // 移除紫以外每色各1
    pool = [6,6,6,6,6,5];
  }
  if (n === 2){
    // 移除紫以外每色各3
    pool = [4,4,4,4,4,5];
  }
  return pool;
}

// ========== 6) 规则工具 ==========
function currentPlayer(){ return state.players[state.currentPlayerIndex]; }

function totalTokensOfPlayer(p){
  return p.tokens.reduce((a,b)=>a+b,0);
}

function totalTrophiesOfPlayer(p){
  return p.hand.reduce((sum, c)=>sum + (c.point > 0 ? c.point : 0), 0);
}

function canTakeTwoSame(color){
  return state.tokenPool[color] >= 4;
}

function clampTokenLimit(p){
  // 超过 10 必须弃到 10（这里给一个最简单策略：从最多的颜色开始丢）
  let total = totalTokensOfPlayer(p);
  if (total <= 10) return;

  while (total > 10){
    let idx = 0;
    for (let i=1;i<6;i++){
      if (p.tokens[i] > p.tokens[idx]) idx = i;
    }
    if (p.tokens[idx] <= 0) break;
    p.tokens[idx] -= 1;
    state.tokenPool[idx] += 1;
    total -= 1;
  }
}

function canAfford(p, card){
  // 紫色大师球可当万能：支付时先用对应色，不够再用紫
  const need = [0,0,0,0,0,0];
  for (const item of card.cost){
    if (item.ball_color >= 0 && item.ball_color <= 5){
      need[item.ball_color] += item.number;
    }
  }
  // 先扣非紫
  let purpleNeeded = 0;
  for (let c=0;c<5;c++){
    const shortage = Math.max(0, need[c] - p.tokens[c]);
    purpleNeeded += shortage;
  }
  // 还要考虑 cost 里如果直接写了紫（不常见，但按结构支持）
  const directPurple = need[5];
  purpleNeeded += directPurple;

  return p.tokens[5] >= purpleNeeded;
}

function payCost(p, card){
  // 按 canAfford 假设可支付
  for (const item of card.cost){
    const c = item.ball_color;
    const n = item.number;
    if (c < 0 || c > 5) continue;
    if (c === 5){
      // 直接紫
      p.tokens[5] -= n;
      state.tokenPool[5] += n;
    } else {
      const use = Math.min(p.tokens[c], n);
      p.tokens[c] -= use;
      state.tokenPool[c] += use;

      const shortage = n - use;
      if (shortage > 0){
        // 用紫补
        p.tokens[5] -= shortage;
        state.tokenPool[5] += shortage;
      }
    }
  }
}

// ========== 7) 行动实现 ==========
function actionTake3Different(){
  const p = currentPlayer();
  const colors = [...ui.selectedTokenColors];
  if (colors.length === 0) return toast("先点击公共 token 选择颜色");
  if (colors.length > 3) return toast("最多选 3 种不同颜色");

  // 实际可拿：供应区有的才拿
  let took = 0;
  for (const c of colors){
    if (state.tokenPool[c] <= 0) continue;
    state.tokenPool[c] -= 1;
    p.tokens[c] += 1;
    took += 1;
  }
  if (took === 0) return toast("这些颜色供应区都没了");

  clampTokenLimit(p);
  clearSelections();
  renderAll();
  toast(`拿取 ${took} 个不同颜色 token`);
}

function actionTake2Same(){
  const p = currentPlayer();
  const colors = [...ui.selectedTokenColors];
  if (colors.length !== 1) return toast("行动2 只能选择 1 种颜色");
  const c = colors[0];
  if (!canTakeTwoSame(c)) return toast("该颜色供应区不足 4 个，不能拿 2 个同色");

  state.tokenPool[c] -= 2;
  p.tokens[c] += 2;

  clampTokenLimit(p);
  clearSelections();
  renderAll();
  toast("拿取 2 个同色 token");
}

function actionReserve(){
  const p = currentPlayer();
  if (!ui.selectedMarketCardId) return toast("先点击展示区选择要保留的卡");
  if (p.reserved.length >= 3) return toast("保留区最多 3 张");

  const idx = state.market.slots.findIndex(c => c.id === ui.selectedMarketCardId);
  if (idx < 0) return toast("选择的卡不在展示区");

  const card = state.market.slots[idx];
  p.reserved.push(card);

  // 补牌（占位：重新生成同等级一张）
  state.market.slots[idx] = makePlaceholderCard(`${card.level}-${Math.random().toString(16).slice(2)}-${Date.now()}`, card.level);

  // 拿 1 个大师球（紫）
  if (state.tokenPool[Ball.master_ball] > 0){
    state.tokenPool[Ball.master_ball] -= 1;
    p.tokens[Ball.master_ball] += 1;
  }

  clampTokenLimit(p);
  clearSelections();
  renderAll();
  toast("已保留 1 张，并尝试获得 1 个大师球");
}

function actionBuy(){
  const p = currentPlayer();

  // 优先：买保留牌
  if (ui.selectedReservedCard){
    const { playerIndex, cardId } = ui.selectedReservedCard;
    if (playerIndex !== state.currentPlayerIndex) return toast("只能购买自己保留区的卡");
    const rIdx = p.reserved.findIndex(c => c.id === cardId);
    if (rIdx < 0) return toast("该卡不在你的保留区");

    const card = p.reserved[rIdx];
    if (!canAfford(p, card)) return toast("token 不够，无法购买该卡");

    payCost(p, card);
    p.reserved.splice(rIdx, 1);
    p.hand.push(card);

    clearSelections();
    renderAll();
    toast("已购买保留区卡牌");
    checkEndTrigger();
    return;
  }

  // 购买展示区卡
  if (!ui.selectedMarketCardId) return toast("先点击展示区选择要购买的卡");
  const idx = state.market.slots.findIndex(c => c.id === ui.selectedMarketCardId);
  if (idx < 0) return toast("选择的卡不在展示区");

  const card = state.market.slots[idx];
  if (!canAfford(p, card)) return toast("token 不够，无法购买该卡");

  payCost(p, card);
  p.hand.push(card);

  // 补牌（占位）
  state.market.slots[idx] = makePlaceholderCard(`${card.level}-${Math.random().toString(16).slice(2)}-${Date.now()}`, card.level);

  clearSelections();
  renderAll();
  toast("已购买展示区卡牌");
  checkEndTrigger();
}

function actionEvolvePlaceholder(){
  // 你有“进化 A/B”和“不能跳级、每回合一次”的规则；
  // 真正实现需要：卡牌里 evolution.name + 进化链数据/映射。
  if (state.perTurn.evolved) return toast("本回合已进化过一次");
  state.perTurn.evolved = true;
  renderAll();
  toast("进化（占位）已标记：本回合不能再进化");
}

function actionReplaceOnePlaceholder(){
  // 规则：弃掉展示区 1 张并补 1 张（作为回合完整行动）
  if (!ui.selectedMarketCardId) return toast("先点击展示区选择要替换的卡");
  const idx = state.market.slots.findIndex(c => c.id === ui.selectedMarketCardId);
  if (idx < 0) return toast("选择的卡不在展示区");

  const old = state.market.slots[idx];
  state.market.slots[idx] = makePlaceholderCard(`${old.level}-${Math.random().toString(16).slice(2)}-${Date.now()}`, old.level);

  clearSelections();
  renderAll();
  toast("已替换展示区 1 张卡（占位）");
}

function endTurn(){
  // 每回合结束：检查 token 上限已在拿/保留时处理，这里再兜底
  clampTokenLimit(currentPlayer());

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
  state.perTurn.evolved = false;

  clearSelections();
  renderAll();
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

// ========== 9) 存档 / 读档 ==========
function saveToLocal(){
  const payload = makeSavePayload();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  toast("已存档到本地 localStorage");
}

function loadFromLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return toast("没有找到本地存档");
  try{
    const parsed = JSON.parse(raw);
    applySavePayload(parsed);
    toast("已从本地读档");
  }catch{
    toast("读档失败：存档内容损坏");
  }
}

function makeSavePayload(){
  // 你要求存：每个玩家的 hand/reserved/tokens/name/isStarter
  // 我额外把公共区/回合也存了，让你“完整复现”
  return {
    version: state.version,
    createdAt: state.createdAt,
    turn: state.turn,
    currentPlayerIndex: state.currentPlayerIndex,
    endTriggered: state.endTriggered,
    endTriggerTurn: state.endTriggerTurn,
    perTurn: state.perTurn,

    tokenPool: state.tokenPool,
    market: state.market,

    players: state.players.map(p => ({
      name: p.name,
      isStarter: p.isStarter,
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
  state.perTurn = payload.perTurn ?? { evolved:false };

  state.tokenPool = payload.tokenPool ?? [7,7,7,7,7,5];
  state.market = payload.market ?? { slots: [] };

  // 玩家（必须包含你要的字段）
  state.players = payload.players.map((p, i) => ({
    id: `P${i}`,
    name: typeof p.name === "string" ? p.name : (i===0 ? "玩家" : `机器人${i}`),
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

function exportSave(){
  const payload = makeSavePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pokemon-splendor-save.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("已导出存档 JSON");
}

function importSaveFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(String(reader.result));
      applySavePayload(parsed);
      toast("导入存档成功");
    }catch{
      toast("导入失败：不是有效的 JSON 存档");
    }
  };
  reader.readAsText(file);
}

// ========== 10) 渲染 ==========
function renderAll(){
  renderTokenPool();
  renderMarket();
  renderPlayers();
  renderBadges();
}

function renderBadges(){
  if (!el.turnBadge || !el.currentPlayerBadge || !el.trophyBadge) return;
  el.turnBadge.textContent = `回合：${state.turn}`;
  el.currentPlayerBadge.textContent = `当前玩家：${currentPlayer().name}`;
  el.trophyBadge.textContent = `当前玩家奖杯：${totalTrophiesOfPlayer(currentPlayer())}`;
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
  for (const card of state.market.slots){
    const div = document.createElement("div");
    div.className = "card" + (ui.selectedMarketCardId === card.id ? " selected" : "");
    div.dataset.cardId = card.id;

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = card.name || "(未命名)";
    div.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span>Lv ${card.level}</span>
      <span>奖杯 ${card.point}</span>
      <span>ID ${String(card.id).slice(0,10)}…</span>
    `;
    div.appendChild(meta);

    const cost = document.createElement("div");
    cost.className = "cost";
    if (Array.isArray(card.cost)){
      for (const it of card.cost){
        const pip = document.createElement("span");
        pip.className = "pip";
        pip.textContent = `${BALL_NAMES[it.ball_color] ?? "?"} ×${it.number}`;
        cost.appendChild(pip);
      }
    }
    div.appendChild(cost);

    div.addEventListener("click", () => {
      ui.selectedReservedCard = null;
      ui.selectedMarketCardId = (ui.selectedMarketCardId === card.id) ? null : card.id;
      renderMarket();
      renderPlayers(); // 让玩家保留区取消高亮
    });

    el.market.appendChild(div);
  }
}

function renderPlayers(){
  if (!el.players) return;
  el.players.innerHTML = "";
  state.players.forEach((p, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "player";

    const head = document.createElement("div");
    head.className = "player-head";

    const name = document.createElement("div");
    name.className = "player-name";
    name.innerHTML = `
      ${p.isStarter ? `<span class="starter" title="起始玩家">★</span>` : ""}
      <span>${escapeHtml(p.name)}</span>
      ${idx === state.currentPlayerIndex ? `<span class="pip">当前</span>` : ""}
      <span class="pip">奖杯 ${totalTrophiesOfPlayer(p)}</span>
      <span class="pip">token ${totalTokensOfPlayer(p)}/10</span>
    `;
    head.appendChild(name);

    wrap.appendChild(head);

    const zones = document.createElement("div");
    zones.className = "zonegrid";

    zones.appendChild(renderZone("手牌区（已捕捉展示区）", p.hand, { clickable:false }));
    zones.appendChild(renderZone("保留区（点击可购买）", p.reserved, { clickable:true, playerIndex: idx }));
    zones.appendChild(renderTokenZone(p.tokens));

    wrap.appendChild(zones);
    el.players.appendChild(wrap);
  });
}

function renderZone(title, cards, opts){
  const zone = document.createElement("div");
  zone.className = "zone";

  const zt = document.createElement("div");
  zt.className = "zone-title";
  zt.innerHTML = `<span>${title}</span><span class="pip">数量 ${cards.length}</span>`;
  zone.appendChild(zt);

  const items = document.createElement("div");
  items.className = "zone-items";

  for (const card of cards){
    const m = document.createElement("div");
    m.className = "mini";
    const selected = ui.selectedReservedCard &&
      ui.selectedReservedCard.cardId === card.id &&
      ui.selectedReservedCard.playerIndex === opts.playerIndex;
    if (selected) m.style.boxShadow = "0 0 0 2px rgba(245,158,11,0.65)";

    m.innerHTML = `
      <div class="t">${escapeHtml(card.name || "(未命名)")}</div>
      <div class="s">Lv ${card.level} · 奖杯 ${card.point}</div>
    `;

    if (opts.clickable){
      m.addEventListener("click", () => {
        // 只允许点击当前玩家自己的保留区来买
        ui.selectedMarketCardId = null;
        const same = ui.selectedReservedCard &&
          ui.selectedReservedCard.cardId === card.id &&
          ui.selectedReservedCard.playerIndex === opts.playerIndex;

        ui.selectedReservedCard = same ? null : { playerIndex: opts.playerIndex, cardId: card.id };
        renderPlayers();
        renderMarket();
      });
    }

    items.appendChild(m);
  }

  zone.appendChild(items);
  return zone;
}

function renderTokenZone(tokens){
  const zone = document.createElement("div");
  zone.className = "zone";

  const total = tokens.reduce((a,b)=>a+b,0);
  const zt = document.createElement("div");
  zt.className = "zone-title";
  zt.innerHTML = `<span>token 区</span><span class="pip">${total}/10</span>`;
  zone.appendChild(zt);

  const items = document.createElement("div");
  items.className = "zone-items";

  for (let c=0;c<BALL_NAMES.length;c++){
    const t = document.createElement("div");
    t.className = "mini";
    t.innerHTML = `
      <div class="t">${BALL_NAMES[c]}</div>
      <div class="s">× ${tokens[c]}</div>
    `;
    items.appendChild(t);
  }
  zone.appendChild(items);
  return zone;
}

function showModal(modal){
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  if (!modal) return;
  el.modalOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  modal.classList.remove("hidden");
}

function closeModals(){
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  el.modalOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

// ========== 11) 事件绑定 ==========
if (el.btnNew) el.btnNew.addEventListener("click", () => {
  showModal(el.confirmNewGameModal);
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

if (el.btnConfirmPlayerCount) el.btnConfirmPlayerCount.addEventListener("click", () => {
  const n = Number(el.playerCount.value);
  newGame(Number.isFinite(n) ? n : 4);
  toast("已开始新游戏");
  closeModals();
});

if (el.btnCancelPlayerCount) el.btnCancelPlayerCount.addEventListener("click", closeModals);

if (el.modalOverlay) el.modalOverlay.addEventListener("click", closeModals);

if (el.btnReplaceOne) el.btnReplaceOne.addEventListener("click", actionReplaceOnePlaceholder);

if (el.actTake3) el.actTake3.addEventListener("click", actionTake3Different);
if (el.actTake2) el.actTake2.addEventListener("click", actionTake2Same);
if (el.actReserve) el.actReserve.addEventListener("click", actionReserve);
if (el.actBuy) el.actBuy.addEventListener("click", actionBuy);
if (el.actEvolve) el.actEvolve.addEventListener("click", actionEvolvePlaceholder);
if (el.actEndTurn) el.actEndTurn.addEventListener("click", endTurn);

// ========== 12) 启动 ==========
(function boot(){
  // 自动尝试读档；没有就开新局
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw){
    try{
      applySavePayload(JSON.parse(raw));
      toast("已自动读取本地存档");
      return;
    }catch{}
  }
  newGame(Number(el.playerCount.value));
  toast("已创建默认新游戏");
})();

// ========== 13) 工具 ==========
function clearSelections(){
  ui.selectedTokenColors.clear();
  ui.selectedMarketCardId = null;
  ui.selectedReservedCard = null;
}

function toast(msg){
  // 简易 toast：用 badge 闪一下
  console.log("[toast]", msg);
  el.currentPlayerBadge.textContent = msg;

  el.currentPlayerBadge.style.borderColor = "rgba(34,197,94,0.45)";
  el.currentPlayerBadge.style.background = "rgba(34,197,94,0.12)";
  setTimeout(() => {
    el.currentPlayerBadge.style.borderColor = "";
    el.currentPlayerBadge.style.background = "";
    renderBadges();
  }, 900);
}

function randInt(a,b){
  return Math.floor(Math.random()*(b-a+1))+a;
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
