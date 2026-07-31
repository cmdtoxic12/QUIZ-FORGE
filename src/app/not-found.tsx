import Link from "next/link";

export default function NotFound() {
  return (
    <div className="glass glow-ring mx-auto mt-10 max-w-lg rounded-3xl p-12 text-center">
      <div className="animate-float text-6xl">🕵️</div>
      <h1 className="mt-5 text-3xl font-black tracking-tight">Quiz not found</h1>
      <p className="mt-2 text-white/55">
        That quiz code doesn&apos;t exist (or the document was never forged). Upload a new
        document to make one.
      </p>
      <Link
        href="/"
        className="mt-7 inline-block rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 px-6 py-3 text-sm font-black text-white transition hover:brightness-110"
      >
        ← Back to the forge
      </Link>
    </div>
  );
}
