import { Link, Route, Routes } from "react-router-dom";
import ThemeToggle from "./components/ThemeToggle";
import Analyzing from "./pages/Analyzing";
import Home from "./pages/Home";
import ReviewPage from "./pages/Review";

export default function App() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur
                         dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/logo.svg" alt="" className="h-7 w-7" />
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
        </Routes>
      </main>
    </div>
  );
}
