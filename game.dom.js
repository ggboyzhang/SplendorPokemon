// ========== 2) DOM ==========
const $ = (sel) => document.querySelector(sel);

const el = {
  tokenPool: $("#tokenPool"),
  market: $("#market"),
  players: $("#players"),

  sessionTimer: $("#sessionTimer"),
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

  masterBallConfirmModal: $("#masterBallConfirmModal"),
  btnConfirmMasterBallYes: $("#btnConfirmMasterBallYes"),
  btnConfirmMasterBallNo: $("#btnConfirmMasterBallNo"),

  errorBanner: $("#errorBanner"),

  actTake3: $("#actTake3"),
  actTake2: $("#actTake2"),
  actReserve: $("#actReserve"),
  actBuy: $("#actBuy"),
  actEvolve: $("#actEvolve"),
  actEndTurn: $("#actEndTurn"),
};
