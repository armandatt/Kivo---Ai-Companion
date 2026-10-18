// The places in the creature's village, which of them the learner has
// opened, and where an arrow key sends the creature. Pure: the engine draws
// and walks; this decides where to.

// Where each landmark stands (world units). The engine builds its village
// from these.
export const VILLAGE = {
  center  : { x:  0, z:  0  },  // Campfire / village heart
  home    : { x: -9, z: -8  },  // Creature Home (cottage)
  training: { x:-14, z:  5  },  // Training Hall
  grove   : { x: 12, z:  8  },  // Memory Grove
  plaza   : { x: 10, z: -6  },  // Achievement Plaza
  rex     : { x: -4, z: 15  },  // Rex Sanctuary
  shrine  : { x:  6, z: 13  },  // Commitment Shrine
  tower   : { x:  0, z: 20  },  // Journey Tower (visible landmark)
} as const

export type PlaceId = keyof typeof VILLAGE

export interface Place {
  id:         PlaceId
  name:       string
  // What the creature does there (the engine's behaviour for that stop).
  behavior:   'sit' | 'sleep' | 'train' | 'wander' | 'inspect' | 'rest' | 'reflect' | 'watch'
  // Days in a row of study before the creature may go there.
  unlockDays: number
  x: number
  z: number
}

const p = (id: PlaceId, name: string, behavior: Place['behavior'], unlockDays: number): Place => ({ id, name, behavior, unlockDays, ...VILLAGE[id] })

// In the order they open. The first three are open from the start.
export const PLACES: Place[] = [
  p('center',   'Campfire',          'sit',     0),
  p('home',     'Home',              'sleep',   0),
  p('grove',    'Memory Grove',      'wander',  0),
  p('training', 'Training Hall',     'train',   3),
  p('plaza',    'Achievement Plaza', 'inspect', 7),
  p('shrine',   'Commitment Shrine', 'reflect', 14),
  p('rex',      'Rex Sanctuary',     'rest',    30),
  p('tower',    'Journey Tower',     'watch',   60),
]

export const unlockedPlaces = (streak: number): Place[] => PLACES.filter(pl => streak >= pl.unlockDays)

export type Direction = 'up' | 'down' | 'left' | 'right'

// The open place an arrow key points at, as the learner sees the world: up
// is away from the camera, right is the screen's right. The camera stands
// behind the creature, looking along (sin yaw, cos yaw). Of the places
// within about 65 degrees of that direction, the nearest one, with places
// straight ahead preferred over ones off to the side. null: nothing that way.
export function placeToward(from: { x: number; z: number }, direction: Direction, yaw: number, places: Place[], current: PlaceId | null): Place | null {
  const fx = Math.sin(yaw), fz = Math.cos(yaw)
  const dir = {
    up:    { x:  fx, z:  fz },
    down:  { x: -fx, z: -fz },
    right: { x: -fz, z:  fx },
    left:  { x:  fz, z: -fx },
  }[direction]
  let best: { place: Place; score: number } | null = null
  for (const place of places) {
    if (place.id === current) continue
    const vx = place.x - from.x, vz = place.z - from.z
    const dist = Math.hypot(vx, vz)
    if (dist < 1) continue
    const cos = (vx * dir.x + vz * dir.z) / dist
    if (cos < 0.42) continue
    const score = dist * (2 - cos)
    if (!best || score < best.score) best = { place, score }
  }
  return best?.place ?? null
}
