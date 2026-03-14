#!/usr/bin/env python3
"""Genetic algorithm optimizer for Algebracket weight vectors.

Evolves a population of 24-stat weight vectors (each 0-10) to maximize
bracket scores across multiple years. Seeds initial population from
user-submitted weights in weights.total.

Requires: numpy
"""

import argparse
import csv
import os
import re
import sys
from pathlib import Path

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


def encode_weight_string(weights, year=2025):
    """Encode a weight vector into a 25-char weight string."""
    offset = year - 2010
    if offset < 10:
        year_char = str(offset)
    else:
        year_char = chr(ord("A") + offset - 10)
    chars = []
    for w in weights:
        v = int(round(w))
        v = max(0, min(10, v))
        chars.append("A" if v == 10 else str(v))
    return year_char + "".join(chars)


# --- Fitness ---

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


def fitness_batch(population, year_data, recency_half_life=None):
    """Evaluate fitness for entire population."""
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

def load_seed_weights(path, top_n, year_data):
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
    # Score all candidates
    scores = fitness_batch(candidates, year_data)
    ranked = np.argsort(scores)[::-1]
    top = [candidates[i] for i in ranked[:top_n]]
    print(f"Top seed score: {scores[ranked[0]]:.1f}, "
          f"#{min(top_n, len(candidates))} seed score: {scores[ranked[min(top_n, len(candidates))-1]]:.1f}")
    return top


def run_ga(year_data, args):
    """Run the genetic algorithm and return best results."""
    pop_size = args.population
    generations = args.generations
    mutation_rate = args.mutation_rate
    elitism_pct = 0.05
    elite_count = max(1, int(pop_size * elitism_pct))
    recency = args.recency_half_life

    # Seed population
    population = []
    if args.seed_file and os.path.exists(args.seed_file):
        seed_count = min(pop_size // 2, 200)
        seeds = load_seed_weights(args.seed_file, seed_count, year_data)
        population.extend(seeds)

    # Fill remaining with random
    while len(population) < pop_size:
        population.append(np.random.randint(0, 11, size=NUM_STATS).astype(np.float64))

    population = population[:pop_size]
    fitnesses = fitness_batch(population, year_data, recency)

    best_ever_fitness = fitnesses.max()
    best_ever = population[np.argmax(fitnesses)].copy()

    print(f"\nGeneration 0: best={fitnesses.max():.1f}, avg={fitnesses.mean():.1f}, "
          f"weights={encode_weight_string(best_ever)}")

    for gen in range(1, generations + 1):
        # Sort by fitness (descending)
        order = np.argsort(fitnesses)[::-1]

        new_pop = []
        # Elitism
        for i in range(elite_count):
            new_pop.append(population[order[i]].copy())

        # Breed
        while len(new_pop) < pop_size:
            p1 = tournament_select(population, fitnesses, k=3)
            p2 = tournament_select(population, fitnesses, k=3)
            child = crossover(p1, p2)
            child = mutate(child, mutation_rate)
            # Ensure integer weights
            child = np.clip(np.round(child), 0, 10)
            new_pop.append(child)

        population = new_pop[:pop_size]
        fitnesses = fitness_batch(population, year_data, recency)

        gen_best_idx = np.argmax(fitnesses)
        if fitnesses[gen_best_idx] > best_ever_fitness:
            best_ever_fitness = fitnesses[gen_best_idx]
            best_ever = population[gen_best_idx].copy()

        if gen % 10 == 0 or gen == generations:
            print(f"Generation {gen}: best={fitnesses.max():.1f}, "
                  f"avg={fitnesses.mean():.1f}, "
                  f"best_ever={best_ever_fitness:.1f}, "
                  f"weights={encode_weight_string(population[gen_best_idx])}")

    # Final results
    final_fitnesses = fitness_batch(population, year_data, recency)
    order = np.argsort(final_fitnesses)[::-1]

    results = []
    seen = set()
    for i in order:
        ws = encode_weight_string(population[i])
        if ws not in seen:
            seen.add(ws)
            # Get per-year breakdown
            per_year = {}
            for y, (regions, ff) in year_data.items():
                per_year[y] = score_bracket(regions, ff, population[i])
            results.append((ws, final_fitnesses[i], per_year))
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
    print(f"Population: {args.population}, Generations: {args.generations}, "
          f"Mutation rate: {args.mutation_rate}")

    year_data = load_years(args.data_dir, years)
    if not year_data:
        print("No year data loaded!", file=sys.stderr)
        sys.exit(1)

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
