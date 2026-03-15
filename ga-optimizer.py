#!/usr/bin/env python3
"""Genetic algorithm optimizer for Algebracket weight vectors.

Evolves a population of 24-stat weight vectors (each 0-10) to maximize
bracket scores across multiple years. Seeds initial population from
user-submitted weights in weights.total.

Requires: numpy
"""

import argparse
import csv
import math
import multiprocessing
import os
import random
import re
import sys

import numpy as np

SORTED_WEIGHTS = [
    "3PFGP", "AP", "ASM", "AT", "DR", "EFGP", "FGP", "FTFGA", "FTP",
    "OFTFGA", "OPG", "OR", "ORP", "OTP", "OTSP", "P", "PG", "RP", "SS",
    "Seed", "TM", "TP", "TSP", "WP",
]
NUM_STATS = len(SORTED_WEIGHTS)
SEED_IDX = SORTED_WEIGHTS.index("Seed")
SEED_MATCH_ORDER = [1, 8, 5, 4, 6, 3, 7, 2]
NON_STAT_HEADERS = {"Rank", "Region", "Name", "Games Won"}

# Scoring by round
ROUND_POINTS = {1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32}
ROUND_POINT_MAP = {"First Four": 0, "R64": 1, "R32": 2, "S16": 4, "E8": 8, "F4": 16, "Champ": 32}


def attr_to_id(attr):
    if attr in NON_STAT_HEADERS or attr == "Seed":
        return attr
    return re.sub(r"[a-z %./]", "", attr.replace("%", "P"))


def parse_csv(path):
    """Parse a year's CSV into teams list. Each team is a dict with
    'Rank', 'Region', 'Name', 'Games Won', and 'stats' (array indexed
    by SORTED_WEIGHTS order)."""
    teams = []
    with open(path, newline="") as f:
        reader = csv.reader(f)
        raw_headers = next(reader)
        # Map each CSV column to its stat index (or None for non-stat)
        col_map = []
        for h in raw_headers:
            sid = attr_to_id(h)
            if sid in NON_STAT_HEADERS:
                col_map.append(("meta", h))
            else:
                try:
                    idx = SORTED_WEIGHTS.index(sid)
                    col_map.append(("stat", idx))
                except ValueError:
                    col_map.append(("skip", None))

        for row in reader:
            if not row or not row[0].strip():
                continue
            team = {"stats": np.zeros(NUM_STATS, dtype=np.float64)}
            for j, val in enumerate(row):
                kind, key = col_map[j]
                if kind == "meta":
                    team[key] = val.strip()
                elif kind == "stat":
                    try:
                        team["stats"][key] = float(val)
                    except ValueError:
                        team["stats"][key] = 0.0
            # Convert metadata
            team["Rank"] = int(team.get("Rank", 999))
            team["Region"] = int(team.get("Region", 0))
            gw = team.get("Games Won", "")
            team["Games Won"] = int(gw) if gw.lstrip("-").isdigit() else -1
            teams.append(team)
    return teams


def build_bracket(teams):
    """Organize teams into regions and identify first-four matchups."""
    regions = [{}, {}, {}, {}]
    first_fours = []
    for team in teams:
        r = team["Region"]
        seed = int(team["stats"][SEED_IDX])
        if seed in regions[r]:
            first_fours.append((team, regions[r][seed]))
            del regions[r][seed]
        else:
            regions[r][seed] = team
    return regions, first_fours


def run_matchup(team1, team2, weights):
    """Return the winner of a matchup given weight vector."""
    s1 = team1["stats"] * weights
    s2 = team2["stats"] * weights
    # Seed inversion: higher seeds are worse, so invert
    s1[SEED_IDX] = (16 - team1["stats"][SEED_IDX]) * weights[SEED_IDX] / 16
    s2[SEED_IDX] = (16 - team2["stats"][SEED_IDX]) * weights[SEED_IDX] / 16
    t1 = s1.sum()
    t2 = s2.sum()
    if t1 > t2 or (t1 == t2 and team1["Rank"] < team2["Rank"]):
        return team1
    return team2


def score_bracket_roundopt(regions, first_fours, round_weights):
    """Simulate full bracket with per-round weight vectors (6x24 array).

    round_weights[0] = R64 (+ First Four), [1] = R32, [2] = S16,
    [3] = E8, [4] = F4, [5] = Championship.
    """
    work = [{k: v for k, v in reg.items()} for reg in regions]

    # First Four — use R64 weights
    for t1, t2 in first_fours:
        winner = run_matchup(t1, t2, round_weights[0])
        work[winner["Region"]][int(winner["stats"][SEED_IDX])] = winner

    score = 0
    region_winners = [None] * 4

    for rid in range(4):
        cur = work[rid]
        game_winners = {}

        # Round of 64 — round_weights[0]
        for idx, seed in enumerate(SEED_MATCH_ORDER):
            high = cur.get(seed)
            low = cur.get(17 - seed)
            if high is None or low is None:
                continue
            winner = run_matchup(high, low, round_weights[0])
            game_winners[idx + 1] = winner
            if winner["Games Won"] > 0:
                score += 1

        # Round of 32 through Elite 8
        round_for_game = {9: 1, 10: 1, 11: 1, 12: 1, 13: 2, 14: 2, 15: 3}
        game_diff = 8
        for game in range(9, 16):
            high = game_winners.get(game - game_diff)
            low = game_winners.get(game + 1 - game_diff)
            if high is None or low is None:
                game_diff -= 1
                continue
            rw_idx = round_for_game[game]
            winner = run_matchup(high, low, round_weights[rw_idx])
            game_winners[game] = winner
            rnd_num = 2 if game <= 12 else (3 if game <= 14 else 4)
            if winner["Games Won"] >= rnd_num:
                score += ROUND_POINTS[rnd_num]
            game_diff -= 1

        region_winners[rid] = game_winners.get(15)

    # Final Four — round_weights[4]
    ff_winners = {}
    for side, (r1, r2) in enumerate([(0, 1), (2, 3)]):
        t1, t2 = region_winners[r1], region_winners[r2]
        if t1 is None or t2 is None:
            continue
        winner = run_matchup(t1, t2, round_weights[4])
        ff_winners[side] = winner
        if winner["Games Won"] >= 5:
            score += 16

    # Championship — round_weights[5]
    if 0 in ff_winners and 1 in ff_winners:
        winner = run_matchup(ff_winners[0], ff_winners[1], round_weights[5])
        if winner["Games Won"] == 6:
            score += 32

    return score


REGION_NAMES = ["South", "East", "West", "Midwest"]


