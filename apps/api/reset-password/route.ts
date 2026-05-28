import { prisma } from "@repo/db/client"
import bcrypt from "bcrypt"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json()

    if (!token || !password) {
      return NextResponse.json(
        { error: "Token and password are required" },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      )
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    })

    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired." },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
    ])

    return NextResponse.json({ message: "Password reset successfully. You can now sign in." })
  } catch (error) {
    console.error("[RESET PASSWORD ERROR]", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
