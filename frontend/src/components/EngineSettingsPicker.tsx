import { useState } from "react";
import { type EngineSettings, loadSettings, maxWorkers, PRESETS, type Preset,
         saveSettings } from "../engine/settings";

const HINT: Record<Preset, string> = {
  fast: "Quickest; good for phones",
  normal: "Good balance",
  deep: "Most precise, about twice as slow",
};

export default function EngineSettingsPicker({ onChange }: {
  onChange?: (s: EngineSettings) => void;
}) {
  const [s, setS] = useState(loadSettings);

  function update(next: Partial<EngineSettings>) {
    const merged = { ...s, ...next };
    setS(merged);
    saveSettings(merged);
    onChange?.(merged);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="text-slate-500">Engine strength</span>
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300
                      dark:border-slate-700" role="radiogroup" aria-label="Engine strength">
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <button key={p} role="radio" aria-checked={s.preset === p} title={HINT[p]}
                  onClick={() => update({ preset: p })}
                  className={`px-3 py-1 transition ${s.preset === p
                    ? "bg-brand-600 text-white"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
            {PRESETS[p].label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-slate-500" title="Parallel engines (CPU cores)">
        cores
        <select value={s.workers} onChange={(e) => update({ workers: Number(e.target.value) })}
                className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-slate-800
                           dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                aria-label="Engine cores">
          {Array.from({ length: maxWorkers() }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