def simulate_bracket_detail(regions, first_fours, round_weights):
    """Simulate bracket with per-round weights and return detailed matchup results.

    Returns a list of (round_name, team1_name, team1_seed, team2_name, team2_seed,
    winner_name, correct) tuples.
    """
    work = [{k: v for k, v in reg.items()} for reg in regions]
    matchups = []

    # Use round_weights if it's 2D, otherwise broadcast to all rounds
    if round_weights.ndim == 1:
        rw = np.tile(round_weights, (6, 1))
    else:
        rw = round_weights

    # First Four
    for t1, t2 in first_fours:
        winner = run_matchup(t1, t2, rw[0])
        seed = int(winner["stats"][SEED_IDX])
        correct = winner["Games Won"] > 0
        matchups.append(("First Four", t1["Name"], int(t1["stats"][SEED_IDX]),
                         t2["Name"], int(t2["stats"][SEED_IDX]),
                         winner["Name"], correct, REGION_NAMES[winner["Region"]]))
        work[winner["Region"]][seed] = winner

    region_winners = [None] * 4

    for rid in range(4):
        cur = work[rid]
        game_winners = {}
        rname = REGION_NAMES[rid]

        # Round of 64
        for idx, seed in enumerate(SEED_MATCH_ORDER):
            high = cur.get(seed)
            low = cur.get(17 - seed)
            if high is None or low is None:
                continue
            winner = run_matchup(high, low, rw[0])
            game_winners[idx + 1] = winner
            correct = winner["Games Won"] > 0
            matchups.append(("R64", high["Name"], seed, low["Name"], 17 - seed,
                             winner["Name"], correct, rname))

        # R32 through E8
        round_for_game = {9: 1, 10: 1, 11: 1, 12: 1, 13: 2, 14: 2, 15: 3}
        round_label = {9: "R32", 10: "R32", 11: "R32", 12: "R32",
                       13: "S16", 14: "S16", 15: "E8"}
        round_num = {9: 2, 10: 2, 11: 2, 12: 2, 13: 3, 14: 3, 15: 4}
        game_diff = 8
        for game in range(9, 16):
            high = game_winners.get(game - game_diff)
            low = game_winners.get(game + 1 - game_diff)
            if high is None or low is None:
                game_diff -= 1
                continue
            rw_idx = round_for_game[game]
            winner = run_matchup(high, low, rw[rw_idx])
            game_winners[game] = winner
            rn = round_num[game]
            correct = winner["Games Won"] >= rn
            matchups.append((round_label[game], high["Name"],
                             int(high["stats"][SEED_IDX]),
                             low["Name"], int(low["stats"][SEED_IDX]),
                             winner["Name"], correct, rname))
            game_diff -= 1

        region_winners[rid] = game_winners.get(15)

    # Final Four
    ff_winners = {}
    for side, (r1, r2) in enumerate([(0, 1), (2, 3)]):
        t1, t2 = region_winners[r1], region_winners[r2]
        if t1 is None or t2 is None:
            continue
        winner = run_matchup(t1, t2, rw[4])
        ff_winners[side] = winner
        correct = winner["Games Won"] >= 5
        matchups.append(("F4", t1["Name"], int(t1["stats"][SEED_IDX]),
                         t2["Name"], int(t2["stats"][SEED_IDX]),
                         winner["Name"], correct, "Final Four"))

    # Championship
    if 0 in ff_winners and 1 in ff_winners:
        t1, t2 = ff_winners[0], ff_winners[1]
        winner = run_matchup(t1, t2, rw[5])
        correct = winner["Games Won"] == 6
        matchups.append(("Champ", t1["Name"], int(t1["stats"][SEED_IDX]),
                         t2["Name"], int(t2["stats"][SEED_IDX]),
                         winner["Name"], correct, "Championship"))

    return matchups


def format_bracket_text(matchups):
    """Format matchup results into a readable text bracket."""
    lines = []
    current_round = None
    current_region = None
    for rnd, t1, s1, t2, s2, winner, correct, region in matchups:
        if rnd != current_round:
            current_round = rnd
            current_region = None
            lines.append(f"\n  === {rnd} ===")
        if region != current_region:
            current_region = region
            lines.append(f"  --- {region} ---")
        mark = "OK" if correct else "XX"
        lines.append(f"    [{mark}] ({s1:>2}) {t1:<20} vs ({s2:>2}) {t2:<20} -> {winner}")
    return "\n".join(lines)


def collect_matchup_data(year_data, round_weights):
    """Run simulate_bracket_detail for each year, return {year: matchups}."""
    result = {}
    for year in sorted(year_data):
        regions, ff = year_data[year]
        result[year] = simulate_bracket_detail(regions, ff, round_weights)
    return result


