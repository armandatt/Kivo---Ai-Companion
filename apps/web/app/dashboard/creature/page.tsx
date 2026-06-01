import { cookies } from "next/headers"
import CreatureHero from "@/components/creature/creature-hero"
import EvolutionTimeline from "@/components/creature/evolution-timeline"
import CreatureLogFeed from "@/components/creature/creature-log-feed"
import CreatureSettings from "@/components/creature/creature-settings"

type CreatureData = {
  name: string
  type: string | null
  color: string | null
  stage: string
  currentStreak: number
  evolutionAvailable: boolean
  state: string
}

type EvolutionEvent = { stage: string; reachedAt: string; message?: string }
type CreatureLog = { id: string; text: string; createdAt: string }

type CreaturePageData = {
  creature: CreatureData
  evolutionHistory: EvolutionEvent[]
  creatureLogs: CreatureLog[]
}

type EvolutionRecord = {
  id: string
  stage: number
  stageName: string
  evolvedAt: string
  companionMessage: string | null
}

async function fetchCreature(): Promise<CreaturePageData | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("kevo_session")?.value
    if (!token) return null

    const apiUrl = process.env.API_URL ?? "http://localhost:3001"
    const headers = { Cookie: `kevo_session=${token}` }

    const [creatureRes, evolutionRes] = await Promise.all([
      fetch(`${apiUrl}/api/creature`, { headers, cache: "no-store" }),
      fetch(`${apiUrl}/api/creature/evolution`, { headers, cache: "no-store" }),
    ])

    if (!creatureRes.ok) return null
    const creature = await creatureRes.json() as CreaturePageData

    const evolutionData = evolutionRes.ok
      ? (await evolutionRes.json() as { evolutions: EvolutionRecord[] })
      : { evolutions: [] }

    const evolutionHistory: EvolutionEvent[] = evolutionData.evolutions.map((e) => ({
      stage: e.stageName,
      reachedAt: e.evolvedAt,
      message: e.companionMessage ?? undefined,
    }))

    return { ...creature, evolutionHistory }
  } catch {
    return null
  }
}

export default async function CreaturePage() {
  const data = await fetchCreature()

  const creature: CreatureData = data?.creature ?? {
    name: "Your Creature",
    type: null,
    color: null,
    stage: "egg",
    currentStreak: 0,
    evolutionAvailable: false,
    state: "resting",
  }
  const evolutionHistory = data?.evolutionHistory ?? []
  const creatureLogs = data?.creatureLogs ?? []

  return (
    <div style={{ maxWidth: "680px" }}>
      <CreatureHero creature={creature} />

      <div style={{ height: "24px" }} />

      <EvolutionTimeline stage={creature.stage} history={evolutionHistory} />

      <div style={{ height: "20px" }} />

      <CreatureLogFeed logs={creatureLogs} creatureName={creature.name} />

      <div style={{ height: "20px" }} />

      <CreatureSettings name={creature.name} type={creature.type} />
    </div>
  )
}
