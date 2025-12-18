from __future__ import annotations

import random
from dataclasses import dataclass, replace
from typing import List, Optional, Callable


# ============================================================
# Game State
# ============================================================

@dataclass(frozen=True)
class GameState:
    """Pure game state, no UI, no side effects."""

    grid_size: int
    player_pos: int
    opponent_pos: int
    current_player: str  # "player" | "opponent"
    winner: Optional[str] = None

    @property
    def is_terminal(self) -> bool:
        return self.winner is not None


def create_initial_state(grid_size: int = 7) -> GameState:
    if grid_size < 3:
        raise ValueError("grid_size must be at least 3")

    return GameState(
        grid_size=grid_size,
        player_pos=0,
        opponent_pos=grid_size - 1,
        current_player="player",
    )


# ============================================================
# Rules
# ============================================================

def get_legal_actions(state: GameState) -> List[str]:
    """Return all legal actions for current player."""

    pos = state.player_pos if state.current_player == "player" else state.opponent_pos
    actions = ["stay"]

    if pos > 0:
        actions.append("left")
    if pos < state.grid_size - 1:
        actions.append("right")

    return actions


def apply_action(state: GameState, action: str) -> GameState:
    """Apply action and return new GameState."""

    if state.is_terminal:
        return state

    if action not in get_legal_actions(state):
        raise ValueError(f"Illegal action: {action}")

    actor = state.current_player
    pos = state.player_pos if actor == "player" else state.opponent_pos

    new_pos = _move(pos, action)
    winner = _check_winner(state, actor, new_pos)

    if actor == "player":
        next_state = replace(state, player_pos=new_pos)
        next_player = "opponent"
    else:
        next_state = replace(state, opponent_pos=new_pos)
        next_player = "player"

    if winner:
        return replace(next_state, winner=winner)

    return replace(next_state, current_player=next_player)


def _move(position: int, action: str) -> int:
    if action == "left":
        return position - 1
    if action == "right":
        return position + 1
    return position


def _check_winner(state: GameState, actor: str, new_pos: int) -> Optional[str]:
    # Reach goal
    if actor == "player" and new_pos == state.grid_size - 1:
        return actor
    if actor == "opponent" and new_pos == 0:
        return actor

    # Collision
    other_pos = state.opponent_pos if actor == "player" else state.player_pos
    if new_pos == other_pos:
        return actor

    return None


# ============================================================
# Evaluation
# ============================================================

def evaluate_state(state: GameState, perspective: str) -> float:
    """Evaluate how good the state is for `perspective`."""

    if state.winner == perspective:
        return 1.0
    if state.winner and state.winner != perspective:
        return -1.0

    if perspective == "player":
        return state.player_pos / (state.grid_size - 1)
    else:
        return (state.grid_size - 1 - state.opponent_pos) / (state.grid_size - 1)


# ============================================================
# AI Policies
# ============================================================

def random_policy(state: GameState) -> str:
    """Baseline random policy."""
    return random.choice(get_legal_actions(state))


def greedy_depth2_policy(state: GameState) -> str:
    """Depth-2 minimax-style greedy policy."""

    me = state.current_player
    best_score = -1e9
    best_action = None

    for action in get_legal_actions(state):
        s1 = apply_action(state, action)

        if s1.is_terminal:
            score = evaluate_state(s1, me)
        else:
            # Assume opponent chooses the worst reply
            score = min(
                evaluate_state(apply_action(s1, reply), me)
                for reply in get_legal_actions(s1)
            )

        if score > best_score:
            best_score = score
            best_action = action

    return best_action


def ai_with_difficulty(state: GameState, level: int) -> str:
    """
    Difficulty-controlled AI.

    level: 0 (easiest) ~ 4 (hardest)
    """

    if not 0 <= level <= 4:
        raise ValueError("Difficulty level must be between 0 and 4")

    blunder_rate_by_level = [0.6, 0.4, 0.2, 0.05, 0.0]
    blunder_rate = blunder_rate_by_level[level]

    if random.random() < blunder_rate:
        return random_policy(state)

    return greedy_depth2_policy(state)


# ============================================================
# Match Runner (for testing / benchmarking)
# ============================================================

def run_match(
    ai_player: Callable[[GameState], str],
    ai_opponent: Callable[[GameState], str],
    games: int = 50,
) -> dict:
    """Run AI vs AI matches and return win statistics."""

    results = {"player": 0, "opponent": 0}

    for seed in range(games):
        random.seed(seed)
        state = create_initial_state()

        while not state.is_terminal:
            if state.current_player == "player":
                action = ai_player(state)
            else:
                action = ai_opponent(state)

            state = apply_action(state, action)

        results[state.winner] += 1

    return results


# ============================================================
# Entry Point
# ============================================================

def main() -> None:
    print("Testing difficulty levels:")
    for level in range(5):
        result = run_match(
            lambda s, lv=level: ai_with_difficulty(s, lv),
            random_policy,
        )
        print(f"AI level {level}: {result}")


if __name__ == "__main__":
    main()
