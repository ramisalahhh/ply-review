import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeReview } from "../test/fixtures";
import MoveList, { toRows } from "./MoveList";

const review = makeReview(["e4", "e5", "Nf3", "Nc6", "Bb5"],
                          ["book", "book", "best", "inaccuracy", "blunder"]);

describe("MoveList", () => {
  it("groups moves into numbered rows", () => {
    const rows = toRows(review.moves);
    expect(rows.map((r) => [r.number, r.white?.san, r.black?.san])).toEqual([
      [1, "e4", "e5"], [2, "Nf3", "Nc6"], [3, "Bb5", undefined],
    ]);
  });

  it("shows each move with its classification", () => {
    render(<MoveList moves={review.moves} currentPly={0} onSelect={() => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Nc6, Inaccuracy" })).toBeInTheDocument();
    const bb5 = screen.getByRole("button", { name: "Bb5, Blunder" });
    expect(within(bb5).getByRole("img", { name: "Blunder" })).toBeInTheDocument();
  });

  it("marks the current move", () => {
    render(<MoveList moves={review.moves} currentPly={3} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Nf3, Best" })).toHaveAttribute("aria-current",
                                                                             "true");
    expect(screen.getByRole("button", { name: "e4, Book" })).not.toHaveAttribute("aria-current");
  });

  it("clicking a move selects its ply", async () => {
    const onSelect = vi.fn();
    render(<MoveList moves={review.moves} currentPly={0} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Nc6, Inaccuracy" }));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it("handles a game where Black moves first", () => {
    const moves = review.moves.slice(1).map((m, i) => ({ ...m, ply: i + 1 }));
    const rows = toRows(moves);
    expect(rows[0].number).toBe(1);
    expect(rows[0].white).toBeUndefined();
    expect(rows[0].black?.san).toBe("e5");
  });
});
