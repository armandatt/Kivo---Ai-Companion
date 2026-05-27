import { prisma } from "@repo/db/client"
import bcrypt from "bcrypt"
import { NextResponse } from "next/server"
import { createSession } from "../lib/auth/session"

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json()

    // Basic validation
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name?.trim() ?? null,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    })

    // Create session cookie immediately after signup
    await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    })

    return NextResponse.json(
      { message: "Account created", user },
      { status: 201 }
    )
  } catch (error) {
    console.error("[SIGNUP ERROR]", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
