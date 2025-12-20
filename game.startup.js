// ========== 13) 启动 ==========
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
