import type React from "react"
import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Instrument_Serif } from "next/font/google"
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
// Headings only (Tailwind's font-display). Self-hosted by next/font at build.
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
})

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.thekivo.in"
const DESCRIPTION =
  "Kivo plans your study day with you, keeps your notes, topics and saved pages connected, and shows how you are actually progressing. Nova, your learning mentor, works on the web and on Telegram."

// The icons are files in this folder (icon.svg, apple-icon.png, favicon.ico)
// and the share picture is opengraph-image.tsx: Next.js links them itself.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Kivo: plan, learn and grow with Nova",
    template: "%s · Kivo",
  },
  description: DESCRIPTION,
  applicationName: "Kivo",
  keywords: ["study planner", "learning mentor", "connected notes", "knowledge map", "focus sessions", "exam preparation", "Kivo", "Nova"],
  openGraph: {
    type: "website",
    siteName: "Kivo",
    url: "/",
    title: "Kivo: plan, learn and grow with Nova",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Kivo: plan, learn and grow with Nova",
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
      <body className={`${geistSans.className} ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
