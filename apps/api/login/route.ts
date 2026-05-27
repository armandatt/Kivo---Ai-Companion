import { prisma } from "@repo/db/client"
import bcrypt from "bcrypt"
import { NextResponse } from "next/server"
import { createSession } from "../lib/auth/session"

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: {
        email: email.toLowerCase().trim(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        password: true,
      },
    })

    if (!user || !user.password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    )

    if (!passwordMatch) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    })
  } catch (error) {
    console.error("[LOGIN ERROR]", error)

    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}