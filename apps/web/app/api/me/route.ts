import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'fallback-dev-secret-change-in-production'
)

export async function GET() {
  try {
    const store = await cookies()
    const token = store.get('kevo_session')?.value
    if (!token) return NextResponse.json({ creatureName: null }, { status: 401 })

    const { payload } = await jwtVerify(token, SECRET)
    const userId = (payload as { userId?: string }).userId
    if (!userId) return NextResponse.json({ creatureName: null }, { status: 401 })

    const { prisma } = await import('@repo/db/client')
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { creatureName: true },
    })

    return NextResponse.json({ creatureName: profile?.creatureName ?? null })
  } catch {
    return NextResponse.json({ creatureName: null }, { status: 500 })
  }
}
