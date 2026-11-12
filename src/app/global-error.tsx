"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <main style={{ display: "grid", minHeight: "100dvh", placeItems: "center", padding: "1rem", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ maxWidth: "26rem", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 900, margin: 0 }}>应用没能启动</h1>
            <p style={{ color: "#6b7280", fontSize: ".875rem", lineHeight: 1.6, marginTop: ".5rem" }}>
              数据保存在服务器上,没有被改动。请重试,或刷新页面。
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: "1.5rem", width: "100%", padding: ".75rem 1rem", borderRadius: ".75rem", border: 0, background: "#3559c7", color: "white", fontSize: ".875rem", fontWeight: 700, cursor: "pointer" }}
            >
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
