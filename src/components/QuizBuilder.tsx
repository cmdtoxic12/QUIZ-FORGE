"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yml,.yaml,.srt,.tex,.log";

const STAGES = [
  "Reading your documents…",
  "Extracting key concepts…",
  "Ranking the juiciest facts…",
  "Writing tricky distractors…",
  "Balancing difficulty curve…",
  "Loading the arcade…",
];

const DIFFICULTIES = [
  { id: "easy", label: "Warm-up", emoji: "🍃" },
  { id: "mixed", label: "Balanced", emoji: "🎯" },
  { id: "hard", label: "Brutal", emoji: "🔥" },
] as const;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const SAMPLE = `Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose. The reaction takes place inside chloroplasts, organelles that contain the green pigment chlorophyll.
Chlorophyll absorbs light most strongly in the blue and red parts of the spectrum, which is why leaves appear green to the human eye.
The light-dependent reactions occur in the thylakoid membranes and split water molecules, releasing oxygen as a by-product. Roughly 330 billion tonnes of oxygen are produced by photosynthesis every year.
The Calvin cycle is a light-independent stage that fixes carbon dioxide into sugar using the enzyme RuBisCO, widely believed to be the most abundant protein on Earth.
Melvin Calvin received the Nobel Prize in Chemistry in 1961 for mapping this carbon fixation pathway.
Rates of photosynthesis increase with light intensity until a plateau is reached, after which carbon dioxide concentration or temperature becomes the limiting factor.`;

export default function QuizBuilder() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<string>("mixed");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      setStage(0);
      return;
    }
    const id = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1100);
    return () => clearInterval(id);
  }, [loading]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    setError(null);
    setFiles((prev) => {
      const merged = [...prev];
      for (const file of list) {
        if (!merged.some((f) => f.name === file.name && f.size === file.size)) merged.push(file);
      }
      return merged.slice(0, 5);
    });
  }, []);

  const submit = async () => {
    if (loading) return;
    if (!files.length && pasted.trim().length < 200) {
      setError("Add a document, or paste at least a couple of paragraphs of text.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      if (pasted.trim()) body.append("text", pasted.trim());
      body.append("count", String(count));
      body.append("difficulty", difficulty);

      const res = await fetch("/api/quiz/generate", { method: "POST", body });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !data.code) throw new Error(data.error ?? "Generation failed.");
      router.push(`/play/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setLoading(false);
    }
  };

  return (
    <div className="glass glow-ring relative overflow-hidden rounded-3xl p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-fuchsia-500/20 blur-3xl" />
      <div className="relative">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black tracking-tight">Feed the agent 🍽️</h2>
          <button
            type="button"
            onClick={() => {
              setPasted(SAMPLE);
              setShowPaste(true);
              setError(null);
            }}
            className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-bold text-white/80 transition hover:bg-white/15"
          >
            ✨ Try a sample
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`group cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
            dragging
              ? "border-cyan-300 bg-cyan-400/10 scale-[1.01]"
              : "border-white/20 bg-white/[0.03] hover:border-violet-400/60 hover:bg-violet-500/10"
          }`}
        >
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/80 to-cyan-400/80 text-2xl shadow-lg shadow-violet-900/40 transition-transform group-hover:scale-110">
            📄
          </div>
          <p className="text-base font-bold">Drop documents here</p>
          <p className="mt-1 text-sm text-white/55">
            PDF · DOCX · TXT · MD · CSV · JSON · HTML — up to 5 files, 12 MB each
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {files.map((file) => (
              <li
                key={`${file.name}-${file.size}`}
                className="animate-pop flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5"
              >
                <span className="text-lg">{file.name.endsWith(".pdf") ? "📕" : "📘"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{file.name}</p>
                  <p className="text-xs text-white/50">{formatSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFiles((prev) => prev.filter((f) => f !== file));
                  }}
                  className="rounded-lg px-2 py-1 text-white/50 transition hover:bg-white/10 hover:text-flame"
                  aria-label={`Remove ${file.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="mt-4 text-sm font-semibold text-cyan-300 transition hover:text-cyan-200"
        >
          {showPaste ? "− Hide text box" : "+ Or paste raw text / notes"}
        </button>

        {showPaste && (
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Paste lecture notes, an article, meeting minutes…"
            className="animate-pop mt-3 w-full resize-y rounded-2xl border border-white/12 bg-black/30 p-4 text-sm leading-relaxed text-white/90 outline-none transition placeholder:text-white/30 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/30"
          />
        )}

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <label htmlFor="count" className="text-xs font-bold uppercase tracking-widest text-white/50">
                Questions
              </label>
              <span className="text-lg font-black text-gradient">{count}</span>
            </div>
            <input
              id="count"
              type="range"
              min={5}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-violet-400"
            />
          </div>
          <div>
            <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-white/50">
              Intensity
            </span>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDifficulty(d.id)}
                  className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${
                    difficulty === d.id
                      ? "border-violet-400 bg-violet-500/25 text-white shadow-lg shadow-violet-900/40"
                      : "border-white/12 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  <span className="mr-1">{d.emoji}</span>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="animate-shake mt-5 rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-200">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="group relative mt-6 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 px-6 py-4 text-base font-black tracking-tight text-white shadow-xl shadow-violet-900/40 transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-90"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {STAGES[stage]}
            </span>
          ) : (
            <span>🎮 Generate my quiz game</span>
          )}
          {loading && <span className="shimmer absolute inset-0" />}
        </button>
        <p className="mt-3 text-center text-xs text-white/40">
          Questions are built only from what your files actually say.
        </p>
      </div>
    </div>
  );
}
