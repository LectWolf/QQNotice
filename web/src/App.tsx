import { useEffect, useState } from "react";

type PingResponse = { code: number; message: string };

export function App(): JSX.Element {
  const [ping, setPing] = useState<PingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ping")
      .then((r) => r.json() as Promise<PingResponse>)
      .then((data) => {
        if (!cancelled) setPing(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>QQNotice</h1>
      <p>Server酱-style notification channel for QQ.</p>
      <section>
        <h2>API status</h2>
        {ping ? (
          <pre>{JSON.stringify(ping, null, 2)}</pre>
        ) : error ? (
          <pre style={{ color: "crimson" }}>{error}</pre>
        ) : (
          <p>checking…</p>
        )}
      </section>
    </main>
  );
}
