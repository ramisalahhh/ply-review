// Port of backend/analysis/opening.py. The book (public/data/book.json) is
// exported from the same Lichess chess-openings data the Python side uses.

export interface OpeningBook {
  named: Map<string, [string, string]>; // EPD -> [eco, name]
  book: Set<string>;
}

export interface Opening {
  eco: string;
  name: string;
  ply: number;
}

export function epd(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function bookFromJson(data: { named: Record<string, [string, string]>; book: string[] }):
    OpeningBook {
  return { named: new Map(Object.entries(data.named)), book: new Set(data.book) };
}

let cached: Promise<OpeningBook> | null = null;

export function loadBook(url = `${import.meta.env.BASE_URL}data/book.json`): Promise<OpeningBook> {
  cached ??= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load the opening book (${r.status})`);
    return r.json();
  }).then(bookFromJson);
  return cached;
}

/** Per move: does it reach a book position? Transpositions count. */
export function bookFlags(fensAfter: string[], book: OpeningBook, maxPlies = 30): boolean[] {
  return fensAfter.map((fen, i) => i < maxPlies && book.book.has(epd(fen)));
}

/** Deepest named position the game passes through. */
export function detectOpening(fensAfter: string[], book: OpeningBook, maxPlies = 40):
    Opening | null {
  let found: Opening | null = null;
  fensAfter.slice(0, maxPlies).forEach((fen, i) => {
    const hit = book.named.get(epd(fen));
    if (hit) found = { eco: hit[0], name: hit[1], ply: i + 1 };
  });
  return found;
}
