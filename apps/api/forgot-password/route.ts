import { prisma } from "@repo/db/client"
import { Resend } from "resend"
import { NextResponse } from "next/server"
import crypto from "crypto"

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, email: true, name: true, password: true },
    })

    // Always return the same response to prevent email enumeration
    if (!user || !user.password) {
      return NextResponse.json({
        message: "If an account with that email exists, we've sent a reset link.",
      })
    }

    // Invalidate any existing unused tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    })

    const token = crypto.randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt },
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const resetUrl = `${appUrl}/reset-password?token=${token}`
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"

    await resend.emails.send({
      from: `Kivo <${fromEmail}>`,
      to: user.email,
      subject: "Reset your Kivo password",
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;background:#0a0a0a;color:#fff;border-radius:12px;">
          <h1 style="color:#00D9A3;margin-bottom:8px;">Reset your password</h1>
          <p style="color:#aaa;margin-bottom:24px;">Hi ${user.name ?? "there"}, we received a request to reset your Kivo password.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#00D9A3;color:#000;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;margin-bottom:24px;">Reset Password</a>
          <p style="color:#666;font-size:13px;margin-top:16px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    })

    return NextResponse.json({
      message: "If an account with that email exists, we've sent a reset link.",
    })
  } catch (error) {
    console.error("[FORGOT PASSWORD ERROR]", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
