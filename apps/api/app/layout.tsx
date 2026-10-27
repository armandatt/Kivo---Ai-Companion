export const metadata = {
  title: "Kivo",
  description: "AI accountability companion",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#0a0a0a", color: "#e5e5e5", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
