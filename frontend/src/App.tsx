import { Link, Route, Routes } from "react-router-dom";
import ThemeToggle from "./components/ThemeToggle";
import Analyzing from "./pages/Analyzing";
import EngineTest from "./pages/EngineTest";
import Home from "./pages/Home";
import ReviewPage from "./pages/Review";

export default function App() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur
                         dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-7 w-7" />
            <span>Ply Review</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/analyze/:jobId" element={<Analyzing />} />
          <Route path="/review/:reviewId" element={<ReviewPage />} />
          <Route path="/engine-test" element={<EngineTest />} />
          <Route path="*" element={<p className="text-slate-500">Page not found. <Link
            className="underline" to="/">Go to the start page</Link></p>} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-center text-xs text-slate-400">
        <p>
          Stockfish runs in your browser; your games and reviews stay on this device.
          Not affiliated with chess.com.
        </p>
        <p className="mt-1 space-x-3">
          <a className="hover:underline" href="https://github.com/ramisalahhh/ply-review"
             target="_blank" rel="noreferrer">Source code (GPL-3.0)</a>
          <Link className="hover:underline" to="/engine-test">Engine speed test</Link>
        </p>
      </footer>
    </div>
  );
}
