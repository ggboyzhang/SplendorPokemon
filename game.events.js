// ========== 12) 事件绑定 ==========
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

document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", event => {
    if (ui.tokenReturn) return;
    if (event.target === modal) closeModals();
  });
});

window.addEventListener("resize", () => {
  if (!el.handModal || el.handModal.classList.contains("hidden")) return;
  requestAnimationFrame(applyHandStackingLayout);
});

window.addEventListener("blur", () => {
  closeModals({ force: true });
});

if (el.actTake3) el.actTake3.addEventListener("click", actionTake3Different);
if (el.actTake2) el.actTake2.addEventListener("click", actionTake2Same);
if (el.actReserve) el.actReserve.addEventListener("click", actionReserve);
if (el.actBuy) el.actBuy.addEventListener("click", actionBuy);
if (el.actEvolve) el.actEvolve.addEventListener("click", actionEvolve);
if (el.actEndTurn) el.actEndTurn.addEventListener("click", endTurn);