def print_round_analysis(round_weights, year_data):
    """Print four analysis sections comparing round-specific vs blended weights."""
    blended = blend_round_weights(round_weights)

    rnd_matchups = collect_matchup_data(year_data, round_weights)
    blend_matchups = collect_matchup_data(year_data, blended)

    all_rounds = ["First Four", "R64", "R32", "S16", "E8", "F4", "Champ"]

    # Section A: Per-Round Accuracy (round-specific weights)
    print(f"\n  --- Section A: Per-Round Accuracy (Round-Specific Weights) ---")
    rnd_correct = {r: 0 for r in all_rounds}
    rnd_total = {r: 0 for r in all_rounds}
    for matchups in rnd_matchups.values():
        for rnd, _, _, _, _, _, correct, _ in matchups:
            rnd_total[rnd] += 1
            if correct:
                rnd_correct[rnd] += 1

    print(f"  {'Round':<12} {'Correct':>7}  {'Total':>5}  {'Accuracy':>8}")
    total_c, total_t = 0, 0
    for r in all_rounds:
        if rnd_total[r] > 0:
            pct = 100.0 * rnd_correct[r] / rnd_total[r]
            print(f"  {r:<12} {rnd_correct[r]:>7}  {rnd_total[r]:>5}  {pct:>7.1f}%")
            total_c += rnd_correct[r]
            total_t += rnd_total[r]
    if total_t > 0:
        print(f"  {'Overall':<12} {total_c:>7}  {total_t:>5}  {100.0 * total_c / total_t:>7.1f}%")

    # Section B: Per-Round Score Contribution
    print(f"\n  --- Section B: Per-Round Score Contribution ---")
    rnd_pts = {r: 0 for r in all_rounds}
    blend_pts = {r: 0 for r in all_rounds}
    for matchups in rnd_matchups.values():
        for rnd, _, _, _, _, _, correct, _ in matchups:
            if correct:
                rnd_pts[rnd] += ROUND_POINT_MAP[rnd]
    for matchups in blend_matchups.values():
        for rnd, _, _, _, _, _, correct, _ in matchups:
            if correct:
                blend_pts[rnd] += ROUND_POINT_MAP[rnd]

    print(f"  {'Round':<12} {'Pts(Rnd)':>8}  {'Pts(Blend)':>10}  {'Diff':>6}")
    total_r, total_b = 0, 0
    for r in all_rounds:
        if ROUND_POINT_MAP[r] == 0:
            continue
        diff = rnd_pts[r] - blend_pts[r]
        diff_s = f"{'+' if diff >= 0 else ''}{diff}"
        print(f"  {r:<12} {rnd_pts[r]:>8}  {blend_pts[r]:>10}  {diff_s:>6}")
        total_r += rnd_pts[r]
        total_b += blend_pts[r]
    diff = total_r - total_b
    diff_s = f"{'+' if diff >= 0 else ''}{diff}"
    print(f"  {'Total':<12} {total_r:>8}  {total_b:>10}  {diff_s:>6}")
    print(f"  Note: Cascading effects — different early-round winners affect later rounds.")

    # Section C: Stat Importance Shift
    print(f"\n  --- Section C: Stat Importance Shift (R64 -> Champ) ---")
    shifts = []
    for i, stat in enumerate(SORTED_WEIGHTS):
        r64_w = int(round(round_weights[0][i]))
        champ_w = int(round(round_weights[5][i]))
        shift = champ_w - r64_w
        shifts.append((stat, [int(round(round_weights[r][i])) for r in range(6)], shift))

    shifts.sort(key=lambda x: abs(x[2]), reverse=True)

    header = f"  {'Stat':<8}" + "".join(f" {r:>5}" for r in ROUND_NAMES) + f"  {'Shift':>5}"
    print(header)
    for stat, weights_per_round, shift in shifts:
        row = f"  {stat:<8}"
        for w in weights_per_round:
            row += f" {w:>5}"
        shift_s = f"{'+' if shift >= 0 else ''}{shift}"
        row += f"  {shift_s:>5}"
        print(row)

    # Top 5 summary
    print()
    for stat, _, shift in shifts[:5]:
        if shift > 0:
            print(f"  {stat}: more important in late rounds (+{shift})")
        elif shift < 0:
            print(f"  {stat}: less important in late rounds ({shift})")
        else:
            print(f"  {stat}: consistent across rounds (0)")

    # Section D: Round Specialization Value
    print(f"\n  --- Section D: Round Specialization Value ---")
    # Compare per-round: correct picks and points, round-specific vs blended
    rnd_correct_r = {r: 0 for r in all_rounds}
    rnd_total_r = {r: 0 for r in all_rounds}
    rnd_correct_b = {r: 0 for r in all_rounds}
    rnd_total_b = {r: 0 for r in all_rounds}
    rnd_pts_r = {r: 0 for r in all_rounds}
    rnd_pts_b = {r: 0 for r in all_rounds}

    for matchups in rnd_matchups.values():
        for rnd, _, _, _, _, _, correct, _ in matchups:
            rnd_total_r[rnd] += 1
            if correct:
                rnd_correct_r[rnd] += 1
                rnd_pts_r[rnd] += ROUND_POINT_MAP[rnd]
    for matchups in blend_matchups.values():
        for rnd, _, _, _, _, _, correct, _ in matchups:
            rnd_total_b[rnd] += 1
            if correct:
                rnd_correct_b[rnd] += 1
                rnd_pts_b[rnd] += ROUND_POINT_MAP[rnd]

    print(f"  {'Round':<12} {'Correct(Rnd)':>12}  {'Correct(Bld)':>12}  {'PickGain':>8}  "
          f"{'Pts(Rnd)':>8}  {'Pts(Bld)':>8}  {'PtsGain':>7}")
    total_cr, total_cb, total_pr, total_pb = 0, 0, 0, 0
    for r in all_rounds:
        if rnd_total_r[r] == 0:
            continue
        cr = rnd_correct_r[r]
        tr = rnd_total_r[r]
        cb = rnd_correct_b[r]
        tb = rnd_total_b[r]
        pick_gain = cr - cb
        pts_gain = rnd_pts_r[r] - rnd_pts_b[r]
        pg_s = f"{'+' if pick_gain >= 0 else ''}{pick_gain}"
        ptg_s = f"{'+' if pts_gain >= 0 else ''}{pts_gain}"
        print(f"  {r:<12} {cr:>5}/{tr:<6}  {cb:>5}/{tb:<6}  {pg_s:>8}  "
              f"{rnd_pts_r[r]:>8}  {rnd_pts_b[r]:>8}  {ptg_s:>7}")
        total_cr += cr
        total_cb += cb
        total_pr += rnd_pts_r[r]
        total_pb += rnd_pts_b[r]
    total_tr = sum(rnd_total_r.values())
    total_tb = sum(rnd_total_b.values())
    pg = total_cr - total_cb
    ptg = total_pr - total_pb
    pg_s = f"{'+' if pg >= 0 else ''}{pg}"
    ptg_s = f"{'+' if ptg >= 0 else ''}{ptg}"
    print(f"  {'Total':<12} {total_cr:>5}/{total_tr:<6}  {total_cb:>5}/{total_tb:<6}  "
          f"{pg_s:>8}  {total_pr:>8}  {total_pb:>8}  {ptg_s:>7}")
    print(f"  Note: F4 ({len(year_data)*2} games) and Champ ({len(year_data)} game(s)) have small samples.")


def score_bracket(regions, first_fours, weights):
    """Simulate full bracket and return total score."""
    # Make a working copy of regions so first-four winners don't persist
    work = [{k: v for k, v in reg.items()} for reg in regions]

    # First Four
    for t1, t2 in first_fours:
        winner = run_matchup(t1, t2, weights)
        work[winner["Region"]][int(winner["stats"][SEED_IDX])] = winner

    score = 0

    def get_round(game):
        if game <= 8:
            return 1
        if game <= 12:
            return 2
        if game <= 14:
            return 3
        return 4

    region_winners = [None] * 4

    for rid in range(4):
        cur = work[rid]
        game_winners = {}

        # Round of 64
        for idx, seed in enumerate(SEED_MATCH_ORDER):
            high = cur.get(seed)
            low = cur.get(17 - seed)
            if high is None or low is None:
                continue
            winner = run_matchup(high, low, weights)
            game_winners[idx + 1] = winner
            if winner["Games Won"] > 0:
                score += 1

        # Round of 32 through Elite 8
        game_diff = 8
        for game in range(9, 16):
            high = game_winners.get(game - game_diff)
            low = game_winners.get(game + 1 - game_diff)
            if high is None or low is None:
                game_diff -= 1
                continue
            winner = run_matchup(high, low, weights)
            game_winners[game] = winner
            rnd = get_round(game)
            if winner["Games Won"] >= rnd:
                score += ROUND_POINTS[rnd]
            game_diff -= 1

        region_winners[rid] = game_winners.get(15)

    # Final Four
    ff_winners = {}
    for side, (r1, r2) in enumerate([(0, 1), (2, 3)]):
        t1, t2 = region_winners[r1], region_winners[r2]
        if t1 is None or t2 is None:
            continue
        winner = run_matchup(t1, t2, weights)
        ff_winners[side] = winner
        if winner["Games Won"] >= 5:
            score += 16

    # Championship
    if 0 in ff_winners and 1 in ff_winners:
        winner = run_matchup(ff_winners[0], ff_winners[1], weights)
        if winner["Games Won"] == 6:
            score += 32

    return score


# --- Data Loading ---

def load_years(data_dir, years):
    """Load and parse bracket data for each year."""
    year_data = {}
    for y in years:
        path = os.path.join(data_dir, f"{y}.csv")
        if not os.path.exists(path):
            print(f"Warning: {path} not found, skipping year {y}", file=sys.stderr)
            continue
        teams = parse_csv(path)
        regions, first_fours = build_bracket(teams)
        year_data[y] = (regions, first_fours)
    return year_data


