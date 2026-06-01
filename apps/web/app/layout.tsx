import type React from "react"
import type { Metadata } from "next"
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

export const metadata: Metadata = {
  title: "Kivo | Your AI companion that grows with you",
  description:
    "Meet Kivo — the AI companion that checks in every day, tracks your goals, and evolves as you stay consistent. No app needed. Lives in WhatsApp and Telegram.",
  generator: "v0.app",
  keywords: ["AI companion", "productivity", "habit tracker", "WhatsApp bot", "Telegram bot", "streak tracker"],
  openGraph: {
    title: "Kivo | Your AI companion that grows with you",
    description:
      "Meet Kivo — the AI companion that checks in every day, tracks your goals, and evolves as you stay consistent.",
    type: "website",
    siteName: "Kivo",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kivo | Your AI companion that grows with you",
    description:
      "Meet Kivo — the AI companion that checks in every day, tracks your goals, and evolves as you stay consistent.",
  },
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://prod.spline.design" />
        <link rel="dns-prefetch" href="https://prod.spline.design" />
      </head>
      <body className={`${geistSans.className} ${geistMono.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
