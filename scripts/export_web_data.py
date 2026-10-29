"""Export what the in-browser analysis needs from the Python side.

    python scripts/export_web_data.py           # write the files
    python scripts/export_web_data.py --check   # fail if they are out of date (CI)

Writes:
  frontend/src/data/config.json     thresholds from config.yaml (one source of truth)
  frontend/public/data/book.json    opening book: EPD -> [eco, name], plus all book EPDs
  frontend/src/data/parity/*.json   engine evals + the review Python builds from them,
                                    so tests prove the TypeScript port gives identical results
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import typer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.analysis.opening import load_book  # noqa: E402
from backend.analysis.pipeline import GameEvaluation, build_plies, parse_pgn  # noqa: E402
from backend.analysis.review import build_review  # noqa: E402
from backend.config import Config, load_config  # noqa: E402

FRONT = ROOT / "frontend"
PARITY_DIR = FRONT / "src" / "data" / "parity"
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "evals"

app = typer.Typer(add_completion=False)


def web_config(cfg: Config) -> dict:
    return {
        "classification": cfg.classification.model_dump(),
        "accuracy": cfg.accuracy.model_dump(),
        "rating": {"curve": [list(p) for p in cfg.rating.curve],
                   "full_weight_moves": cfg.rating.full_weight_moves},
        "report": cfg.report.model_dump(),
    }


def book_data() -> dict:
    book = load_book()
    return {
        "source": "lichess-org/chess-openings (CC0)",
        "named": {epd: list(v) for epd, v in sorted(book.named.items())},
        "book": sorted(book.book),
    }


def parity_case(name: str, ev: GameEvaluation, cfg: Config) -> dict:
    # rebuild plies with the current code so the fixture never holds stale fields
    ev.plies = build_plies(parse_pgn(ev.pgn), ev.positions)
    r = build_review(ev, cfg, pgn=ev.pgn)
    return {
        "name": name,
        "pgn": ev.pgn,
        "engine": ev.engine,
        "depth": ev.depth,
        "positions": [p.model_dump(mode="json") for p in ev.positions],
        "expected": json.loads(r.model_dump_json(exclude={"positions", "pgn", "headers"})),
    }


def outputs(cfg: Config) -> dict[Path, str]:
    files = {
        FRONT / "src" / "data" / "config.json": json.dumps(web_config(cfg), indent=1),
        FRONT / "public" / "data" / "book.json": json.dumps(book_data(), separators=(",", ":")),
    }
    for f in sorted(FIXTURE_DIR.glob("*.json")):
        ev = GameEvaluation.model_validate_json(f.read_text(encoding="utf-8"))
        files[PARITY_DIR / f.name] = json.dumps(parity_case(f.stem, ev, cfg), indent=1)
    return {p: s + "\n" for p, s in files.items()}


def same_data(a, b) -> bool:
    """JSON equality, allowing last-digit float noise (exp() differs slightly by OS)."""
    if isinstance(a, float) or isinstance(b, float):
        return (isinstance(a, int | float) and isinstance(b, int | float)
                and math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same_data(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same_data(x, y) for x, y in zip(a, b, strict=True))
    return a == b


def up_to_date(path: Path, text: str) -> bool:
    if not path.exists():
        return False
    current = path.read_text(encoding="utf-8")
    return current == text or same_data(json.loads(current), json.loads(text))


@app.command()
def main(check: bool = typer.Option(False, help="Only verify the files are up to date")):
    cfg = load_config(ROOT / "config.yaml")
    stale = []
    for path, text in outputs(cfg).items():
        if up_to_date(path, text):
            continue
        stale.append(path.relative_to(ROOT))
        if not check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    if check and stale:
        print("Out of date (run: python scripts/export_web_data.py):")
        for p in stale:
            print(f"  {p}")
        raise typer.Exit(1)
    print("Up to date." if not stale else f"Wrote {len(stale)} file(s).")


if __name__ == "__main__":
    app()