# --- Weight Encoding/Decoding ---

def decode_weight_string(s):
    """Decode a 25-char weight string into a numpy weight vector (0-10)."""
    if len(s) != 25:
        return None
    weights = np.zeros(NUM_STATS, dtype=np.float64)
    for i in range(NUM_STATS):
        c = s[i + 1]
        if c == "A":
            weights[i] = 10
        elif c.isdigit():
            weights[i] = int(c)
        else:
            return None
    return weights


def _year_char(year):
    offset = year - 2010
    if offset < 10:
        return str(offset)
    return chr(ord("A") + offset - 10)


def _encode_weight_char(v):
    v = int(round(v))
    v = max(0, min(10, v))
    return "A" if v == 10 else str(v)


def encode_weight_string(weights, year=2025):
    """Encode a weight vector into a 25-char weight string."""
    chars = [_encode_weight_char(w) for w in weights]
    return _year_char(year) + "".join(chars)


def encode_round_weight_string(round_weights, year=2025):
    """Encode a (6, 24) round-weight matrix into the round-specific URL format.

    Format: year_char + 'R' + 6×24 weight chars
    Rounds in order: R64, R32, S16, E8, F4, CHAMP.
    """
    chars = [_year_char(year), "R"]
    for r in range(6):
        for i in range(NUM_STATS):
            chars.append(_encode_weight_char(round_weights[r][i]))
    return "".join(chars)


# --- Fitness (parallel via multiprocessing) ---

# Module-level state set by worker initializer — avoids pickling year_data per call
_worker_year_data = None
_worker_recency = None


def _init_worker(year_data, recency_half_life):
    global _worker_year_data, _worker_recency
    _worker_year_data = year_data
    _worker_recency = recency_half_life


def _eval_fitness(weights):
    """Fitness function for pool workers — uses global worker state."""
    latest = max(_worker_year_data.keys())
    total = 0.0
    for y, (regions, ff) in _worker_year_data.items():
        s = score_bracket(regions, ff, weights)
        if _worker_recency:
            years_ago = latest - y
            s *= 0.5 ** (years_ago / _worker_recency)
        total += s
    return total


def fitness(weights, year_data, recency_half_life=None):
    """Total bracket score across all years, optionally recency-weighted."""
    latest = max(year_data.keys())
    total = 0.0
    for y, (regions, ff) in year_data.items():
        s = score_bracket(regions, ff, weights)
        if recency_half_life:
            years_ago = latest - y
            s *= 0.5 ** (years_ago / recency_half_life)
        total += s
    return total


def _eval_fitness_roundopt(round_weights):
    """Pool worker for round-specific fitness. round_weights is (6, 24)."""
    latest = max(_worker_year_data.keys())
    total = 0.0
    for y, (regions, ff) in _worker_year_data.items():
        s = score_bracket_roundopt(regions, ff, round_weights)
        if _worker_recency:
            years_ago = latest - y
            s *= 0.5 ** (years_ago / _worker_recency)
        total += s
    return total


def fitness_roundopt(round_weights, year_data, recency_half_life=None):
    """Total bracket score across all years using per-round weights."""
    latest = max(year_data.keys())
    total = 0.0
    for y, (regions, ff) in year_data.items():
        s = score_bracket_roundopt(regions, ff, round_weights)
        if recency_half_life:
            years_ago = latest - y
            s *= 0.5 ** (years_ago / recency_half_life)
        total += s
    return total


def fitness_batch(population, year_data, recency_half_life=None, pool=None):
    """Evaluate fitness for entire population, optionally in parallel."""
    if pool is not None:
        return np.array(pool.map(_eval_fitness, population))
    return np.array([fitness(ind, year_data, recency_half_life) for ind in population])


# --- GA Operations ---

def tournament_select(population, fitnesses, k=3):
    """Select one individual via tournament selection."""
    idxs = np.random.choice(len(population), size=k, replace=False)
    best = idxs[np.argmax(fitnesses[idxs])]
    return population[best].copy()


def crossover(parent_a, parent_b):
    """Uniform crossover: for each gene, randomly pick from either parent."""
    mask = np.random.random(NUM_STATS) < 0.5
    child = np.where(mask, parent_a, parent_b)
    return child


def mutate(individual, rate=0.1):
    """Per-gene mutation: ±1-2 with given probability, occasional reset."""
    for i in range(NUM_STATS):
        if np.random.random() < rate:
            if np.random.random() < 0.1:
                # Reset mutation
                individual[i] = np.random.randint(0, 11)
            else:
                # Small perturbation
                delta = np.random.choice([-2, -1, 1, 2])
                individual[i] = np.clip(individual[i] + delta, 0, 10)
    return individual


# --- Seed Population ---

def load_seed_weights(path, top_n, year_data, pool=None):
    """Load weights from file, score them, return top-N as numpy arrays."""
    seen = set()
    candidates = []
    with open(path) as f:
        for line in f:
            s = line.strip()
            if len(s) != 25 or s in seen:
                continue
            seen.add(s)
            w = decode_weight_string(s)
            if w is not None:
                candidates.append(w)

    if not candidates:
        return []

    print(f"Loaded {len(candidates)} unique weight vectors from {path}")
    scores = fitness_batch(candidates, year_data, pool=pool)
    ranked = np.argsort(scores)[::-1]
    top = [candidates[i] for i in ranked[:top_n]]
    print(f"Top seed score: {scores[ranked[0]]:.1f}, "
          f"#{min(top_n, len(candidates))} seed score: {scores[ranked[min(top_n, len(candidates))-1]]:.1f}")
    return top


