"""Terminal output with rich tables."""

from __future__ import annotations

from rich.console import Console
from rich.table import Table

from backend.analysis.classify import ORDER
from backend.report.schema import Review

CLASS_STYLE = {
    "brilliant": "bold cyan", "great": "bold blue", "best": "green", "excellent": "green",
    "good": "dark_sea_green", "book": "tan", "inaccuracy": "yellow", "mistake": "dark_orange",
    "miss": "magenta", "blunder": "bold red",
}


def _num(move_number: int, color: str) -> str:
    return f"{move_number}." if color == "white" else f"{move_number}..."


def _clock(seconds: float | None) -> str:
    if seconds is None:
        return ""
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"


def print_moves(console: Console, r: Review, my_color: str | None = None,
                raw: bool = False) -> None:
    t = Table(title="Moves (eval = White's view after the move)")
    cols = ["Ply", "Move", "Class", "Eval", "Best", "Acc", "Clock"]
    if raw:
        cols += ["EP best", "EP played", "EP lost"]
    for col in cols:
        t.add_column(col, justify="left" if col in ("Move", "Best", "Class") else "right")
    for m in r.moves:
        label = f"{_num(m.move_number, m.color)} {m.san}"
        style = CLASS_STYLE.get(m.classification, "")
        row = [
            str(m.ply),
            f"[bold]{label}[/bold]" if m.color == my_color else label,
            f"[{style}]{m.classification}[/]",
            str(m.eval_after_white),
            "" if m.uci == m.best_uci else m.best_san,
            f"{m.accuracy:.0f}",
            _clock(m.clock),
        ]
        if raw:
            row += [f"{m.ep_best:.3f}", f"{m.ep_played:.3f}", f"{m.ep_loss:.3f}"]
        t.add_row(*row)
    console.print(t)
    if my_color:
        console.print(f"Bold = your moves ({my_color}).")


def print_summary(console: Console, r: Review) -> None:
    t = Table(title="Summary")
    t.add_column("")
    t.add_column(f"{r.white.username} (W)", justify="right")
    t.add_column(f"{r.black.username} (B)", justify="right")

    def fmt(v):
        return "-" if v is None else f"{v:.1f}" if isinstance(v, float) else str(v)

    t.add_row("Accuracy", fmt(r.white.accuracy), fmt(r.black.accuracy))
    t.add_row("Game rating (est.)", fmt(r.white.game_rating), fmt(r.black.game_rating))
    t.add_row("Rating", fmt(r.white.rating), fmt(r.black.rating))
    for c in ORDER:
        style = CLASS_STYLE[c.value]
        t.add_row(f"[{style}]{c.value}[/]", str(r.white.counts[c.value]),
                  str(r.black.counts[c.value]))
    console.print(t)
    if r.opening:
        console.print(f"Opening: {r.opening.eco} {r.opening.name}")


def print_key_moments(console: Console, r: Review) -> None:
    if not r.key_moments:
        return
    t = Table(title="Key moments")
    for col in ("Move", "Class", "Win% (White)", "Best", "Engine line"):
        t.add_column(col, justify="right" if col == "Win% (White)" else "left")
    for k in r.key_moments:
        style = CLASS_STYLE.get(k.classification, "")
        t.add_row(
            f"{_num(k.move_number, k.color)} {k.san}",
            f"[{style}]{k.classification}[/]",
            f"{k.white_win_before:.0f} -> {k.white_win_after:.0f}",
            k.best_san if k.best_san != k.san else "",
            " ".join(k.best_line[:8]),
        )
    console.print(t)


def print_review(console: Console, r: Review, my_color: str | None = None,
                 raw: bool = False, moves: bool = True) -> None:
    if moves:
        print_moves(console, r, my_color, raw)
    print_summary(console, r)
    print_key_moments(console, r)
