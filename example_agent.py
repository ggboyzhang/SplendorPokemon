import json
from pathlib import Path
from typing import List

from headless_core import GameEnv


def load_cards(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def total_cost(encoded_card: List[float]) -> float:
    # encoded format: level, point, 6 cost, 6 reward
    return sum(encoded_card[2:8])


def choose_action(env: GameEnv, player_index: int) -> dict:
    observation = env.observe(player_index)
    legal = env.legal_actions()

    # Prefer the cheapest affordable market buy; fallback to skip/end as needed.
    candidates = [a for a in legal if a["type"] in {"buy_market", "buy_reserved"}]
    reserved_actions = [a for a in candidates if a["type"] == "buy_reserved"]
    reserved_map = {
        action.get("card_id"): vec for action, vec in zip(reserved_actions, observation["reserved"])
    }
    if candidates:
        def card_vector(action: dict) -> List[float]:
            if action["type"] == "buy_market":
                level = action["level"]
                idx = action["index"]
                level_key = {1: "level_1", 2: "level_2", 3: "level_3", 4: "rare", 5: "legend"}[level]
                return observation["market"][level_key][idx]
            # reserved actions match order of observation
            return reserved_map.get(action.get("card_id"), [0.0] * 14)

        candidates.sort(key=lambda a: (total_cost(card_vector(a)), -card_vector(a)[1]))
        return candidates[0]

    if any(a["type"] == "end_turn" for a in legal):
        return next(a for a in legal if a["type"] == "end_turn")
    return legal[0] if legal else {}


def run_episode(seed: int = 123) -> None:
    cards = load_cards(Path(__file__).parent / "cards.json")
    env = GameEnv(cards, num_players=2)
    env.reset(seed=seed)

    step_count = 0
    while not env.done and step_count < 200:
        current_idx = env.observe(0)["current_player"]
        action = choose_action(env, current_idx)
        env.step(action)
        step_count += 1

    print("Episode finished in", step_count, "steps")
    for idx in range(env.num_players):
        obs = env.observe(idx)
        print(f"Player {idx} trophies: {obs['player']['trophies']}")


if __name__ == "__main__":
    run_episode()
