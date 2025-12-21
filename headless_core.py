"""
Headless Splendor Pokemon game core for AI self-play and training.

This module implements a deterministic, gym-like environment that mirrors the
browser game's rules while removing all UI / async behavior. The environment
supports large-scale simulations with controlled randomness.
"""

from __future__ import annotations

import copy
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# ---------- Data models ----------


@dataclass
class PlayerState:
    id: str
    name: str
    hand: List[dict] = field(default_factory=list)
    reserved: List[dict] = field(default_factory=list)
    tokens: List[int] = field(default_factory=lambda: [0, 0, 0, 0, 0, 0])
    is_starter: bool = False


@dataclass
class GameState:
    turn: int
    current_player_index: int
    players: List[PlayerState]
    token_pool: List[int]
    market: Dict[int, List[Optional[dict]]]
    decks: Dict[str, List[dict]]
    per_turn: Dict[str, Optional[str]]
    end_triggered: bool
    end_trigger_turn: Optional[int]
    victory_resolved: bool


# ---------- Helpers ----------


BALL_MASTER = 5


def encode_card(card: Optional[dict]) -> List[float]:
    """
    Convert a card definition into a fixed-length numeric vector.

    The vector packs level, point, cost by color, and reward by color
    without exposing any identifier or textual fields. Empty or missing
    cards return an all-zero vector of the same length.
    """

    vector = [0.0] * 14  # level, point, 6-cost, 6-reward
    if not card:
        return vector

    level = card.get("level") or 0
    point = card.get("point") or 0

    cost_vec = [0.0] * 6
    for item in card.get("cost", []) or []:
        color = item.get("ball_color")
        number = item.get("number") or 0
        if isinstance(color, int) and 0 <= color < len(cost_vec):
            cost_vec[color] += number

    reward_vec = [0.0] * 6
    reward = card.get("reward")
    reward_items = reward if isinstance(reward, list) else ([reward] if reward else [])
    for item in reward_items or []:
        color = item.get("ball_color")
        number = item.get("number") or 0
        if isinstance(color, int) and 0 <= color < len(reward_vec):
            reward_vec[color] += number

    vector[0] = float(level)
    vector[1] = float(point)
    vector[2:8] = cost_vec
    vector[8:14] = reward_vec
    return vector


def _get_stacked_cards(card: dict) -> List[dict]:
    return card.get("underCards") or card.get("stackedCards") or card.get("consumedCards") or []


def _clean_stack_data(card: dict) -> dict:
    cleaned = dict(card)
    cleaned.pop("stackedCards", None)
    cleaned.pop("underCards", None)
    cleaned.pop("consumedCards", None)
    return cleaned


def _flatten_hand(player: PlayerState, include_stacked: bool = False) -> List[dict]:
    collected: List[dict] = []

    def collect(card: Optional[dict]) -> None:
        if not card:
            return
        collected.append(card)
        if include_stacked:
            for under in _get_stacked_cards(card):
                collect(under)

    for card in player.hand:
        collect(card)
    return collected


def _reward_bonuses(player: PlayerState) -> List[int]:
    bonus = [0, 0, 0, 0, 0, 0]
    for card in player.hand:
        if not card:
            continue
        reward = card.get("reward")
        if not reward:
            continue
        color = reward.get("ball_color")
        number = reward.get("number") or 0
        if isinstance(color, int) and 0 <= color < len(bonus):
            bonus[color] += number
    return bonus


def _total_tokens(player: PlayerState) -> int:
    return sum(player.tokens)


def _total_trophies(player: PlayerState) -> int:
    return sum(card.get("point", 0) for card in _flatten_hand(player))


def _penalty_hand_count(player: PlayerState) -> int:
    return max(0, len(_flatten_hand(player, True)) - len(_flatten_hand(player, False)))


def _trophy_card_count(player: PlayerState) -> int:
    return len(_flatten_hand(player, False))


