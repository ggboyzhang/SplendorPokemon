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
    trophies: totalTrophiesOfPlayer(p),
    penalty: penaltyHandCount(p),
    trophyCards: trophyCardCount(p),
  })).sort((a, b) => {
    if (b.trophies !== a.trophies) return b.trophies - a.trophies;
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
      <div>奖杯数：${winner.trophies}</div>
      <div>倒扣手牌数：${winner.penalty}</div>
      <div>正面朝上卡牌数：${winner.trophyCards}</div>
    `;
  }

  if (el.victoryModal){
    showModal(el.victoryModal);
  }else{
    toast(`终局结算：${winner.player.name} 获胜！（奖杯数：${winner.trophies}）`);
  }
}