def run_hillclimb(year_data, args):
    """Systematic hill climbing from top seed weights.

    For each starting point, repeatedly scan all 24 weights x 11 possible values,
    greedily take the best improvement, and repeat until no single-weight change
    improves the score. Then try all pairs of 2-weight changes for a final push.
    """
    recency = args.recency_half_life
    num_starts = args.hill_starts

    pool = multiprocessing.Pool(
        processes=args.workers,
        initializer=_init_worker,
        initargs=(year_data, recency),
    )
    print(f"Using {args.workers} worker processes")
    print(f"Hill climbing from top {num_starts} seeds")

    # Load and rank all seeds
    seed_weights = load_seed_weights(args.seed_file, num_starts, year_data, pool=pool)
    if not seed_weights:
        print("No seed weights loaded!", file=sys.stderr)
        pool.close()
        return []

    results = []
    seen_optima = set()

    for start_idx, start_weights in enumerate(seed_weights):
        current = start_weights.copy()
        current_score = fitness(current, year_data, recency)
        start_str = encode_weight_string(current)
        print(f"\n--- Start {start_idx + 1}/{num_starts}: {start_str} (score={current_score:.1f}) ---")

        # Phase 1: Greedy single-weight hill climb
        iteration = 0
        while True:
            iteration += 1
            # Generate all single-weight neighbors
            neighbors = []
            for i in range(NUM_STATS):
                for v in range(11):
                    if v != int(current[i]):
                        neighbor = current.copy()
                        neighbor[i] = float(v)
                        neighbors.append(neighbor)

            scores = np.array(pool.map(_eval_fitness, neighbors))
            best_neighbor_idx = np.argmax(scores)
            best_neighbor_score = scores[best_neighbor_idx]

            if best_neighbor_score > current_score:
                # Figure out which weight changed
                diff = neighbors[best_neighbor_idx] - current
                changed_idx = np.nonzero(diff)[0][0]
                old_val = int(current[changed_idx])
                new_val = int(neighbors[best_neighbor_idx][changed_idx])
                current = neighbors[best_neighbor_idx]
                current_score = best_neighbor_score
                print(f"  Iter {iteration}: {SORTED_WEIGHTS[changed_idx]} {old_val}->{new_val}, "
                      f"score={current_score:.1f}")
            else:
                print(f"  Converged after {iteration} iterations (no single-weight improvement)")
                break

        # Phase 2: Simulated annealing to escape local optima
        sa_steps = args.sa_steps
        if sa_steps > 0:
            print(f"  Phase 2: simulated annealing ({sa_steps} steps)...")
            temp = args.sa_temp
            cooling = (args.sa_temp_min / temp) ** (1.0 / sa_steps)
            sa_best = current.copy()
            sa_best_score = current_score
            accepted_worse = 0
            for step in range(1, sa_steps + 1):
                # Random single-weight perturbation
                candidate = current.copy()
                idx = random.randint(0, NUM_STATS - 1)
                old_val = int(candidate[idx])
                new_val = old_val
                while new_val == old_val:
                    new_val = random.randint(0, 10)
                candidate[idx] = float(new_val)

                candidate_score = fitness(candidate, year_data, recency)
                delta = candidate_score - current_score

                if delta > 0 or random.random() < math.exp(delta / temp):
                    if delta <= 0:
                        accepted_worse += 1
                    current = candidate
                    current_score = candidate_score
                    if current_score > sa_best_score:
                        sa_best = current.copy()
                        sa_best_score = current_score

                temp *= cooling
                if step % (sa_steps // 5) == 0:
                    print(f"    Step {step}/{sa_steps}: temp={temp:.2f}, "
                          f"current={current_score:.1f}, best={sa_best_score:.1f}, "
                          f"worse_accepted={accepted_worse}")

            # Restart from SA best, then re-do greedy hill climb
            current = sa_best
            current_score = sa_best_score
            print(f"  SA best: {encode_weight_string(current)} (score={current_score:.1f}), "
                  f"re-running greedy climb...")
            iteration = 0
            while True:
                iteration += 1
                neighbors = []
                for i in range(NUM_STATS):
                    for v in range(11):
                        if v != int(current[i]):
                            neighbor = current.copy()
                            neighbor[i] = float(v)
                            neighbors.append(neighbor)
                scores = np.array(pool.map(_eval_fitness, neighbors))
                best_neighbor_idx = np.argmax(scores)
                best_neighbor_score = scores[best_neighbor_idx]
                if best_neighbor_score > current_score:
                    diff = neighbors[best_neighbor_idx] - current
                    changed_idx = np.nonzero(diff)[0][0]
                    old_val = int(current[changed_idx])
                    new_val = int(neighbors[best_neighbor_idx][changed_idx])
                    current = neighbors[best_neighbor_idx]
                    current_score = best_neighbor_score
                    print(f"    Iter {iteration}: {SORTED_WEIGHTS[changed_idx]} {old_val}->{new_val}, "
                          f"score={current_score:.1f}")
                else:
                    print(f"    Converged after {iteration} iterations")
                    break

        # Phase 3: Try all 2-weight changes from the local optimum
        print(f"  Phase 2: scanning 2-weight neighborhoods...")
        improved = True
        while improved:
            improved = False
            neighbors = []
            neighbor_info = []
            for i in range(NUM_STATS):
                for vi in range(11):
                    if vi == int(current[i]):
                        continue
                    for j in range(i + 1, NUM_STATS):
                        for vj in range(11):
                            if vj == int(current[j]):
                                continue
                            neighbor = current.copy()
                            neighbor[i] = float(vi)
                            neighbor[j] = float(vj)
                            neighbors.append(neighbor)
                            neighbor_info.append((i, vi, j, vj))

            print(f"    Evaluating {len(neighbors)} 2-weight neighbors...")
            # Evaluate in chunks to avoid excessive memory
            chunk_size = 5000
            best_score = current_score
            best_neighbor = None
            best_info = None
            for c_start in range(0, len(neighbors), chunk_size):
                chunk = neighbors[c_start:c_start + chunk_size]
                scores = np.array(pool.map(_eval_fitness, chunk))
                chunk_best = np.argmax(scores)
                if scores[chunk_best] > best_score:
                    best_score = scores[chunk_best]
                    best_neighbor = chunk[chunk_best]
                    best_info = neighbor_info[c_start + chunk_best]

            if best_neighbor is not None:
                i, vi, j, vj = best_info
                print(f"    Found improvement: {SORTED_WEIGHTS[i]} {int(current[i])}->{vi}, "
                      f"{SORTED_WEIGHTS[j]} {int(current[j])}->{vj}, score={best_score:.1f}")
                current = best_neighbor
                current_score = best_score
                improved = True
            else:
                print(f"    No 2-weight improvement found")

        final_str = encode_weight_string(current)
        if final_str not in seen_optima:
            seen_optima.add(final_str)
            per_year = {}
            for y, (regions, ff) in year_data.items():
                per_year[y] = score_bracket(regions, ff, current)
            results.append((final_str, current_score, per_year))
            print(f"  Final: {final_str} (score={current_score:.1f})")
        else:
            print(f"  Converged to already-seen optimum: {final_str}")

    pool.close()
    pool.join()

    # Sort by score descending
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:10]


def blend_round_weights(round_weights):
    """Collapse (6, 24) round weights into a single (24,) blended vector.

    Uses point values [1, 2, 4, 8, 16, 32] as weights (sum=63).
    Championship round dominates (32/63 ≈ 50.8%).
    """
    point_values = np.array([1, 2, 4, 8, 16, 32], dtype=np.float64)
    blended = np.zeros(NUM_STATS, dtype=np.float64)
    for i in range(NUM_STATS):
        blended[i] = sum(round_weights[r][i] * point_values[r] for r in range(6)) / point_values.sum()
    blended = np.clip(np.round(blended), 0, 10)
    return blended


ROUND_NAMES = ["R64", "R32", "S16", "E8", "F4", "Champ"]


