import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { formatEval } from "../lib/chess";
import { makeReview } from "../test/fixtures";
import { ReviewView } from "./Review";

vi.mock("../lib/sounds", () => ({ playSound: vi.fn() }));
// react-chessboard measures squares, which jsdom cannot; the page logic is what we test here
vi.mock("../components/Board", () => ({
  default: ({ fen }: { fen: string }) => <div data-testid="board">{fen}</div>,
  BOARD_COLORS: {},
}));

beforeAll(() => {
  // jsdom lacks these; react-chessboard and MoveList use them
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

const review = makeReview(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"],
                          ["book", "book", "inaccuracy", "best", "best", "blunder", "best"],
                          [undefined, undefined, "Nf3", undefined, undefined, "g6"] as string[]);

function setup() {
  render(<MemoryRouter><ReviewView review={review} /></MemoryRouter>);
}

describe("Review page navigation", () => {
  it("arrow keys step through the game", async () => {
    setup();
    expect(screen.getByText(/Start position/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("move-banner")).toHaveTextContent("1. e4 is a book move");
    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByTestId("move-banner")).toHaveTextContent("4. Qxf7#");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("move-banner")).toHaveTextContent("3... Nf6 is a blunder move");
    expect(screen.getByTestId("move-banner")).toHaveTextContent("Best was g6");
  });

  it("show best line, then return to the game", async () => {
    setup();
    await userEvent.click(screen.getByRole("tab", { name: "moves" }));
    await userEvent.click(screen.getByRole("button", { name: "Nf6, Blunder" }));
    await userEvent.click(screen.getByRole("button", { name: /Show best line/ }));
    expect(screen.getByTestId("line-banner")).toHaveTextContent("g6");
    expect(screen.getByTestId("board").textContent).toBe(
      "r1bqkbnr/pppp1p1p/2n3p1/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 4");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("move-banner")).toHaveTextContent("3... Nf6");
  });

  it("summary shows accuracy for both players", () => {
    setup();
    expect(screen.getByTestId("accuracy-white")).toHaveTextContent("90.0");
    expect(screen.getByTestId("accuracy-black")).toHaveTextContent("90.0");
  });
});

describe("formatEval", () => {
  it("formats centipawns and mates", () => {
    expect(formatEval({ cp: 34, mate: null })).toBe("+0.3");
    expect(formatEval({ cp: -120, mate: null })).toBe("-1.2");
    expect(formatEval({ cp: 1530, mate: null })).toBe("+15");
    expect(formatEval({ cp: null, mate: 3 })).toBe("M3");
    expect(formatEval({ cp: null, mate: -2 })).toBe("-M2");
  });
});
