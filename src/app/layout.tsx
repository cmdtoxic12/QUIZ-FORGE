import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuizForge — AI quiz games from your documents",
  description:
    "Upload notes, PDFs or slides and QuizForge's agent turns them into a fast, fun, competitive quiz game.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="aurora" aria-hidden="true" />
        <header className="sticky top-0 z-40 border-b border-white/10 bg-void/60 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
            <Link href="/" className="group flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 text-lg shadow-lg shadow-violet-600/30 transition-transform group-hover:scale-110">
                ⚡
              </span>
              <span className="text-lg font-black tracking-tight">
                Quiz<span className="text-gradient">Forge</span>
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm font-semibold text-white/70">
              <Link
                href="/"
                className="rounded-lg px-3 py-1.5 transition hover:bg-white/10 hover:text-white"
              >
                Create
              </Link>
              <Link
                href="/library"
                className="rounded-lg px-3 py-1.5 transition hover:bg-white/10 hover:text-white"
              >
                Library
              </Link>
              <Link
                href="/#how-it-works"
                className="hidden rounded-lg px-3 py-1.5 transition hover:bg-white/10 hover:text-white sm:block"
              >
                How it works
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-8">{children}</main>
      </body>
    </html>
  );
}
