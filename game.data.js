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

