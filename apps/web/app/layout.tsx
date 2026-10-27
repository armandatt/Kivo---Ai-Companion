import type React from "react"
import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
})
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
})

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.thekivo.in"
const DESCRIPTION =
  "Kivo is an AI-powered learning OS. Build your learning system with Nova, connect subjects and topics on a Knowledge Map, study your notes and research papers with a Tutor, and shape each day on your terms."

// The icons are files in this folder (icon.svg, apple-icon.png, favicon.ico)
// and the share picture is opengraph-image.tsx: Next.js links them itself.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Kivo: the AI-powered learning OS",
    template: "%s · Kivo",
  },
  description: DESCRIPTION,
  applicationName: "Kivo",
  keywords: ["learning OS", "knowledge map", "AI tutor", "research paper notes", "study planner", "focus sessions", "exam preparation", "Kivo", "Nova"],
  openGraph: {
    type: "website",
    siteName: "Kivo",
    url: "/",
    title: "Kivo: turn what you learn into what you know",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Kivo: turn what you learn into what you know",
    description: DESCRIPTION,
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1E9" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://prod.spline.design" />
        <link rel="dns-prefetch" href="https://prod.spline.design" />
      </head>
      <body className={`${geistSans.className} ${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
