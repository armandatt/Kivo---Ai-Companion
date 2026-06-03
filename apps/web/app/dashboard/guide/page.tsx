import { cookies } from 'next/headers'
import CompanionGuide from '@/components/companion-guide'

async function fetchPersona(token: string): Promise<string> {
  try {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
    const res = await fetch(`${apiUrl}/api/nav`, {
      headers: { Cookie: `kevo_session=${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return 'NOVA'
    const data = await res.json() as { persona?: string }
    return (data.persona ?? 'nova').toUpperCase()
  } catch {
    return 'NOVA'
  }
}

export default async function GuidePage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('kevo_session')?.value ?? ''
  const persona = await fetchPersona(token)

  return (
    <div style={{ maxWidth: '880px' }}>
      <CompanionGuide persona={persona} fullscreen={false} />
    </div>
  )
}