def run_hillclimb_roundopt(year_data, args):
    """Round-specific hill climbing: optimizes a (6, 24) weight matrix.

    Same 3-phase structure as run_hillclimb, but over 144 parameters.
    """
    recency = args.recency_half_life
    num_starts = args.hill_starts
    sa_steps = max(args.sa_steps, 10000) if args.sa_steps > 0 else 0

    pool = multiprocessing.Pool(
        processes=args.workers,
        initializer=_init_worker,
        initargs=(year_data, recency),
    )
    print(f"Using {args.workers} worker processes")
    print(f"Round-specific hill climbing from top {num_starts} seeds")
    print(f"Search space: 6 rounds x {NUM_STATS} stats = {6 * NUM_STATS} parameters")

    # Load seeds and tile each (24,) into (6, 24)
    seed_weights = load_seed_weights(args.seed_file, num_starts, year_data, pool=pool)
    if not seed_weights:
        print("No seed weights loaded!", file=sys.stderr)
        pool.close()
        return []

    results = []

    for start_idx, start_flat in enumerate(seed_weights):
        current = np.tile(start_flat, (6, 1))
        current_score = fitness_roundopt(current, year_data, recency)
        start_str = encode_weight_string(start_flat)
        print(f"\n--- Start {start_idx + 1}/{num_starts}: {start_str} (uniform score={current_score:.1f}) ---")

        # Phase 1: Greedy single-weight hill climb
        iteration = 0
        while True:
            iteration += 1
            neighbors = []
            neighbor_info = []
            for r in range(6):
                for i in range(NUM_STATS):
                    for v in range(11):
                        if v != int(current[r][i]):
                            neighbor = current.copy()
                            neighbor[r] = current[r].copy()
                            neighbor[r][i] = float(v)
                            neighbors.append(neighbor)
                            neighbor_info.append((r, i, v))

            scores = np.array(pool.map(_eval_fitness_roundopt, neighbors))
            best_idx = np.argmax(scores)
            best_score = scores[best_idx]

            if best_score > current_score:
                r, i, v = neighbor_info[best_idx]
                old_val = int(current[r][i])
                current = neighbors[best_idx]
                current_score = best_score
                print(f"  Iter {iteration}: {ROUND_NAMES[r]}:{SORTED_WEIGHTS[i]} {old_val}->{v}, "
                      f"score={current_score:.1f}")
            else:
                print(f"  Converged after {iteration} iterations (no single-param improvement)")
                break

        # Phase 2: Simulated annealing
        if sa_steps > 0:
            print(f"  Phase 2: simulated annealing ({sa_steps} steps)...")
            temp = args.sa_temp
            cooling = (args.sa_temp_min / temp) ** (1.0 / sa_steps)
            sa_best = current.copy()
            sa_best_score = current_score
            accepted_worse = 0
            for step in range(1, sa_steps + 1):
                candidate = current.copy()
                r = random.randint(0, 5)
                candidate[r] = current[r].copy()
                idx = random.randint(0, NUM_STATS - 1)
                old_val = int(candidate[r][idx])
                new_val = old_val
                while new_val == old_val:
                    new_val = random.randint(0, 10)
                candidate[r][idx] = float(new_val)

                candidate_score = fitness_roundopt(candidate, year_data, recency)
                delta = candidate_score - current_score

                if delta > 0 or random.random() < math.exp(delta / temp):
                    if delta <= 0:
                        accepted_worse += 1
                    current = candidate
                    current_score = candidate_score
                    if current_score > sa_best_score:
                        sa_best = current.copy()
                        sa_best_score = current_score

                temp *= cooling
                if step % (sa_steps // 5) == 0:
                    print(f"    Step {step}/{sa_steps}: temp={temp:.2f}, "
                          f"current={current_score:.1f}, best={sa_best_score:.1f}, "
                          f"worse_accepted={accepted_worse}")

            # Restart from SA best, re-do greedy climb
            current = sa_best
            current_score = sa_best_score
            print(f"  SA best score={current_score:.1f}, re-running greedy climb...")
            iteration = 0
            while True:
                iteration += 1
                neighbors = []
                neighbor_info = []
                for r in range(6):
                    for i in range(NUM_STATS):
                        for v in range(11):
                            if v != int(current[r][i]):
                                neighbor = current.copy()
                                neighbor[r] = current[r].copy()
                                neighbor[r][i] = float(v)
                                neighbors.append(neighbor)
                                neighbor_info.append((r, i, v))
                scores = np.array(pool.map(_eval_fitness_roundopt, neighbors))
                best_idx = np.argmax(scores)
                best_score = scores[best_idx]
                if best_score > current_score:
                    r, i, v = neighbor_info[best_idx]
                    old_val = int(current[r][i])
                    current = neighbors[best_idx]
                    current_score = best_score
                    print(f"    Iter {iteration}: {ROUND_NAMES[r]}:{SORTED_WEIGHTS[i]} {old_val}->{v}, "
                          f"score={current_score:.1f}")
                else:
                    print(f"    Converged after {iteration} iterations")
                    break

        # Phase 3: 2-weight neighborhoods (targeted passes)
        print(f"  Phase 3: scanning 2-weight neighborhoods...")

        improved = True
        while improved:
            improved = False

            # Pass A: Same-round pairs — C(24,2) x 10 x 10 per round
            print(f"    Pass A: same-round stat pairs...")
            for r in range(6):
                neighbors = []
                neighbor_info = []
                for i in range(NUM_STATS):
                    for vi in range(11):
                        if vi == int(current[r][i]):
                            continue
                        for j in range(i + 1, NUM_STATS):
                            for vj in range(11):
                                if vj == int(current[r][j]):
                                    continue
                                neighbor = current.copy()
                                neighbor[r] = current[r].copy()
                                neighbor[r][i] = float(vi)
                                neighbor[r][j] = float(vj)
                                neighbors.append(neighbor)
                                neighbor_info.append((r, i, vi, j, vj))

                # Evaluate in chunks
                chunk_size = 5000
                best_score = current_score
                best_neighbor = None
                best_info = None
                for c_start in range(0, len(neighbors), chunk_size):
                    chunk = neighbors[c_start:c_start + chunk_size]
                    scores = np.array(pool.map(_eval_fitness_roundopt, chunk))
                    chunk_best = np.argmax(scores)
                    if scores[chunk_best] > best_score:
                        best_score = scores[chunk_best]
                        best_neighbor = chunk[chunk_best]
                        best_info = neighbor_info[c_start + chunk_best]

                if best_neighbor is not None:
                    r2, i, vi, j, vj = best_info
                    print(f"      {ROUND_NAMES[r2]}: {SORTED_WEIGHTS[i]} {int(current[r2][i])}->{vi}, "
                          f"{SORTED_WEIGHTS[j]} {int(current[r2][j])}->{vj}, score={best_score:.1f}")
                    current = best_neighbor
                    current_score = best_score
                    improved = True

            # Pass B: Same-stat cross-round pairs — C(6,2) x 10 x 10 per stat
            print(f"    Pass B: same-stat cross-round pairs...")
            neighbors = []
            neighbor_info = []
            for s in range(NUM_STATS):
                for r1 in range(6):
                    for vr1 in range(11):
                        if vr1 == int(current[r1][s]):
                            continue
                        for r2 in range(r1 + 1, 6):
                            for vr2 in range(11):
                                if vr2 == int(current[r2][s]):
                                    continue
                                neighbor = current.copy()
                                neighbor[r1] = current[r1].copy()
                                neighbor[r2] = current[r2].copy()
                                neighbor[r1][s] = float(vr1)
                                neighbor[r2][s] = float(vr2)
                                neighbors.append(neighbor)
                                neighbor_info.append((s, r1, vr1, r2, vr2))

            print(f"      Evaluating {len(neighbors)} cross-round neighbors...")
            chunk_size = 5000
            best_score = current_score
            best_neighbor = None
            best_info = None
            for c_start in range(0, len(neighbors), chunk_size):
                chunk = neighbors[c_start:c_start + chunk_size]
                scores = np.array(pool.map(_eval_fitness_roundopt, chunk))
                chunk_best = np.argmax(scores)
                if scores[chunk_best] > best_score:
                    best_score = scores[chunk_best]
                    best_neighbor = chunk[chunk_best]
                    best_info = neighbor_info[c_start + chunk_best]

            if best_neighbor is not None:
                s, r1, vr1, r2, vr2 = best_info
                print(f"      {SORTED_WEIGHTS[s]}: {ROUND_NAMES[r1]} {int(current[r1][s])}->{vr1}, "
                      f"{ROUND_NAMES[r2]} {int(current[r2][s])}->{vr2}, score={best_score:.1f}")
                current = best_neighbor
                current_score = best_score
                improved = True

            if not improved:
                print(f"    No 2-weight improvement found")

        # Output per-round weights and blended vector
        blended = blend_round_weights(current)
        blended_score = fitness(blended, year_data, recency)
        blended_str = encode_weight_string(blended)

        # Per-year scores for both round-specific and blended
        per_year_round = {}
        per_year_blended = {}
        for y, (regions, ff) in year_data.items():
            per_year_round[y] = score_bracket_roundopt(regions, ff, current)
            per_year_blended[y] = score_bracket(regions, ff, blended)

        # Print per-round weight table
        abbr_width = max(len(a) for a in SORTED_WEIGHTS)
        header = f"{'':>6} " + " ".join(f"{a:>{abbr_width}}" for a in SORTED_WEIGHTS)
        print(f"\n  Per-Round Weight Table:")
        print(f"  {header}")
        for r in range(6):
            vals = " ".join(f"{int(current[r][i]):>{abbr_width}}" for i in range(NUM_STATS))
            print(f"  {ROUND_NAMES[r]:>6} {vals}")
        blend_vals = " ".join(f"{int(blended[i]):>{abbr_width}}" for i in range(NUM_STATS))
        print(f"  {'Blend':>6} {blend_vals}")

        year_list = sorted(year_data.keys())
        round_scores_str = ", ".join(f"{y}={per_year_round[y]}" for y in year_list)
        blend_scores_str = ", ".join(f"{y}={per_year_blended[y]}" for y in year_list)
        print(f"\n  Per-year scores (round-specific): {round_scores_str}")
        print(f"  Per-year scores (blended):        {blend_scores_str}")
        round_str = encode_round_weight_string(current)
        print(f"\n  Blended weight string: {blended_str}")
        print(f"  Blended URL: ?w={blended_str}")
        print(f"  Round-specific URL: ?w={round_str}&rw=1")
        print(f"  Round-specific total: {current_score:.1f}, Blended total: {blended_score:.1f}")

        results.append((blended_str, current_score, blended_score, per_year_round, per_year_blended, current))

    pool.close()
    pool.join()

    # Sort by round-specific score descending
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:10]


