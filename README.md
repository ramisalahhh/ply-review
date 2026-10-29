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

## Use it

**Website: https://ramisalahhh.github.io/ply-review/**

Enter a chess.com username, pick a game, and the review runs **in your browser**:
nothing to install, no account, no server. Your games come straight from
chess.com, Stockfish 19 runs inside the page, and finished reviews are saved on
your device, so a game is never analysed twice.

- **Strength:** Fast / Normal / Deep (depth 12 / 16 / 18, with a time cap per
  position). Phones default to Fast.
- **Speed:** several Stockfish workers analyse different positions at once. A
  typical 40-move game takes 10-30 seconds on a laptop at Normal, and longer on
  phones. `/engine-test` measures your device.
- **Privacy:** game data goes from chess.com to your browser and stays there.

## Run your own copy

**Website** (the same static site, served by nginx):

```bash
docker compose up --build            # http://localhost:8080
```

**Website for development:**

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

**Python tools.** These run full-size native Stockfish and add a command line,
annotated PGN export, an HTTP API and calibration.

Requirements: Python 3.11+ and a Stockfish binary
([official downloads](https://stockfishchess.org/download/)).

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"        # Windows: .venv\Scripts\pip
# set engine.path in config.yaml to your Stockfish binary

review games <username>                  # list recent games
review analyze <username> 1              # review the newest game in the terminal
review serve                             # API on http://127.0.0.1:8000 (docs at /docs)
```

`review analyze` writes `output/<game>_review.json` and
`output/<game>_annotated.pgn`, with NAGs, `[%eval]`, `[%clk]` and engine lines as
variations. The PGN opens in any chess GUI.

The API also runs in Docker: `docker compose --profile api up --build`.

Tests: `pytest` (backend) and `cd frontend && npm test` (website).

## Configuration

Everything tunable is in [`config.yaml`](config.yaml): engine settings, every
classification threshold, the accuracy window and the rating curve. The website
uses the same thresholds. After changing them, run:

```bash
python scripts/export_web_data.py
```

This copies the thresholds and the opening book into `frontend/`. CI fails if
this step is forgotten.

For the Python tools, any key can be overridden with an environment variable,
for example `PLYREVIEW__ENGINE__DEPTH=20`. `PLYREVIEW_CONFIG` points at a
different config file.

## Architecture

```
Website (frontend/, runs entirely in the browser)
  lib/chesscom.ts ──> engine/ (Stockfish 19 Lite WASM, worker pool) ──> analysis/ ──> pages/
  (games from chess.com,  (MultiPV 2, depth/time limits,                (classes,       (board, eval bar,
   IndexedDB cache)        several workers in parallel)                  accuracy, ...)  graph, best lines)

Python (backend/): the same analysis with native Stockfish
  fetch ──> engine ──> analysis ──> report (JSON, PGN, terminal) / api (FastAPI, SSE, SQLite)
```

| Folder | What it does |
|---|---|
| `frontend/src/engine` | Stockfish in Web Workers: UCI client, parallel pool, strength presets |
| `frontend/src/analysis` | TypeScript port of the analysis. Tests check that it gives **the same results as the Python code** on the same engine output |
| `frontend/src/lib` | chess.com client, local review store (IndexedDB), the review service the pages use |
| `backend/fetch` | chess.com client: one request at a time, descriptive User-Agent, retries with backoff on 429/5xx (honours `Retry-After`), on-disk cache (past months never refetched) |
| `backend/engine` | Native Stockfish wrapper (MultiPV = 2) and background jobs with progress events |
| `backend/analysis` | Win probability, classification, sacrifice detection, opening book, accuracy, rating, key moments |
| `backend/report` | Review JSON schema, annotated PGN, terminal tables |
| `backend/api` | FastAPI app, analysis service, SQLite review store |
| `scripts/` | `export_web_data.py` (config, book and test data for the website), `calibrate.py` |

Each position is searched once. Reviews are keyed by game, engine setting and a
hash of the classification config, so changing a threshold produces a new review
instead of silently mixing old and new labels.

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
| Brilliant | Loses ≤ 0.02 EP **and** gives up ≥ 2 points of material (static exchange evaluation after the move: piece left en prise, exchange sacrifice, Bxf7+ Kxf7 …), **and** the mover was not already ≥ 0.90 EP (about +6 pawns), **and** is ≥ 0.40 EP afterwards |
| Great | The engine's top move, with line 1 at least 0.15 EP better than line 2; not when line 2 is still ≥ 0.90 (already winning anyway) or line 1 ≤ 0.10; plain recaptures excluded |
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

## Publishing your own website

The `Website` workflow (`.github/workflows/pages.yml`) builds the site and
publishes it to GitHub Pages on every push to `main`. In a fork, enable it once
under **Settings → Pages → Source: GitHub Actions**. The site then appears at
`https://<user>.github.io/<repo>/`. There is no server to pay for or protect,
because every visitor's own device does the analysis.

## Licenses and credits

- [Stockfish](https://stockfishchess.org/) (GPL-3.0). The website uses the
  [stockfish.js](https://github.com/nmrugg/stockfish.js) WebAssembly build
  (Stockfish 19 Lite). The Python tools run the official native binary, which the
  API Docker image downloads.
- [python-chess](https://github.com/niklasf/python-chess) (GPL-3.0+).
- Opening names: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).
- Accuracy formula: [Lichess](https://lichess.org/page/accuracy) (the algorithm is reimplemented here).
- [react-chessboard](https://github.com/Clariity/react-chessboard) (MIT), including its default piece set.
- [chess.js](https://github.com/jhlywa/chess.js) (BSD-2).

Ply Review is free software, released under the
[GNU General Public License v3.0 or later](LICENSE). You may use, share and change
it; if you distribute a changed version, you must share its source code under the
same license.
