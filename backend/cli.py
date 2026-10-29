"""Ply Review command line."""

from __future__ import annotations

import io
import time

import chess.pgn
import typer
from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeElapsedColumn
from rich.table import Table

from backend.analysis.pipeline import GameEvaluation
from backend.analysis.review import build_review
from backend.analysis.store import load_eval, save_eval
from backend.api.jobs import meta_for
from backend.config import Config, get_config
from backend.engine.worker import JobRunner
from backend.fetch import ChessComClient, ChessComError, Game
from backend.report.json_out import write_json
from backend.report.pgn_out import write_pgn
from backend.report.terminal import print_review

app = typer.Typer(help="Ply Review: review your chess.com games with Stockfish.",
                  no_args_is_help=True)
console = Console()

OUTCOME_STYLE = {"win": "green", "loss": "red", "draw": "yellow"}


def _client(offline: bool) -> ChessComClient:
    return ChessComClient(get_config(), offline=offline)


@app.command()
def games(
    username: str,
    limit: int = typer.Option(20, "--limit", "-n", help="How many recent games to list"),
    refresh: bool = typer.Option(False, help="Ignore the cache for recent data"),
    offline: bool = typer.Option(False, help="Use cached data only"),
):
    """List your recent games."""
    try:
        with _client(offline) as c:
            rows = c.recent_games(username, limit=limit, refresh=refresh)
    except ChessComError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from None

    t = Table(title=f"Recent games: {username}")
    for col in ("#", "Date", "Opponent", "Result", "Time", "Color"):
        t.add_column(col, justify="right" if col == "#" else "left")
    for i, g in enumerate(rows, 1):
        opp = g.opponent(username)
        outcome = g.outcome_for(username)
        t.add_row(
            str(i),
            g.date.strftime("%Y-%m-%d %H:%M"),
            f"{opp.username} ({opp.rating})",
            f"[{OUTCOME_STYLE[outcome]}]{outcome}[/] {g.result_tag}",
            f"{g.time_control_label} {g.time_class}",
            g.color_of(username),
        )
    console.print(t)
    if not rows:
        console.print("No standard chess games found.")


@app.command()
def show(
    username: str,
    selector: str = typer.Argument(..., help="Index from `review games` (1 = newest) or game URL"),
    pgn: bool = typer.Option(False, help="Print the full PGN"),
    offline: bool = typer.Option(False, help="Use cached data only"),
):
    """Pick one game by index or URL and show it."""
    try:
        with _client(offline) as c:
            g = c.find_game(username, selector)
    except ChessComError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from None

    parsed = chess.pgn.read_game(io.StringIO(g.pgn))
    plies = sum(1 for _ in parsed.mainline_moves()) if parsed else 0
    h = parsed.headers if parsed else {}
    console.print(f"[bold]{g.white.username} ({g.white.rating}) vs "
                  f"{g.black.username} ({g.black.rating})[/bold]  {g.result_tag}")
    console.print(f"{g.date:%Y-%m-%d}  {g.time_control_label} {g.time_class}  "
                  f"you: {g.color_of(username)}  plies: {plies}")
    if h.get("ECOUrl"):
        name = h["ECOUrl"].rsplit("/", 1)[-1].replace("-", " ")
        console.print(f"Opening (chess.com tag): {name}")
    console.print(g.url)
    if pgn:
        console.print(g.pgn)


def _run_engine(cfg: Config, g: Game) -> GameEvaluation:
    console.print(f"depth {cfg.engine.depth}, {cfg.engine.threads} threads, "
                  f"MultiPV {cfg.engine.multipv}")
    job = JobRunner(cfg.engine, cfg.engine.max_concurrent_jobs).submit(g.pgn)
    started = time.monotonic()
    with Progress(TextColumn("Analysing"), BarColumn(), MofNCompleteColumn(),
                  TimeElapsedColumn(), TextColumn("{task.fields[ev]}"), console=console) as bar:
        task = bar.add_task("analyse", total=None, ev="")
        try:
            while (ev := job.events.get()) is not None:
                bar.update(task, completed=ev.done, total=ev.total, ev=f"eval {ev.eval}")
        except KeyboardInterrupt:
            job.cancel()
            job.wait()
            console.print("[yellow]Cancelled[/yellow]")
            raise typer.Exit(130) from None
    job.wait()
    if job.status != "done" or job.result is None:
        console.print(f"[red]Analysis failed: {job.error or job.status}[/red]")
        raise typer.Exit(1) from None
    console.print(f"{job.result.engine}: {len(job.result.positions)} positions in "
                  f"{time.monotonic() - started:.0f}s")
    return job.result


def evaluation_for(cfg: Config, g: Game, force: bool = False) -> GameEvaluation:
    ev = None if force else load_eval(cfg, g.game_id)
    if ev is None:
        ev = _run_engine(cfg, g)
        save_eval(cfg, g.game_id, ev)
    else:
        console.print(f"[dim]Using saved engine analysis (depth {ev.depth}); --force to redo[/dim]")
    return ev


@app.command()
def analyze(
    username: str,
    selector: str = typer.Argument(..., help="Index from `review games` (1 = newest) or game URL"),
    depth: int = typer.Option(None, help="Override engine depth from config.yaml"),
    force: bool = typer.Option(False, help="Re-run Stockfish even if saved analysis exists"),
    raw: bool = typer.Option(False, help="Also show expected-points columns"),
    summary_only: bool = typer.Option(False, "--summary", help="Skip the per-move table"),
    offline: bool = typer.Option(False, help="Use cached games only"),
):
    """Review one game: classify every move, accuracy, estimated rating, opening."""
    cfg = get_config()
    if depth:
        cfg.engine.depth = depth
    try:
        with _client(offline) as c:
            g = c.find_game(username, selector)
    except ChessComError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from None

    console.print(f"[bold]{g.white.username} vs {g.black.username}[/bold]  {g.result_tag}")
    review = build_review(evaluation_for(cfg, g, force), cfg, meta_for(g), pgn=g.pgn)

    out_dir = cfg.storage.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = out_dir / g.game_id.replace("/", "-")
    json_path = stem.with_name(stem.name + "_review.json")
    pgn_path = stem.with_name(stem.name + "_annotated.pgn")
    write_json(review, json_path)
    write_pgn(review, pgn_path, cfg.report.variation_plies)

    print_review(console, review, g.color_of(username), raw, moves=not summary_only)
    console.print(f"Saved {json_path}")
    console.print(f"Saved {pgn_path}")


@app.command()
def serve(
    host: str = typer.Option(None, help="Default: api.host in config.yaml"),
    port: int = typer.Option(None, help="Default: api.port in config.yaml"),
    reload: bool = typer.Option(False, help="Auto-reload on code changes (development)"),
):
    """Start the API server (docs at /docs)."""
    import uvicorn

    cfg = get_config()
    uvicorn.run("backend.api.main:create_app", factory=True, reload=reload,
                host=host or cfg.api.host, port=port or cfg.api.port)


if __name__ == "__main__":
    app()