def run_ga(year_data, args):
    """Run the genetic algorithm with island model and return best results."""
    num_islands = args.islands
    pop_per_island = args.population // num_islands
    generations = args.generations
    mutation_rate = args.mutation_rate
    recency = args.recency_half_life
    num_workers = args.workers
    migrate_interval = args.migrate_interval
    inject_pct = args.inject_pct

    pool = multiprocessing.Pool(
        processes=num_workers,
        initializer=_init_worker,
        initargs=(year_data, recency),
    )
    print(f"Using {num_workers} worker processes")
    print(f"Island model: {num_islands} islands x {pop_per_island} individuals, "
          f"migration every {migrate_interval} generations, "
          f"{inject_pct*100:.0f}% diversity injection per generation")

    # Load seed weights (few per island to avoid domination)
    seed_weights = []
    if args.seed_file and os.path.exists(args.seed_file):
        seeds_per_island = min(20, pop_per_island // 10)
        total_seeds = seeds_per_island * num_islands
        seed_weights = load_seed_weights(args.seed_file, total_seeds, year_data, pool=pool)

    seeds_per_island = max(1, len(seed_weights) // num_islands)

    # Initialize islands with different seed subsets
    islands = []  # list of (population, fitnesses)
    best_ever_fitness = -1
    best_ever = None
    for i in range(num_islands):
        start = i * seeds_per_island
        island_seeds = seed_weights[start:start + seeds_per_island]

        pop = [w.copy() for w in island_seeds]
        while len(pop) < pop_per_island:
            pop.append(np.random.randint(0, 11, size=NUM_STATS).astype(np.float64))
        pop = pop[:pop_per_island]
        fit = fitness_batch(pop, year_data, pool=pool)

        if fit.max() > best_ever_fitness:
            best_ever_fitness = fit.max()
            best_ever = pop[np.argmax(fit)].copy()

        islands.append((pop, fit))
        print(f"  Island {i}: seeded with {len(island_seeds)} weights, "
              f"best={fit.max():.1f}, avg={fit.mean():.1f}")

    print(f"\nGeneration 0: best_ever={best_ever_fitness:.1f}")

    # Evolution loop with periodic migration
    gen = 0
    while gen < generations:
        chunk = min(migrate_interval, generations - gen)

        for i in range(num_islands):
            pop, fit = islands[i]
            # Evolve this island for `chunk` generations
            elite_count = max(1, int(pop_per_island * 0.05))
            inject_count = max(1, int(pop_per_island * inject_pct))

            for g in range(1, chunk + 1):
                order = np.argsort(fit)[::-1]
                new_pop = []
                for e in range(elite_count):
                    new_pop.append(pop[order[e]].copy())

                while len(new_pop) < pop_per_island - inject_count:
                    p1 = tournament_select(pop, fit, k=3)
                    p2 = tournament_select(pop, fit, k=3)
                    child = crossover(p1, p2)
                    child = mutate(child, mutation_rate)
                    child = np.clip(np.round(child), 0, 10)
                    new_pop.append(child)

                # Diversity injection
                while len(new_pop) < pop_per_island:
                    new_pop.append(np.random.randint(0, 11, size=NUM_STATS).astype(np.float64))

                pop = new_pop[:pop_per_island]
                fit = fitness_batch(pop, year_data, pool=pool)

                gen_best_idx = np.argmax(fit)
                if fit[gen_best_idx] > best_ever_fitness:
                    best_ever_fitness = fit[gen_best_idx]
                    best_ever = pop[gen_best_idx].copy()

            islands[i] = (pop, fit)

        gen += chunk

        # Migration: each island sends its best individual to the next island,
        # replacing the worst
        migrants = []
        for i in range(num_islands):
            pop, fit = islands[i]
            best_idx = np.argmax(fit)
            migrants.append(pop[best_idx].copy())

        for i in range(num_islands):
            pop, fit = islands[i]
            donor = migrants[(i - 1) % num_islands]  # receive from previous island
            worst_idx = np.argmin(fit)
            pop[worst_idx] = donor
            fit[worst_idx] = fitness(donor, year_data, recency)
            islands[i] = (pop, fit)

        # Progress report
        island_bests = [islands[i][1].max() for i in range(num_islands)]
        island_avgs = [islands[i][1].mean() for i in range(num_islands)]
        print(f"Generation {gen}: best_ever={best_ever_fitness:.1f}, "
              f"island_bests={[f'{b:.0f}' for b in island_bests]}, "
              f"island_avgs={[f'{a:.0f}' for a in island_avgs]}")

    pool.close()
    pool.join()

    # Collect final results across all islands
    all_pop = []
    all_fit = []
    for pop, fit in islands:
        all_pop.extend(pop)
        all_fit.extend(fit)
    all_fit = np.array(all_fit)
    order = np.argsort(all_fit)[::-1]

    results = []
    seen = set()
    for i in order:
        ws = encode_weight_string(all_pop[i])
        if ws not in seen:
            seen.add(ws)
            per_year = {}
            for y, (regions, ff) in year_data.items():
                per_year[y] = score_bracket(regions, ff, all_pop[i])
            results.append((ws, all_fit[i], per_year))
        if len(results) >= 10:
            break

    return results


def main():
    parser = argparse.ArgumentParser(description="GA optimizer for Algebracket weights")
    parser.add_argument("--years", default="2022-2025",
                        help="Year range, e.g. '2022-2025' or '2022,2023,2024' (default: 2022-2025)")
    parser.add_argument("--population", type=int, default=500, help="Population size (default: 500)")
    parser.add_argument("--generations", type=int, default=200, help="Number of generations (default: 200)")
    parser.add_argument("--mutation-rate", type=float, default=0.1, help="Mutation rate (default: 0.1)")
    parser.add_argument("--seed-file", default="weights.total", help="File with seed weights (default: weights.total)")
    parser.add_argument("--recency-half-life", type=float, default=None,
                        help="Half-life in years for recency weighting (default: None = equal weight)")
    parser.add_argument("--data-dir", default="data/cbbm", help="Path to CSV data directory (default: data/cbbm)")
    parser.add_argument("--workers", type=int, default=multiprocessing.cpu_count(),
                        help=f"Number of worker processes (default: {multiprocessing.cpu_count()} = all cores)")
    parser.add_argument("--islands", type=int, default=5,
                        help="Number of islands for island-model GA (default: 5)")
    parser.add_argument("--migrate-interval", type=int, default=25,
                        help="Generations between island migrations (default: 25)")
    parser.add_argument("--inject-pct", type=float, default=0.15,
                        help="Fraction of population replaced with random individuals each generation (default: 0.15)")
    parser.add_argument("--mode", choices=["ga", "hillclimb", "roundopt"], default="ga",
                        help="Optimization mode: 'ga' for genetic algorithm, 'hillclimb' for systematic hill climbing, 'roundopt' for round-specific weight optimization (default: ga)")
    parser.add_argument("--hill-starts", type=int, default=20,
                        help="Number of top seeds to hill-climb from (default: 20)")
    parser.add_argument("--sa-steps", type=int, default=5000,
                        help="Simulated annealing steps per start in hillclimb mode (default: 5000, 0 to disable)")
    parser.add_argument("--sa-temp", type=float, default=5.0,
                        help="SA initial temperature — should be close to typical score delta for a single-weight change (default: 5.0)")
    parser.add_argument("--sa-temp-min", type=float, default=0.01,
                        help="SA final temperature (default: 0.01)")
    args = parser.parse_args()

    # Parse years
    if "-" in args.years and "," not in args.years:
        start, end = args.years.split("-")
        years = list(range(int(start), int(end) + 1))
        # Skip 2020 (no tournament)
        years = [y for y in years if y != 2020]
    else:
        years = [int(y) for y in args.years.split(",")]

    print(f"Years: {years}")
    print(f"Mode: {args.mode}")

    year_data = load_years(args.data_dir, years)
    if not year_data:
        print("No year data loaded!", file=sys.stderr)
        sys.exit(1)

    if args.mode == "roundopt":
        results = run_hillclimb_roundopt(year_data, args)

        # Output for roundopt mode
        print(f"\n{'='*60}")
        print("TOP ROUND-OPTIMIZED RESULTS")
        print(f"{'='*60}")
        year_list = sorted(year_data.keys())
        header = (f"{'Rank':<5} {'RndScore':>8} {'BlendScore':>10} {'Blended Weight String':<27} "
                  + " ".join(f"{y}r/{y}b" for y in year_list))
        print(header)
        print("-" * len(header))
        for rank, (ws, rscore, bscore, per_year_r, per_year_b, _rw) in enumerate(results, 1):
            year_scores = " ".join(f"{per_year_r[y]:>3}/{per_year_b[y]:<3}" for y in year_list)
            print(f"{rank:<5} {rscore:>8.1f} {bscore:>10.1f} {ws:<27} {year_scores}")

        print(f"\nRound-specific URL format (append to algebracket.com):")
        for rank, (ws, rscore, bscore, _pyr, _pyb, rw) in enumerate(results, 1):
            rw_str = encode_round_weight_string(rw)
            print(f"  {rank}. ?w={rw_str}&rw=1  (round={rscore:.1f})")

        print(f"\nBlended URL format (append to algebracket.com):")
        for rank, (ws, rscore, bscore, _pyr, _pyb, _rw) in enumerate(results, 1):
            print(f"  {rank}. ?w={ws}  (blended={bscore:.1f})")

        print(f"\nAppend to weights.total:")
        for ws, _, _, _, _, _ in results:
            print(ws)

        best_ws, _, _, _, _, best_rw = results[0]

        print(f"\n{'='*60}")
        print("ROUND IMPORTANCE ANALYSIS")
        print(f"{'='*60}")
        print_round_analysis(best_rw, year_data)
    else:
        if args.mode == "hillclimb":
            results = run_hillclimb(year_data, args)
        else:
            print(f"Population: {args.population}, Generations: {args.generations}, "
                  f"Mutation rate: {args.mutation_rate}")
            results = run_ga(year_data, args)

        # Output
        print(f"\n{'='*60}")
        print("TOP 10 RESULTS")
        print(f"{'='*60}")
        year_list = sorted(year_data.keys())
        header = f"{'Rank':<5} {'Score':>7} {'Weight String':<27} " + " ".join(f"{y}" for y in year_list)
        print(header)
        print("-" * len(header))
        for rank, (ws, score, per_year) in enumerate(results, 1):
            year_scores = " ".join(f"{per_year[y]:>4}" for y in year_list)
            print(f"{rank:<5} {score:>7.1f} {ws:<27} {year_scores}")

        print(f"\nURL format (append to algebracket.com):")
        for rank, (ws, score, _) in enumerate(results, 1):
            print(f"  {rank}. ?w={ws}  (score: {score:.1f})")

        # Output compatible with weights.total
        print(f"\nAppend to weights.total:")
        for ws, _, _ in results:
            print(ws)


if __name__ == "__main__":
    main()