def _normalize_card(raw: dict, default_level: int, idx: int) -> dict:
    card = copy.deepcopy(raw)
    card.setdefault("level", default_level)
    card.setdefault("id", card.get("md5") or card.get("id") or f"{default_level}-{idx}")
    return card


def _level_key(level: int) -> str:
    if level == 1:
        return "lv1"
    if level == 2:
        return "lv2"
    if level == 3:
        return "lv3"
    if level == 4:
        return "rare"
    return "legend"


# ---------- Core environment ----------


class GameEnv:
    """
    Headless environment matching the JS ruleset.

    Usage:
        env = GameEnv(cards_by_level, num_players=4)
        state = env.reset(seed=123)
        actions = env.legal_actions()
        next_state, reward, done, info = env.step(actions[0])
    """

    def __init__(self, cards_by_level: dict, num_players: int) -> None:
        self.cards_by_level = copy.deepcopy(cards_by_level)
        self.num_players = num_players
        self.rng = random.Random()
        self.state: Optional[GameState] = None
        self.done: bool = False
        self._last_ranking: Optional[List[dict]] = None

    # ----- Public API -----

    def reset(self, seed: Optional[int] = None) -> GameState:
        if seed is not None:
            self.rng.seed(seed)
        self.done = False
        self._last_ranking = None
        self.state = self._make_initial_state()
        return copy.deepcopy(self.state)

    def observe(self, player_index: int) -> dict:
        """
        Provide a numeric-only observation for a given player.
        """
        if not self.state:
            raise ValueError("Call reset() before observe().")
        if player_index < 0 or player_index >= len(self.state.players):
            raise ValueError("Invalid player index.")

        player = self.state.players[player_index]
        reward_bonus = _reward_bonuses(player)

        def encode_slots(level: int) -> List[List[float]]:
            slots = self.state.market["slots_by_level"].get(level, [])
            return [encode_card(card) for card in slots]

        observation = {
            "turn": self.state.turn,
            "current_player": self.state.current_player_index,
            "player_index": player_index,
            "player": {
                "tokens": list(player.tokens),
                "reward_bonus": reward_bonus,
                "trophies": _total_trophies(player),
                "hand_size": len(_flatten_hand(player, False)),
            },
            "market": {
                "level_1": encode_slots(1),
                "level_2": encode_slots(2),
                "level_3": encode_slots(3),
                "rare": encode_slots(4),
                "legend": encode_slots(5),
            },
            "reserved": [encode_card(card) for card in player.reserved],
        }
        return copy.deepcopy(observation)

    def legal_actions(self) -> List[dict]:
        if not self.state or self.done:
            return []

        state = self.state
        player = state.players[state.current_player_index]
        actions: List[dict] = []

        over_limit = _total_tokens(player) > 10
        primary_locked = bool(state.per_turn.get("primary_action"))

        if over_limit:
            for color, count in enumerate(player.tokens):
                if count > 0:
                    actions.append({"type": "return_tokens", "color": color, "count": 1})

        if not primary_locked:
            actions.extend(self._legal_take_actions())
            actions.extend(self._legal_reserve_actions(player))
            actions.extend(self._legal_buy_actions(player))
            actions.append({"type": "skip_primary"})

        if not state.per_turn.get("evolved"):
            actions.extend(self._legal_evolution_actions(player))

        if state.per_turn.get("primary_action") and not over_limit:
            actions.append({"type": "end_turn"})

        return actions

    def step(self, action: Optional[dict]) -> Tuple[GameState, List[int], bool, dict]:
        """
        Execute a single action (one atomic move, not a full turn).
        Illegal actions are mapped to a safe no-op.
        """
        info: Dict[str, object] = {}
        if not self.state:
            raise ValueError("Call reset() before step().")
        if self.done:
            return copy.deepcopy(self.state), self._current_reward(), True, info

        applied = self._apply_action(action or {}, info)
        info["applied"] = bool(applied)

        if self.state.victory_resolved:
            self.done = True
            if self._last_ranking is not None:
                info["ranking"] = copy.deepcopy(self._last_ranking)

        reward = self._current_reward()
        return copy.deepcopy(self.state), reward, self.done, info

    # ----- Internal: action applications -----

    def _apply_action(self, action: dict, info: dict) -> bool:
        action_type = action.get("type")
        handlers = {
            "take3": self._action_take3,
            "take2": self._action_take2,
            "reserve_market": self._action_reserve_market,
            "reserve_master": self._action_reserve_master_only,
            "buy_market": self._action_buy_market,
            "buy_reserved": self._action_buy_reserved,
            "evolve_market": self._action_evolve_market,
            "evolve_reserved": self._action_evolve_reserved,
            "return_tokens": self._action_return_tokens,
            "end_turn": self._action_end_turn,
            "skip_primary": self._action_skip_primary,
        }
        handler = handlers.get(action_type)
        if not handler:
            info["invalid_action"] = True
            return False
        return handler(action, info)

    def _require_state(self) -> GameState:
        if not self.state:
            raise ValueError("State is not initialized.")
        return self.state

    def _action_take3(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("primary_action"):
            info["reason"] = "primary_locked"
            return False

        colors = tuple(action.get("colors") or ())
        player = state.players[state.current_player_index]
        available_colors = [
            idx for idx in range(5) if state.token_pool[idx] > 0
        ]

        if not colors or any(c == BALL_MASTER for c in colors):
            info["invalid_action"] = True
            return False

        if len(set(colors)) != len(colors):
            info["invalid_action"] = True
            return False

        if len(available_colors) >= 3 and len(colors) != 3:
            info["invalid_action"] = True
            return False
        if len(available_colors) < 3 and len(colors) != len(available_colors):
            info["invalid_action"] = True
            return False

        if any(state.token_pool[c] <= 0 for c in colors):
            info["invalid_action"] = True
            return False

        for c in colors:
            state.token_pool[c] -= 1
            player.tokens[c] += 1

        state.per_turn["primary_action"] = "take3"
        return True

    def _action_take2(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("primary_action"):
            info["reason"] = "primary_locked"
            return False

        color = action.get("color")
        if color in (None, BALL_MASTER):
            info["invalid_action"] = True
            return False

        if not self._can_take_two_same(color):
            info["invalid_action"] = True
            return False

        player = state.players[state.current_player_index]
        state.token_pool[color] -= 2
        player.tokens[color] += 2
        state.per_turn["primary_action"] = "take2"
        return True

    def _action_reserve_market(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("primary_action"):
            info["reason"] = "primary_locked"
            return False

        level = action.get("level")
        idx = action.get("index")
        if level is None or idx is None or level >= 4:
            info["invalid_action"] = True
            return False

        player = state.players[state.current_player_index]
        slots = state.market["slots_by_level"].get(level, [])
        if idx < 0 or idx >= len(slots):
            info["invalid_action"] = True
            return False
        card = slots[idx]
        if not card:
            info["invalid_action"] = True
            return False

        if len(player.reserved) >= 3:
            return self._action_reserve_master_only(action, info)

        slots[idx] = None
        player.reserved.append(card)
        self._draw_into_slot(level, idx)

        if state.token_pool[BALL_MASTER] > 0:
            state.token_pool[BALL_MASTER] -= 1
            player.tokens[BALL_MASTER] += 1

        state.per_turn["primary_action"] = "reserve"
        return True

    def _action_reserve_master_only(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("primary_action"):
            info["reason"] = "primary_locked"
            return False

        player = state.players[state.current_player_index]
        if len(player.reserved) < 3:
            info["invalid_action"] = True
            return False

        if state.token_pool[BALL_MASTER] <= 0:
            info["invalid_action"] = True
            return False

        state.token_pool[BALL_MASTER] -= 1
        player.tokens[BALL_MASTER] += 1
        state.per_turn["primary_action"] = "reserve"
        return True

    def _action_buy_market(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("primary_action"):
            info["reason"] = "primary_locked"
            return False

        level = action.get("level")
        idx = action.get("index")
        if level is None or idx is None:
            info["invalid_action"] = True
            return False

        slots = state.market["slots_by_level"].get(level, [])
        if idx < 0 or idx >= len(slots):
            info["invalid_action"] = True
            return False
        card = slots[idx]
        if not card:
            info["invalid_action"] = True
            return False

        player = state.players[state.current_player_index]
        if not self._can_afford(player, card):
            info["invalid_action"] = True
            return False

        self._pay_cost(player, card)
        player.hand.append(card)
        slots[idx] = None
        self._draw_into_slot(level, idx)

        state.per_turn["primary_action"] = "buy"
        self._check_end_trigger()
        return True

    def _action_buy_reserved(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("primary_action"):
            info["reason"] = "primary_locked"
            return False

        card_id = action.get("card_id")
        player = state.players[state.current_player_index]
        idx = next((i for i, c in enumerate(player.reserved) if c and c.get("id") == card_id), -1)
        if idx < 0:
            info["invalid_action"] = True
            return False
        card = player.reserved[idx]
        if not self._can_afford(player, card):
            info["invalid_action"] = True
            return False

        self._pay_cost(player, card)
        player.reserved.pop(idx)
        player.hand.append(card)
        state.per_turn["primary_action"] = "buy"
        self._check_end_trigger()
        return True

    def _action_evolve_market(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("evolved"):
            info["reason"] = "evolve_locked"
            return False

        level = action.get("level")
        idx = action.get("index")
        if level is None or idx is None:
            info["invalid_action"] = True
            return False

        slots = state.market["slots_by_level"].get(level, [])
        if idx < 0 or idx >= len(slots):
            info["invalid_action"] = True
            return False
        card = slots[idx]
        if not card:
            info["invalid_action"] = True
            return False

        player = state.players[state.current_player_index]
        base_card = self._first_affordable_base(player, card)
        if not base_card:
            info["invalid_action"] = True
            return False

        self._pay_evolution_cost(player, base_card)
        slots[idx] = None
        self._replace_with_evolution(player, base_card, card)
        self._draw_into_slot(level, idx)
        state.per_turn["evolved"] = True
        return True

    def _action_evolve_reserved(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("evolved"):
            info["reason"] = "evolve_locked"
            return False

        card_id = action.get("card_id")
        player = state.players[state.current_player_index]
        idx = next((i for i, c in enumerate(player.reserved) if c and c.get("id") == card_id), -1)
        if idx < 0:
            info["invalid_action"] = True
            return False
        card = player.reserved[idx]
        base_card = self._first_affordable_base(player, card)
        if not base_card:
            info["invalid_action"] = True
            return False

        self._pay_evolution_cost(player, base_card)
        player.reserved.pop(idx)
        self._replace_with_evolution(player, base_card, card)
        state.per_turn["evolved"] = True
        return True

    def _action_return_tokens(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        color = action.get("color")
        count = action.get("count", 0)
        player = state.players[state.current_player_index]
        if color is None or count <= 0 or color < 0 or color >= len(player.tokens):
            info["invalid_action"] = True
            return False
        if player.tokens[color] < count:
            info["invalid_action"] = True
            return False
        player.tokens[color] -= count
        state.token_pool[color] += count
        return True

    def _action_end_turn(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if not state.victory_resolved and not state.per_turn.get("primary_action"):
            info["invalid_action"] = True
            return False

        player = state.players[state.current_player_index]
        if _total_tokens(player) > 10:
            info["invalid_action"] = True
            return False

        self._check_end_trigger()
        is_last_player = state.current_player_index == len(state.players) - 1
        if self._should_resolve_victory(is_last_player):
            self._resolve_victory()
            return True

        if state.victory_resolved:
            return True

        state.current_player_index = (state.current_player_index + 1) % len(state.players)
        if state.current_player_index == 0:
            state.turn += 1
        state.per_turn = {"evolved": False, "primary_action": None}
        return True

    def _action_skip_primary(self, action: dict, info: dict) -> bool:
        state = self._require_state()
        if state.per_turn.get("primary_action"):
            info["reason"] = "primary_locked"
            return False
        state.per_turn["primary_action"] = "skip"
        return True

    # ----- Internal: legality builders -----

    def _legal_take_actions(self) -> List[dict]:
        state = self._require_state()
        actions: List[dict] = []

        available_colors = [c for c in range(5) if state.token_pool[c] > 0]
        if len(available_colors) >= 3:
            for i in range(len(available_colors)):
                for j in range(i + 1, len(available_colors)):
                    for k in range(j + 1, len(available_colors)):
                        actions.append({"type": "take3", "colors": (available_colors[i], available_colors[j], available_colors[k])})
        elif available_colors:
            actions.append({"type": "take3", "colors": tuple(available_colors)})

        for color in range(5):
            if self._can_take_two_same(color):
                actions.append({"type": "take2", "color": color})

        return actions

    def _legal_reserve_actions(self, player: PlayerState) -> List[dict]:
        state = self._require_state()
        actions: List[dict] = []
        if len(player.reserved) >= 3:
            if state.token_pool[BALL_MASTER] > 0:
                actions.append({"type": "reserve_master"})
            return actions

        for level in (1, 2, 3):
            slots = state.market["slots_by_level"].get(level, [])
            for idx, card in enumerate(slots):
                if card:
                    actions.append({"type": "reserve_market", "level": level, "index": idx, "card_id": card.get("id")})
        return actions

    def _legal_buy_actions(self, player: PlayerState) -> List[dict]:
        state = self._require_state()
        actions: List[dict] = []

        for level in (1, 2, 3, 4, 5):
            slots = state.market["slots_by_level"].get(level, [])
            for idx, card in enumerate(slots):
                if card and self._can_afford(player, card):
                    actions.append({"type": "buy_market", "level": level, "index": idx, "card_id": card.get("id")})

        for card in player.reserved:
            if card and self._can_afford(player, card):
                actions.append({"type": "buy_reserved", "card_id": card.get("id")})

        return actions

    def _legal_evolution_actions(self, player: PlayerState) -> List[dict]:
        state = self._require_state()
        actions: List[dict] = []

        for level in (1, 2, 3, 4, 5):
            slots = state.market["slots_by_level"].get(level, [])
            for idx, card in enumerate(slots):
                if card and self._first_affordable_base(player, card):
                    actions.append({"type": "evolve_market", "level": level, "index": idx, "card_id": card.get("id")})

        for card in player.reserved:
            if card and self._first_affordable_base(player, card):
                actions.append({"type": "evolve_reserved", "card_id": card.get("id")})

        return actions

    # ----- Internal: cost resolution -----

    def _can_take_two_same(self, color: int) -> bool:
        state = self._require_state()
        return state.token_pool[color] >= 4

    def _can_afford(self, player: PlayerState, card: dict) -> bool:
        need = [0, 0, 0, 0, 0, 0]
        for item in card.get("cost", []):
            color = item.get("ball_color")
            number = item.get("number") or 0
            if isinstance(color, int) and 0 <= color < len(need):
                need[color] += number

        bonus = _reward_bonuses(player)
        tokens = list(player.tokens)
        purple_pool = tokens[BALL_MASTER] + bonus[BALL_MASTER]

        for c in range(5):
            required = need[c]
            use_bonus = min(bonus[c], required)
            required -= use_bonus

            use_token = min(tokens[c], required)
            tokens[c] -= use_token
            required -= use_token

            if required > 0:
                purple_pool -= required
                if purple_pool < 0:
                    return False

        purple_pool -= need[BALL_MASTER]
        return purple_pool >= 0

    def _pay_cost(self, player: PlayerState, card: dict) -> None:
        need = [0, 0, 0, 0, 0, 0]
        for item in card.get("cost", []):
            color = item.get("ball_color")
            number = item.get("number") or 0
            if isinstance(color, int) and 0 <= color < len(need):
                need[color] += number

        bonus = _reward_bonuses(player)
        spent = [0, 0, 0, 0, 0, 0]
        purple_bonus = bonus[BALL_MASTER]
        purple_tokens = player.tokens[BALL_MASTER]

        for c in range(5):
            required = need[c]
            use_bonus = min(bonus[c], required)
            required -= use_bonus

            use_token = min(player.tokens[c], required)
            player.tokens[c] -= use_token
            spent[c] += use_token
            required -= use_token

            if required > 0:
                use_purple_bonus = min(purple_bonus, required)
                purple_bonus -= use_purple_bonus
                required -= use_purple_bonus

                use_purple_token = min(purple_tokens, required)
                purple_tokens -= use_purple_token
                spent[BALL_MASTER] += use_purple_token
                required -= use_purple_token

        purple_required = need[BALL_MASTER]
        use_purple_bonus = min(purple_bonus, purple_required)
        purple_bonus -= use_purple_bonus
        purple_required -= use_purple_bonus

        if purple_required > 0:
            use_purple_token = min(purple_tokens, purple_required)
            purple_tokens -= use_purple_token
            spent[BALL_MASTER] += use_purple_token

        player.tokens[BALL_MASTER] = purple_tokens
        for i, count in enumerate(spent):
            if count > 0:
                self.state.token_pool[i] += count

    def _can_afford_evolution(self, player: PlayerState, base_card: dict) -> bool:
        evo = base_card.get("evolution", {})
        cost = evo.get("cost") or {}
        color = cost.get("ball_color")
        need = cost.get("number")
        if color is None or need is None:
            return False

        bonus = _reward_bonuses(player)
        if color == BALL_MASTER:
            purple_pool = player.tokens[BALL_MASTER] + bonus[BALL_MASTER]
            return purple_pool >= need

        remaining = need
        use_bonus = min(bonus[color], remaining)
        remaining -= use_bonus
        spend_color = min(player.tokens[color], remaining)
        remaining -= spend_color
        if remaining <= 0:
            return True

        purple_pool = player.tokens[BALL_MASTER] + bonus[BALL_MASTER]
        return purple_pool >= remaining

    def _pay_evolution_cost(self, player: PlayerState, base_card: dict) -> None:
        evo = base_card.get("evolution", {})
        cost = evo.get("cost") or {}
        color = cost.get("ball_color")
        need = cost.get("number") or 0
        if color is None:
            return

        bonus = _reward_bonuses(player)
        remaining = need

        if color != BALL_MASTER:
            use_bonus = min(bonus[color], remaining)
            remaining -= use_bonus
            spend_color = min(player.tokens[color], remaining)
            player.tokens[color] -= spend_color
            self.state.token_pool[color] += spend_color
            remaining -= spend_color

        if remaining > 0:
            use_purple_bonus = min(bonus[BALL_MASTER], remaining)
            remaining -= use_purple_bonus

        if remaining > 0:
            spend_purple = min(player.tokens[BALL_MASTER], remaining)
            player.tokens[BALL_MASTER] -= spend_purple
            self.state.token_pool[BALL_MASTER] += spend_purple

    def _first_affordable_base(self, player: PlayerState, evo_card: dict) -> Optional[dict]:
        if not evo_card:
            return None
        targets = [
            card
            for card in player.hand
            if card
            and isinstance(card.get("evolution"), dict)
            and card.get("evolution", {}).get("name") == evo_card.get("name")
        ]
        for base in targets:
            if self._can_afford_evolution(player, base):
                return base
        return None

    def _replace_with_evolution(self, player: PlayerState, base_card: dict, evolved_template: dict) -> None:
        try:
            idx = player.hand.index(base_card)
        except ValueError:
            return
        existing_stack = _get_stacked_cards(base_card)
        stack = [_clean_stack_data(card) for card in existing_stack]
        stack.append(_clean_stack_data(base_card))
        evolved = copy.deepcopy(evolved_template)
        evolved["stackedCards"] = stack
        player.hand[idx] = evolved

    # ----- Internal: game flow -----

    def _make_initial_state(self) -> GameState:
        decks = {
            "lv1": self._build_deck("level_1", 1),
            "lv2": self._build_deck("level_2", 2),
            "lv3": self._build_deck("level_3", 3),
            "rare": self._build_deck("rare", 4),
            "legend": self._build_deck("legend", 5),
        }
        market = {level: self._initial_market(level, decks) for level in (1, 2, 3, 4, 5)}

        players = [
            PlayerState(
                id=f"P{idx}",
                name=f"Player {idx + 1}",
                is_starter=idx == 0,
            )
            for idx in range(self.num_players)
        ]

        token_pool = self._token_pool_by_players(self.num_players)

        return GameState(
            turn=1,
            current_player_index=0,
            players=players,
            token_pool=token_pool,
            market={"slots_by_level": market},
            decks=decks,
            per_turn={"evolved": False, "primary_action": None},
            end_triggered=False,
            end_trigger_turn=None,
            victory_resolved=False,
        )

    def _token_pool_by_players(self, n: int) -> List[int]:
        if n == 2:
            return [4, 4, 4, 4, 4, 5]
        if n == 3:
            return [6, 6, 6, 6, 6, 5]
        return [7, 7, 7, 7, 7, 5]

    def _build_deck(self, key: str, level: int) -> List[dict]:
        cards = self.cards_by_level.get(key, [])
        deck = [_normalize_card(card, level, idx) for idx, card in enumerate(cards)]
        self.rng.shuffle(deck)
        return deck

    def _draw(self, level: int) -> Optional[dict]:
        deck_key = _level_key(level)
        deck = self.state.decks[deck_key]
        if deck:
            return deck.pop()
        return None

    def _initial_market(self, level: int, decks: Dict[str, List[dict]]) -> List[Optional[dict]]:
        sizes = {1: 4, 2: 4, 3: 4, 4: 1, 5: 1}
        want = sizes.get(level, 0)
        deck = decks[_level_key(level)]
        slots: List[Optional[dict]] = []
        for _ in range(want):
            slots.append(deck.pop() if deck else None)
        return slots

    def _draw_into_slot(self, level: int, idx: int) -> None:
        card = self._draw(level)
        self.state.market["slots_by_level"][level][idx] = card

    def _check_end_trigger(self) -> None:
        if self.state.end_triggered:
            return
        for player in self.state.players:
            if _total_trophies(player) >= 18:
                self.state.end_triggered = True
                self.state.end_trigger_turn = self.state.turn
                break

    def _should_resolve_victory(self, is_last_player_of_round: bool) -> bool:
        if self.state.victory_resolved:
            return False

        if not self.state.end_triggered and any(_total_trophies(p) >= 18 for p in self.state.players):
            self.state.end_triggered = True
            self.state.end_trigger_turn = self.state.turn

        if not self.state.end_triggered:
            return False

        if self.state.turn > (self.state.end_trigger_turn or 0):
            return True
        if self.state.turn == self.state.end_trigger_turn and is_last_player_of_round:
            return True
        return False

    def _resolve_victory(self) -> None:
        ranking = [
            {
                "player_index": idx,
                "trophies": _total_trophies(p),
                "penalty": _penalty_hand_count(p),
                "trophy_cards": _trophy_card_count(p),
            }
            for idx, p in enumerate(self.state.players)
        ]
        ranking.sort(
            key=lambda r: (
                -r["trophies"],
                -r["penalty"],
                -r["trophy_cards"],
                r["player_index"],
            )
        )
        self._last_ranking = ranking
        self.state.victory_resolved = True

    def _current_reward(self) -> List[int]:
        if not self.state or not self.state.victory_resolved:
            return [0 for _ in range(self.num_players)]

        return [_total_trophies(p) for p in self.state.players]
