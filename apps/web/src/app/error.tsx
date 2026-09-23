"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="center-page">
      <h1>A little interruption.</h1>
      <p>Something went wrong. Your room may still be playing.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <a href="/">Back to discovery</a>
    </main>
  );
}
