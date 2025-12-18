// ========== 14) 工具 ==========
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
  if (typeof renderErrorBanner === "function"){
    renderErrorBanner();
  }
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
