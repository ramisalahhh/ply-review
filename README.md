# Ply Review

Review your chess.com games with Stockfish: every move gets a classification
(Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss,
Blunder), each player gets an accuracy score and an estimated game rating, and
a web UI lets you step through the game with an eval bar, eval graph, best-move
arrows and engine lines.

> Ply Review is an independent project. It is not affiliated with, endorsed by
> or connected to chess.com. It only reads public game data through chess.com's
> official [Published-Data API](https://www.chess.com/news/view/published-data-api).
> Accuracy and classifications are an open approximation and will not match
> chess.com's numbers exactly.

## Quick start (Docker)

```bash
cp .env.example .env          # set CHESSCOM_CONTACT to your email
docker compose up --build
```

Open http://localhost:8080, enter a chess.com username, pick a game.
Stockfish 19 is downloaded into the image during the build.

## Local development

Requirements: Python 3.11+, Node 20+, a Stockfish binary
([official downloads](https://stockfishchess.org/download/)).

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"        # Windows: .venv\Scripts\pip
# set engine.path in config.yaml to your Stockfish binary

review games <username>                  # list recent games
review analyze <username> 1              # review the newest game in the terminal
review serve                             # API on http://127.0.0.1:8000 (docs at /docs)

cd frontend && npm install && npm run dev   # UI on http://localhost:5173
```

`review analyze` writes `output/<game>_review.json` and
`output/<game>_annotated.pgn` (NAGs, `[%eval]`, `[%clk]`, engine lines as
variations; opens in any chess GUI).

Tests: `pytest` (backend) and `cd frontend && npm test` (UI).

## Configuration

Everything tunable is in [`config.yaml`](config.yaml): engine depth, threads,
hash, MultiPV, a per-position time cap, every classification threshold, the
accuracy window and the rating curve.

Any key can be overridden with an environment variable:
`PLYREVIEW__ENGINE__DEPTH=20`, `PLYREVIEW__ENGINE__PATH=stockfish`, and so on.
`PLYREVIEW_CONFIG` points at a different config file.

## Architecture

```
chess.com API ──> backend/fetch ──> backend/engine ──> backend/analysis ──> backend/report
  (archives,        (client, cache,   (Stockfish UCI,     (win prob, classes,   (JSON, PGN,
   monthly games)    429 backoff)      MultiPV, jobs)      accuracy, rating)     terminal)
                                             │
                                    backend/api (FastAPI, SSE, SQLite) <── frontend (React)
```

| Folder | What it does |
|---|---|
| `backend/fetch` | chess.com client: one request at a time, descriptive User-Agent, retries with backoff on 429/5xx (honours `Retry-After`), ETag revalidation, on-disk cache (past months never refetched) |
| `backend/engine` | Stockfish wrapper (MultiPV = 2) and background jobs with progress events |
| `backend/analysis` | Win probability, classification, sacrifice detection, opening book, accuracy, rating, key moments |
| `backend/report` | Review JSON schema, annotated PGN, terminal tables |
| `backend/api` | FastAPI app, analysis service, SQLite review store |
| `frontend` | React + TypeScript + Vite + Tailwind; react-chessboard for the board, chess.js for engine lines |
| `scripts/calibrate.py` | Compare our results with chess.com's Game Review and tune thresholds |

Each position is searched once. Engine evaluations are cached per game and
engine setting, and reviews are stored by game + engine setting + a hash of the
classification config. Changing a threshold rebuilds reviews from the cached
evaluations in under a second, without running Stockfish again.

## How the numbers work

### Win probability (expected points)

Centipawns from the side to move's point of view are converted with the Lichess
logistic curve, clamped to ±1000 cp:

```
EP = 1 / (1 + exp(-0.00368208 * cp))
```

A forced mate scores just above any centipawn value (mate in 1 = 1.0, each extra
move to mate −0.001, down to mate in 20). Being mated is the mirror image.

**Expected points lost** for a move = EP(engine's best move) − EP(played move).
If the played move is engine line 1 or 2, its score comes from the position
before the move. Otherwise it comes from the engine's evaluation of the position
after the move, seen from the other side.

### Classification

Checked in this order; the first match wins. All numbers are in `config.yaml`.

| Class | Rule (defaults) |
|---|---|
| Book | The position after the move is in the opening book (Lichess chess-openings, CC0; transpositions count; first 30 plies). An optional Polyglot book can be added. |
| Brilliant | Loses ≤ 0.02 EP **and** gives up ≥ 2 points of material (static exchange evaluation after the move: piece left en prise, exchange sacrifice, Bxf7+ Kxf7 …), **and** the mover was not already ≥ 0.95 EP, **and** is ≥ 0.40 EP afterwards |
| Great | The engine's top move, with line 1 at least 0.15 EP better than line 2; not when line 2 is still ≥ 0.95 (already winning anyway) or line 1 ≤ 0.05; plain recaptures excluded |
| Miss | The opponent's previous move lost ≥ 0.10 EP, and this move gives back ≥ 0.10 EP without being a Blunder |
| Best | The engine's top move |
| Excellent / Good / Inaccuracy / Mistake / Blunder | EP lost ≤ 0.02 / ≤ 0.05 / ≤ 0.10 / ≤ 0.20 / > 0.20 |

A move with only one legal option is always Best.

### Accuracy

A port of the open [Lichess accuracy](https://lichess.org/page/accuracy)
algorithm:

- Per move: `103.1668 · exp(−0.04354 · (win%_before − win%_after)) − 3.1669 + 1`,
  clamped to 0–100.
- Per player: the average of two means:
  - a **volatility-weighted mean**, where each move is weighted by the standard
    deviation of win% in a sliding window (window = moves/10, between 2 and 8;
    weight clamped to 0.5–12);
  - a **harmonic mean**, which punishes a few very bad moves.

### Estimated game rating

chess.com does not publish its method. Ply Review maps accuracy to a rating
with a piecewise-linear curve (`rating.curve`). Games shorter than 20 moves per
side are pulled toward the player's real rating. Treat it as a rough estimate
until you calibrate it.

### Calibration

```bash
cp calibration.example.yaml calibration.yaml    # fill in chess.com's numbers
python scripts/calibrate.py calibration.yaml --search
```

The script reports accuracy and rating differences, per-class count errors,
per-move label agreement and the most common disagreements. `--search` also
grid-searches the loss thresholds and prints the set that agrees best.

## Deploying for other people

`docker compose up` is meant for one person or a small group on their own
machine or server. Before putting it on the public internet, add:

- **Rate limiting** per IP on `POST /api/analyses`. Each analysis uses
  `engine.threads` CPU cores for one to four minutes, and jobs run
  `engine.max_concurrent_jobs` at a time.
- **A reverse proxy with HTTPS** in front of port 8080.
- **The chess.com contact:** a real `CHESSCOM_CONTACT` value, as chess.com asks
  of API clients.

## Licenses and credits

- [Stockfish](https://stockfishchess.org/) (GPL-3.0) runs as a separate process.
  The Docker image downloads the official release binary.
- [python-chess](https://github.com/niklasf/python-chess) (GPL-3.0+).
- Opening names: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).
- Accuracy formula: [Lichess](https://lichess.org/page/accuracy) (the algorithm is reimplemented here).
- [react-chessboard](https://github.com/Clariity/react-chessboard) (MIT), including its default piece set.
- [chess.js](https://github.com/jhlywa/chess.js) (BSD-2).

Ply Review is free software, released under the
[GNU General Public License v3.0 or later](LICENSE). You may use, share and change
it; if you distribute a changed version, you must share its source code under the
same license.
