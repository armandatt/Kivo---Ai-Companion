/**
 * Kivo Village Engine
 *
 * Design principle: landmarks first, terrain second.
 * The village is the content. Terrain is just background.
 *
 * Village contains 7 named landmarks visible from spawn.
 * Kivo has an autonomous routine — walks between landmarks,
 * sleeps, trains, wanders. Never stands idle in empty space.
 */

import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import type { BiomeType } from './game-state'

export type { BiomeType }
export interface VoxelBlock { position: THREE.Vector3; blockType: string; biome: BiomeType }

// ─── Village landmark positions ────────────────────────────────────────────────
const V = {
  center  : { x:  0, z:  0  },  // Campfire / village heart
  home    : { x: -9, z: -8  },  // Creature Home (cottage)
  training: { x:-14, z:  5  },  // Training Hall
  grove   : { x: 12, z:  8  },  // Memory Grove
  plaza   : { x: 10, z: -6  },  // Achievement Plaza
  rex     : { x: -4, z: 15  },  // Rex Sanctuary
  shrine  : { x:  6, z: 13  },  // Commitment Shrine
  tower   : { x:  0, z: 20  },  // Journey Tower (visible landmark)
}

// Routine waypoints Kivo cycles through
const WAYPOINTS = [
  { ...V.home,     label: 'sleep'   },
  { ...V.center,   label: 'sit'     },
  { ...V.training, label: 'train'   },
  { ...V.grove,    label: 'wander'  },
  { ...V.plaza,    label: 'inspect' },
  { ...V.rex,      label: 'rest'    },
  { ...V.shrine,   label: 'reflect' },
  { ...V.tower,    label: 'watch'   },
]

// Dwell time at each waypoint (seconds): min, max
const DWELL: Record<string, [number, number]> = {
  sleep  : [360, 600],  // 6–10 min
  sit    : [240, 480],  // 4–8 min
  train  : [240, 480],  // 4–8 min
  wander : [180, 360],  // 3–6 min
  inspect: [180, 360],  // 3–6 min
  rest   : [180, 360],  // 3–6 min
  reflect: [180, 360],  // 3–6 min
  watch  : [240, 420],  // 4–7 min
}

const ACTIVITY_TEXT: Record<string, string[]> = {
  sleep  : ['Kivo is asleep.', 'Kivo rests peacefully inside.'],
  sit    : ['Kivo sits by the campfire.', 'Kivo stares into the flames quietly.'],
  train  : ['Kivo is training.', 'Kivo pushes through the reps.', 'Kivo practices alone.'],
  wander : ['Kivo walks through the Memory Grove.', 'Kivo studies the monuments.'],
  inspect: ['Kivo looks around the Achievement Plaza.', 'Kivo observes the plaza.'],
  rest   : ['Kivo stands before the Rex Sanctuary.', 'Kivo kneels near the sanctuary.'],
  reflect: ['Kivo reflects at the Commitment Shrine.', 'Kivo stands quietly at the shrine.'],
  watch  : ['Kivo gazes from the Journey Tower.', 'Kivo watches the horizon.'],
  walking: ['Kivo walks with purpose.', 'Kivo heads somewhere.'],
}

function pickActivity(label: string): string {
  const msgs = ACTIVITY_TEXT[label] ?? ['Kivo is resting.']
  return msgs[Math.floor(Math.random() * msgs.length)]
}

// ─── Noise / PRNG helpers ──────────────────────────────────────────────────────
function strSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Terrain — flat village, hills beyond ─────────────────────────────────────
const WORLD = 280, SEGS = 140

function makeHeightFn(hN: (x: number, y: number) => number) {
  return (wx: number, wz: number): number => {
    const dist  = Math.sqrt(wx * wx + wz * wz)
    const flat  = Math.exp(-Math.pow(dist / 18, 2)) * 2.2    // super-flat village core
    const mid   = Math.exp(-Math.pow(dist / 55, 2)) * 5      // gentle hills outside
    const isle  = Math.max(0, 1 - Math.pow(dist / 120, 2.5)) * 5
    const n1    = hN(wx / 70, wz / 70) * 3.5
    const n2    = hN(wx / 25, wz / 25) * 1.8
    const n3    = hN(wx / 8,  wz / 8)  * 0.6
    const noise = (n1 + n2 + n3) * (1 - Math.exp(-Math.pow(dist / 22, 2)))
    return Math.max(-2.5, 1.2 + flat + mid + isle + noise)
  }
}

function heightColor(h: number): THREE.Color {
  const c = new THREE.Color()
  if      (h < -0.1) c.setHex(0x1a5580)
  else if (h < 0.6)  c.setHex(0xd4bc82)
  else if (h < 2.5)  c.setHex(0x5bb840)
  else if (h < 5.0)  c.setHex(0x4aa830)
  else if (h < 8.0)  c.setHex(0x3a7828)
  else if (h < 11.0) c.setHex(0x7a7260)
  else               c.setHex(0xe8eaf6)
  return c
}

function buildTerrain(hFn: (x: number, z: number) => number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEGS, SEGS)
  geo.rotateX(-Math.PI / 2)
  const pos  = geo.attributes.position as THREE.BufferAttribute
  const cols = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const h = hFn(pos.getX(i), pos.getZ(i))
    pos.setY(i, h)
    const c = heightColor(h)
    cols[i*3]=c.r; cols[i*3+1]=c.g; cols[i*3+2]=c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.receiveShadow = true
  return mesh
}

// ─── Primitive helpers ────────────────────────────────────────────────────────
type Obj3D = THREE.Object3D
const sh = (o: THREE.Mesh) => { o.castShadow = true; o.receiveShadow = true; return o }
const M  = (c: number, opts: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
  new THREE.MeshLambertMaterial({ color: c, ...opts })
const EM = (c: number, i = 0.6) =>
  new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: i })

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat))
}
function cyl(rt: number, rb: number, h: number, segs: number, mat: THREE.Material): THREE.Mesh {
  return sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat))
}
function cone(r: number, h: number, segs: number, mat: THREE.Material): THREE.Mesh {
  return sh(new THREE.Mesh(new THREE.ConeGeometry(r, h, segs), mat))
}
function sphere(r: number, segs: number, mat: THREE.Material): THREE.Mesh {
  return sh(new THREE.Mesh(new THREE.SphereGeometry(r, segs, segs), mat))
}

function place(parent: THREE.Object3D | THREE.Scene, mesh: Obj3D, x: number, y: number, z: number, ry = 0) {
  mesh.position.set(x, y, z); mesh.rotation.y = ry; parent.add(mesh); return mesh
}

// ─── Landmark: Creature Home ──────────────────────────────────────────────────
function buildHome(scene: THREE.Scene, hFn: (x:number,z:number)=>number): THREE.PointLight {
  const bx = V.home.x, bz = V.home.z, by = hFn(bx, bz)
  const g  = new THREE.Group(); g.position.set(bx, by, bz); scene.add(g)

  // Stone foundation
  place(g, box(5.6, 0.3, 4.8, M(0x9e9080)), 0, 0.15, 0)
  // Walls (warm cream plaster)
  place(g, box(5.0, 2.6, 4.2, M(0xefd8b0)), 0, 1.45, 0)
  // Roof (dark terracotta)
  const roof = cone(3.8, 2.8, 4, M(0x8B4513)); roof.position.set(0, 3.8, 0); g.add(roof)
  // Chimney
  place(g, cyl(0.28, 0.28, 1.4, 6, M(0x808080)), -1.5, 4.7, -1.2)
  // Door
  place(g, box(0.85, 1.55, 0.12, M(0x5c3317)), 0, 1.0, 2.17)
  // Door arch
  place(g, box(1.1, 0.3, 0.12, M(0x8B4513)), 0, 1.9, 2.17)
  // Windows
  ;[-1.5, 1.5].forEach(xo => {
    place(g, box(0.9, 0.75, 0.12, M(0x87ceeb, { transparent: true, opacity: 0.85 })), xo, 1.6, 2.17)
    place(g, box(0.95, 0.8, 0.1, M(0x5c3317)), xo, 1.6, 2.14)
  })
  // Interior warm light
  // Interior warm light — starts off, turned on at night by engine
  const fl = new THREE.PointLight(0xff9955, 0, 10); fl.position.set(bx, by + 1.5, bz); scene.add(fl)
  // Sign above door
  place(g, box(1.4, 0.4, 0.12, M(0x7a5c3a)), 0, 2.4, 2.17)
  // Path stones to door
  for (let i = 0; i < 4; i++) {
    place(g, box(0.9, 0.08, 0.7, M(0xb0a890)), 0, 0.02, 3.0 + i * 1.0)
  }
  // Flower pots
  ;[-2.8, 2.8].forEach(xo => {
    place(g, cyl(0.18, 0.22, 0.35, 6, M(0x9e5030)), xo, 0.18, 2.5)
    place(g, sphere(0.2, 8, M(0xe84040)), xo, 0.55, 2.5)
  })
  return fl
}

// ─── Landmark: Training Hall ──────────────────────────────────────────────────
function buildTrainingHall(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
  const bx = V.training.x, bz = V.training.z, by = hFn(bx, bz)
  const g  = new THREE.Group(); g.position.set(bx, by, bz); scene.add(g)

  // Main building
  place(g, box(11.0, 0.3, 9.0, M(0x7a6a50)), 0, 0.15, 0)
  place(g, box(10.0, 3.2, 8.0, M(0x8b7355)), 0, 1.75, 0)
  // Roof overhang
  place(g, box(11.5, 0.45, 9.5, M(0x5a3d20)), 0, 3.42, 0)
  place(g, box(11.0, 0.35, 9.0, M(0x4a2e15)), 0, 3.65, 0)
  // Entrance columns
  ;[-3.5, 3.5].forEach(xo => {
    place(g, cyl(0.28, 0.32, 3.5, 8, M(0x9e8870)), xo, 1.75, 4.2)
    place(g, box(0.7, 0.25, 0.7, M(0x9e8870)), xo, 3.42, 4.2)
  })
  // Banner pole + banner
  place(g, cyl(0.07, 0.07, 5.5, 6, M(0x5c3d20)), 0, 2.75, -5.5)
  const banner = box(2.2, 3.0, 0.08, M(0x8b1a1a))
  place(g, banner, 1.1, 5.0, -5.5)
  // Training dummy
  place(g, cyl(0.12, 0.12, 2.0, 6, M(0x6b4226)), 3.5, 1.0, -2.5)
  place(g, sphere(0.35, 10, M(0x8b6a45)), 3.5, 2.25, -2.5)
  place(g, box(1.4, 0.2, 0.15, M(0x8b6a45)), 3.5, 1.5, -2.5)  // arms
  // Weights (barbell style)
  ;[-2.0, -3.5].forEach(xi => {
    place(g, cyl(0.35, 0.35, 0.18, 8, M(0x444444)), xi, 0.18, -3.5)
    place(g, cyl(0.12, 0.12, 1.6, 6, M(0x555555)), xi, 0.18, -3.5)
  })
  // Steps
  for (let s = 0; s < 3; s++) {
    place(g, box(4.0 - s * 0.4, 0.25, 0.5, M(0x9e8870)), 0, 0.12 + s * 0.25, 4.0 + s * 0.5)
  }
}

// ─── Landmark: Memory Grove ───────────────────────────────────────────────────
function buildMemoryGrove(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
  const bx = V.grove.x, bz = V.grove.z, by = hFn(bx, bz)

  // Stone path entrance
  for (let i = 0; i < 5; i++) {
    const px = bx - 0.3 + (Math.sin(i) * 0.5)
    const pz = bz - 6 + i * 1.2
    const pm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.9), M(0xb0a890))
    pm.position.set(px, hFn(px, pz) + 0.06, pz); pm.receiveShadow = true; scene.add(pm)
  }

  // Memorial stones — each represents a milestone
  const stones = [
    { dx: -2, dz: -2, h: 1.1, label: 'First Week'    },
    { dx:  2, dz: -1, h: 1.4, label: '30-Day Streak' },
    { dx:  0, dz:  2, h: 1.8, label: 'First Goal'    },
    { dx: -3, dz:  1, h: 1.0, label: 'Comeback'      },
    { dx:  3, dz:  2, h: 1.2, label: 'Milestone'     },
  ]
  stones.forEach(({ dx, dz, h }) => {
    const sx = bx + dx, sz = bz + dz, sy = hFn(sx, sz)
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.5), M(0x9e9080))
    base.position.set(sx, sy + 0.07, sz); base.receiveShadow = true; scene.add(base)
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.48, h, 0.36), M(0xb8b0a8))
    stone.position.set(sx, sy + 0.15 + h / 2, sz); stone.castShadow = true; scene.add(stone)
    // Engraving line
    const eng = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.05), M(0x706860))
    eng.position.set(sx, sy + 0.15 + h * 0.7, sz + 0.19); scene.add(eng)
  })

  // Grove trees
  const treeSpots = [{ dx:-4,dz:-3 },{ dx:4,dz:-2 },{ dx:-3,dz:3 },{ dx:4,dz:4 },{ dx:0,dz:4 }]
  treeSpots.forEach(({ dx, dz }) => addStylizedTree(scene, bx + dx, bz + dz, hFn))

  // Stone bench
  const bench = { x: bx, z: bz + 0.5 }
  ;[-0.7, 0.7].forEach(xo => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.5), M(0x9e9080))
    leg.position.set(bench.x + xo, hFn(bench.x, bench.z) + 0.27, bench.z); scene.add(leg)
  })
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 0.55), M(0xc8b898))
  seat.position.set(bench.x, hFn(bench.x, bench.z) + 0.55, bench.z); scene.add(seat)
}

// ─── Landmark: Achievement Plaza ──────────────────────────────────────────────
function buildAchievementPlaza(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
  const bx = V.plaza.x, bz = V.plaza.z, by = hFn(bx, bz)
  const g  = new THREE.Group(); g.position.set(bx, by, bz); scene.add(g)

  // Stone floor
  place(g, box(12, 0.2, 12, M(0xa0a0a0)), 0, 0.1, 0)
  // Border trim
  ;[[-5.5,0],[ 5.5,0],[0,-5.5],[0, 5.5]].forEach(([xo, zo]) => {
    place(g, box(Math.abs(zo)>1 ? 12 : 0.5, 0.35, Math.abs(xo)>1 ? 12 : 0.5, M(0x808080)), xo, 0.27, zo)
  })

  // Central podium
  place(g, cyl(1.8, 2.0, 0.5,  8, M(0xb8b8c8)), 0, 0.45, 0)
  place(g, cyl(1.4, 1.6, 0.5,  8, M(0xc8c8d8)), 0, 0.95, 0)
  place(g, cyl(1.0, 1.2, 0.45, 8, M(0xd8d8e8)), 0, 1.42, 0)
  // Trophy statue
  place(g, cyl(0.22, 0.22, 1.4, 8, M(0xd4a840)), 0, 2.35, 0)
  place(g, sphere(0.42, 12, M(0xd4a840)), 0, 3.42, 0)
  // Star ring on statue
  const starM = EM(0xffd060, 0.8)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const s = sphere(0.08, 6, starM)
    s.position.set(Math.cos(a) * 0.52, 3.6, Math.sin(a) * 0.52); g.add(s)
  }

  // Corner pillars with banners
  ;[[-4.5,-4.5],[ 4.5,-4.5],[-4.5, 4.5],[4.5, 4.5]].forEach(([xo, zo], i) => {
    place(g, cyl(0.25, 0.28, 4.5, 7, M(0x909090)), xo, 2.45, zo)
    place(g, box(0.6, 0.3, 0.6, M(0x909090)), xo, 4.85, zo)
    const bannerColor = [0x8b1a1a, 0x1a4a8b, 0x1a8b2a, 0x8b6a1a][i]
    const b = box(0.8, 2.0, 0.08, M(bannerColor))
    b.position.set(xo, 3.5, zo + (zo > 0 ? 0.35 : -0.35)); b.rotation.y = zo > 0 ? 0 : Math.PI; g.add(b)
  })
}

interface RexRefs { glowLights: THREE.PointLight[]; worldPos: THREE.Vector3 }

// ─── Landmark: Rex Sanctuary ──────────────────────────────────────────────────
function buildRexSanctuary(scene: THREE.Scene, hFn: (x:number,z:number)=>number): RexRefs {
  const bx = V.rex.x, bz = V.rex.z, by = hFn(bx, bz)
  const g  = new THREE.Group(); g.position.set(bx, by, bz); scene.add(g)

  // Raised platform
  place(g, box(10, 0.45, 8, M(0x9e8870)), 0, 0.22, 0)
  // Four columns
  ;[[-3.5,-3],[ 3.5,-3],[-3.5, 3],[3.5, 3]].forEach(([xo, zo]) => {
    place(g, cyl(0.3, 0.35, 3.8, 8, M(0xd0c4b0)), xo, 2.35, zo)
    place(g, box(0.75, 0.22, 0.75, M(0xc0b4a0)), xo, 4.35, zo)
  })
  // Roof
  place(g, box(9.0, 0.35, 7.0, M(0x6b4226)), 0, 4.55, 0)
  place(g, box(9.5, 0.2, 7.5, M(0x5a3818)), 0, 4.74, 0)
  // REX coaching chair
  place(g, box(1.8, 0.35, 1.5, M(0x5a3818)), 0, 0.62, -2.0)
  place(g, box(1.6, 1.5,  0.2, M(0x6b4226)), 0, 1.37, -2.8)
  place(g, box(0.4, 1.4,  1.4, M(0x5a3818)), -0.7, 1.15, -2.0)
  place(g, box(0.4, 1.4,  1.4, M(0x5a3818)),  0.7, 1.15, -2.0)
  // Large banner with Rex identity
  place(g, cyl(0.08, 0.08, 6.0, 6, M(0x5a3818)), 0, 3.45, -4.6)
  place(g, box(3.5, 4.0, 0.1, M(0x8b1a1a)), 1.75, 6.0, -4.6)
  // Wisdom stones — green glow, pulsed by engine
  const glowLights: THREE.PointLight[] = []
  ;[-3.5, 3.5].forEach(xo => {
    place(g, box(0.6, 1.2, 0.45, M(0x1a2a1a)), xo, 1.05, 2.5)
    const glow = new THREE.PointLight(0x44ff88, 1.0, 8)
    glow.position.set(bx + xo, by + 2.2, bz + 2.5)
    scene.add(glow)
    glowLights.push(glow)
  })
  return { glowLights, worldPos: new THREE.Vector3(bx, by + 2.5, bz) }
}

// ─── Landmark: Commitment Shrine ─────────────────────────────────────────────
function buildCommitmentShrine(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
  const bx = V.shrine.x, bz = V.shrine.z, by = hFn(bx, bz)
  const g  = new THREE.Group(); g.position.set(bx, by, bz); scene.add(g)

  // Stepped altar base
  for (let s = 0; s < 3; s++) {
    const w = 5.5 - s, d = 4.5 - s
    place(g, box(w, 0.42, d, M(0xb0a890)), 0, s * 0.42 + 0.21, 0)
  }
  // Central crystal
  const crystal = EM(0x60a0ff, 0.9)
  const cry = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), crystal)
  cry.position.set(0, 2.2, 0); cry.castShadow = true; g.add(cry)
  const crystalLight = new THREE.PointLight(0x60a0ff, 1.2, 8)
  crystalLight.position.set(bx, by + 2.5, bz); scene.add(crystalLight)
  // Goal marker stones (angled outward)
  const angles = [0, Math.PI * 0.4, Math.PI * 0.8, Math.PI * 1.2, Math.PI * 1.6]
  angles.forEach(a => {
    const mx = Math.sin(a) * 2.5, mz = Math.cos(a) * 2.5
    const mk = box(0.32, 1.8, 0.24, M(0x9090d0))
    mk.position.set(mx, 1.4, mz); mk.rotation.z = a * 0.2; g.add(mk)
  })
  // Arch
  place(g, cyl(0.25, 0.3, 3.8, 7, M(0xc0b4d0)), -1.8, 2.0, 3.5)
  place(g, cyl(0.25, 0.3, 3.8, 7, M(0xc0b4d0)),  1.8, 2.0, 3.5)
  place(g, box(4.0, 0.45, 0.5, M(0xd0c8e0)), 0, 3.97, 3.5)
}

// ─── Landmark: Journey Tower ──────────────────────────────────────────────────
function buildJourneyTower(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
  const bx = V.tower.x, bz = V.tower.z, by = hFn(bx, bz)
  const g  = new THREE.Group(); g.position.set(bx, by, bz); scene.add(g)

  // Tower base
  place(g, box(5.5, 0.4, 5.5, M(0x808080)), 0, 0.2, 0)
  // Tower shaft (stacked sections)
  const shaftH = [3.5, 3.2, 2.8, 2.5]
  let yAcc = 0.4
  const shaftWidths = [2.8, 2.4, 2.0, 1.7]
  shaftH.forEach((h, i) => {
    place(g, box(shaftWidths[i], h, shaftWidths[i], M(0x909090)), 0, yAcc + h/2, 0)
    place(g, box(shaftWidths[i] + 0.4, 0.3, shaftWidths[i] + 0.4, M(0x787878)), 0, yAcc + h, 0)
    yAcc += h + 0.3
  })
  // Top spire
  place(g, cone(1.1, 3.0, 6, M(0x8b1a1a)), 0, yAcc + 1.5, 0)
  // Beacon light at top
  const beacon = new THREE.PointLight(0xffd060, 2.0, 30)
  beacon.position.set(bx, by + yAcc + 1.5, bz); scene.add(beacon)
  // Balcony arches (mid-tower)
  const midY = 7.0
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const bm = box(0.3, 0.8, 0.3, M(0x808080))
    bm.position.set(Math.sin(a) * 1.5, midY, Math.cos(a) * 1.5); g.add(bm)
  }
  // Corner base buttresses
  ;[[-2.2,-2.2],[2.2,-2.2],[-2.2,2.2],[2.2,2.2]].forEach(([xo, zo]) => {
    place(g, box(0.7, 4.5, 0.7, M(0x8a8a8a)), xo, 2.25, zo)
  })
  // Entry steps
  for (let s = 0; s < 4; s++) {
    place(g, box(3.5 - s * 0.3, 0.25, 0.5, M(0x888880)), 0, s * 0.25 + 0.12, 3.0 - s * 0.5)
  }
}

// ─── Village Center: Campfire ─────────────────────────────────────────────────
function buildCampfire(scene: THREE.Scene, hFn: (x:number,z:number)=>number): THREE.PointLight {
  const bx = V.center.x, bz = V.center.z, by = hFn(bx, bz)
  const g  = new THREE.Group(); g.position.set(bx, by, bz); scene.add(g)

  // Stone ring
  for (let i = 0; i < 10; i++) {
    const a  = (i / 10) * Math.PI * 2
    const sx = Math.cos(a) * 1.2, sz = Math.sin(a) * 1.2
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(0.4 + Math.random() * 0.2, 0.3 + Math.random() * 0.15, 0.4),
      M(0x8a8a80)
    )
    stone.position.set(sx, 0.15, sz); stone.rotation.y = a; stone.castShadow = true; g.add(stone)
  }
  // Crossed logs
  ;[0.4, -0.4].forEach(a => {
    const log = cyl(0.1, 0.12, 2.2, 6, M(0x5c3317))
    log.rotation.z = a; log.position.y = 0.25; g.add(log)
  })
  // Flame (emissive cone)
  const flame1 = cone(0.28, 0.9, 5, EM(0xff6010, 0.9))
  const flame2 = cone(0.18, 1.2, 5, EM(0xffa020, 0.8))
  const flame3 = cone(0.12, 0.7, 5, EM(0xffee80, 1.0))
  place(g, flame1, 0, 0.6, 0)
  place(g, flame2, 0.1, 0.55, 0.05)
  place(g, flame3, -0.05, 0.65, -0.08)

  // Campfire light (animating done in loop)
  const light = new THREE.PointLight(0xff7722, 1.8, 14)
  light.position.set(bx, by + 0.9, bz); scene.add(light)

  // Benches around fire
  const benchAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]
  benchAngles.forEach(a => {
    const bsx = Math.cos(a) * 2.4, bsz = Math.sin(a) * 2.4
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.55), M(0xc8b898))
    bench.position.set(bsx, 0.35, bsz); bench.rotation.y = a + Math.PI/2; bench.castShadow = true; g.add(bench)
  })
  return light
}

// ─── Roads between landmarks ──────────────────────────────────────────────────
function buildRoads(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
  const roadMat = M(0xc8b070)
  const connections: Array<[{x:number;z:number},{x:number;z:number}]> = [
    [V.center, V.home], [V.center, V.training], [V.center, V.grove],
    [V.center, V.plaza], [V.center, V.rex],     [V.center, V.shrine],
    [V.shrine, V.tower], [V.rex, V.tower],
  ]
  connections.forEach(([a, b]) => {
    const steps = 18
    for (let i = 0; i < steps; i++) {
      const t  = i / steps
      const rx = a.x + (b.x - a.x) * (t + 0.5 / steps)
      const rz = a.z + (b.z - a.z) * (t + 0.5 / steps)
      const ry = hFn(rx, rz) + 0.04
      const seg = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 1.0), roadMat)
      seg.position.set(rx, ry, rz)
      seg.rotation.y = Math.atan2(b.x - a.x, b.z - a.z)
      seg.receiveShadow = true; scene.add(seg)
    }
  })
}

// ─── Lanterns along roads ─────────────────────────────────────────────────────
function buildLanterns(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
  const spots: Array<{x:number;z:number}> = []
  // Place lanterns midway on each road
  Object.values(V).forEach(landmark => {
    if (landmark === V.center) return
    spots.push({ x: (V.center.x + landmark.x) / 2, z: (V.center.z + landmark.z) / 2 })
  })
  // Extra lanterns in village
  spots.push({ x:-5, z:2 }, { x:5, z:-3 }, { x:-2, z:-5 }, { x:3, z:5 })

  spots.forEach(({ x, z }) => {
    const y = hFn(x, z)
    const pole = cyl(0.05, 0.06, 2.4, 6, M(0x5c3317))
    pole.position.set(x, y + 1.2, z); scene.add(pole)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.38, 0.35), M(0xd4aa50, { transparent: true, opacity: 0.85 }))
    head.position.set(x, y + 2.55, z); scene.add(head)
    const light = new THREE.PointLight(0xffdd88, 0.65, 6)
    light.position.set(x, y + 2.5, z); scene.add(light)
  })
}

// ─── Instanced trees (background scenery) ────────────────────────────────────
function addStylizedTree(scene: THREE.Scene, wx: number, wz: number, hFn: (x:number,z:number)=>number) {
  const wy   = hFn(wx, wz)
  const sc   = 0.9 + Math.abs(Math.sin(wx * 0.7 + wz)) * 0.5
  const g    = new THREE.Group(); g.position.set(wx, wy, wz); scene.add(g)
  place(g, cyl(0.13*sc, 0.19*sc, 2.0*sc, 7, M(0x6b4226)), 0, sc, 0)
  const greens = [0x2d6b22, 0x3a7c2a, 0x4e8c38]
  ;[0, 0.95, 1.8].forEach((yo, i) => {
    const r = (1.7 - i * 0.3) * sc
    place(g, cone(r, 1.9*sc, 8, M(greens[i])), 0, (2.0 + yo) * sc, 0)
  })
}

function scatterBackgroundTrees(scene: THREE.Scene, hFn: (x:number,z:number)=>number, tN: (x:number,y:number)=>number) {
  const halfW = WORLD / 2 - 12
  for (let wx = -halfW; wx < halfW; wx += 14) {
    for (let wz = -halfW; wz < halfW; wz += 14) {
      const dist = Math.sqrt(wx*wx + wz*wz)
      if (dist < 28) continue  // no trees inside village
      const jx = wx + tN(wx*.09, wz*.09+50) * 12
      const jz = wz + tN(wx*.09+80, wz*.09) * 12
      const h  = hFn(jx, jz)
      if (h < 2.5 || h > 8.5 || tN(jx/16, jz/16) < 0.1) continue
      addStylizedTree(scene, jx, jz, hFn)
    }
  }
}

// ─── Grass billboards ─────────────────────────────────────────────────────────
function scatterGrass(hFn:(x:number,z:number)=>number, tN:(x:number,y:number)=>number): THREE.InstancedMesh {
  const mesh  = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.5, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x5aaa40, side: THREE.DoubleSide, transparent: true, alphaTest: 0.08 }),
    6000
  )
  const dummy = new THREE.Object3D(); let idx = 0
  while (idx < 3000) {
    const wx = (Math.random() - 0.5) * (WORLD - 24)
    const wz = (Math.random() - 0.5) * (WORLD - 24)
    const h  = hFn(wx, wz)
    if (h < 0.6 || h > 7.5 || tN(wx/7, wz/7) < -0.3) continue
    const sc = 0.55 + Math.random() * 0.9
    dummy.position.set(wx, h + 0.36*sc, wz); dummy.scale.setScalar(sc)
    dummy.rotation.set(0, Math.random() * Math.PI, 0); dummy.updateMatrix()
    mesh.setMatrixAt(idx*2, dummy.matrix)
    dummy.rotation.y += Math.PI/2; dummy.updateMatrix()
    mesh.setMatrixAt(idx*2+1, dummy.matrix)
    idx++
  }
  mesh.count = 6000; mesh.instanceMatrix.needsUpdate = true; return mesh
}

// ─── Water ────────────────────────────────────────────────────────────────────
function buildWater(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD).rotateX(-Math.PI/2) as THREE.BufferGeometry,
    new THREE.MeshLambertMaterial({ color: 0x2a90d0, transparent: true, opacity: 0.78 })
  )
  mesh.position.y = 0.4; return mesh
}

// ─── Sky dome ─────────────────────────────────────────────────────────────────
function buildSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(0x1565c0) }, bottom: { value: new THREE.Color(0x90caf9) } },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
      void main() {
        float h = clamp(vPos.y/148.,0.,1.);
        gl_FragColor = vec4(mix(bottom,top,pow(h,.6)),1.);
      }
    `,
    side: THREE.BackSide,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(148, 32, 16), mat)
}

// ─── Kivo creature ────────────────────────────────────────────────────────────
interface Kivo {
  group: THREE.Group
  body:  THREE.Mesh
  head:  THREE.Group
  eyeL:  THREE.Mesh; eyeR: THREE.Mesh
  earL:  THREE.Mesh; earR: THREE.Mesh
  tail:  THREE.Mesh
  wL:    THREE.Mesh; wR: THREE.Mesh
}

function buildKivo(): Kivo {
  const g    = new THREE.Group()
  const teal = M(0x1a9e8c); const pale = M(0x8adfd5)
  const dark = M(0x0d7060); const eW   = M(0xfafafa)
  const eB   = new THREE.MeshBasicMaterial({ color: 0x00d4ff })
  const eP   = new THREE.MeshBasicMaterial({ color: 0x050a14 })
  const wMat = M(0x0e8a7a, { transparent: true, opacity: 0.82 })

  const body = sh(new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), teal))
  body.scale.set(1, 0.88, 1); body.position.y = 0.52; g.add(body)
  const belly = sh(new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), pale))
  belly.scale.set(0.88, 0.72, 0.5); belly.position.set(0, 0.48, 0.2); g.add(belly)

  const headGroup = new THREE.Group(); headGroup.position.set(0, 1.05, 0.14); g.add(headGroup)
  const hd = sh(new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), teal)); headGroup.add(hd)
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), pale)
  snout.scale.set(0.9, 0.6, 0.75); snout.position.set(0, -0.08, 0.38); headGroup.add(snout)

  const mkEye = (xo: number): THREE.Mesh => {
    const eg = new THREE.Group()
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), eW)
    const ir= new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eB); ir.position.z = 0.05
    const pu= new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 8), eP); pu.position.z = 0.085
    eg.add(w, ir, pu); eg.position.set(xo, 0.08, 0.38); headGroup.add(eg); return w
  }
  const eyeL = mkEye(-0.17), eyeR = mkEye(0.17)

  const earL = sh(new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.3, 5), dark))
  earL.position.set(-0.22, 0.36, -0.06); earL.rotation.z = -0.35; headGroup.add(earL)
  const earR = sh(new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.3, 5), dark))
  earR.position.set( 0.22, 0.36, -0.06); earR.rotation.z =  0.35; headGroup.add(earR)

  const tail = sh(new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.72, 8), teal))
  tail.position.set(0, 0.4, -0.5); tail.rotation.x = -0.75; g.add(tail)

  const mkWing = (xo: number, flip: boolean) => {
    const geo = new THREE.BufferGeometry()
    const v = flip
      ? new Float32Array([0,0,0, -0.72,0.28,-0.05, -0.42,0.62,0.08])
      : new Float32Array([0,0,0,  0.72,0.28,-0.05,  0.42,0.62,0.08])
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3)); geo.computeVertexNormals()
    const w = new THREE.Mesh(geo, wMat); w.position.set(xo, 0.72, -0.1); g.add(w); return w
  }
  const wL = mkWing(-0.45, true), wR = mkWing(0.45, false)

  const legM = M(0x0d6e5f)
  ;[-0.22, 0.22].forEach(xo => {
    const leg = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.32, 6), legM))
    leg.position.set(xo, 0.14, 0.12); leg.rotation.z = xo > 0 ? 0.18 : -0.18; g.add(leg)
  })

  return { group: g, body, head: headGroup, eyeL, eyeR, earL, earR, tail, wL, wR }
}

// ─── Day/night palette ────────────────────────────────────────────────────────
type SkyStop = { t:number; top:number; bot:number; sun:number; amb:number }
const SKY_STOPS: SkyStop[] = [
  { t: 0,  top:0x030820, bot:0x0a1830, sun:0.15, amb:0.40 },
  { t: 5,  top:0x0a1040, bot:0x1a1555, sun:0.18, amb:0.44 },
  { t: 6,  top:0x7a2010, bot:0xf09060, sun:0.80, amb:0.65 },
  { t: 8,  top:0x1455c0, bot:0x82caf8, sun:2.00, amb:0.90 },
  { t: 14, top:0x0e45b0, bot:0x72baf4, sun:2.20, amb:0.95 },
  { t: 17, top:0x1a3080, bot:0xf09060, sun:1.60, amb:0.80 },
  { t: 19, top:0x060820, bot:0x2a1540, sun:0.35, amb:0.45 },
  { t: 24, top:0x030820, bot:0x0a1830, sun:0.15, amb:0.40 },
]
function lerpSky(t: number): SkyStop {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const a=SKY_STOPS[i], b=SKY_STOPS[i+1]
    if (t>=a.t && t<b.t) {
      const p=(t-a.t)/(b.t-a.t)
      return { t, top:new THREE.Color(a.top).lerp(new THREE.Color(b.top),p).getHex(),
        bot:new THREE.Color(a.bot).lerp(new THREE.Color(b.bot),p).getHex(),
        sun:a.sun+(b.sun-a.sun)*p, amb:a.amb+(b.amb-a.amb)*p }
    }
  }
  return SKY_STOPS[0]
}

// ─── Engine class ─────────────────────────────────────────────────────────────
export class BabylonVoxelEngine {
  private renderer:    THREE.WebGLRenderer
  private scene:       THREE.Scene
  private camera:      THREE.PerspectiveCamera
  private sun:         THREE.DirectionalLight
  private hemi:        THREE.HemisphereLight
  private ambient:     THREE.AmbientLight
  private skyDome:     THREE.Mesh
  private water:       THREE.Mesh
  private campfire:    THREE.PointLight
  private kivo:        Kivo
  private heightFn:    (x:number,z:number)=>number
  private camPos     = new THREE.Vector3(0, 9, 14)
  private camLook    = new THREE.Vector3(0, 2, 0)
  private cameraYaw  = 0                       // controlled externally
  private kivoX      = 0
  private kivoZ      = 0
  private targetX    = 0
  private targetZ    = 0
  private wpIndex    = 0
  private wpTimer    = 0
  private wpDwellSec = 0       // how long to stay at current waypoint (seconds)
  private kivoActivity = 'Kivo is resting.'
  public  onActivityChange: ((text: string) => void) | null = null
  private realTime   = 14
  private clock      = new THREE.Clock()
  private frame:     number | null = null
  private ro:        ResizeObserver

  // Intro camera reveal
  private introRevealActive   = false
  private introRevealTimer    = 0
  private readonly introRevealDuration = 5.5  // seconds

  // Ambient / environment
  private houseLampLight: THREE.PointLight | null = null
  private rexGlowLights:  THREE.PointLight[]     = []
  private rexWorldPos:    THREE.Vector3           = new THREE.Vector3()
  private fireflyPoints:  THREE.Points  | null    = null
  private fireflyVels:    Float32Array  | null    = null
  private worldHealth = 85

  // Kivo state & aura
  private currentBehavior = 'sit'
  private kivoAura: THREE.Mesh | null = null

  // Cinematic camera
  private cinemaMode: 'following' | 'panning' | 'holding' | 'returning' = 'following'
  private cinemaTimer   = 0          // ms in current mode
  private cinemaInterval = 45_000 + Math.random() * 30_000  // ms between cinematics
  private cinemaPanPos  = new THREE.Vector3()
  private cinemaPanLook = new THREE.Vector3()

  // Rex sanctuary click
  public  onRexSanctuaryClick: (() => void) | null = null
  private raycaster = new THREE.Raycaster()

  constructor(canvas: HTMLCanvasElement, userSeed: string, _u: BiomeType[], _w: number) {
    const rect = canvas.getBoundingClientRect()
    const W = rect.width || canvas.clientWidth || 800
    const H = rect.height || canvas.clientHeight || 600

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(W, H, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x82caf8, 60, 140)

    this.camera = new THREE.PerspectiveCamera(65, W/H, 0.1, 160)
    this.camera.position.copy(this.camPos)

    const seed = strSeed(userSeed)
    const hNoise = createNoise2D(mulberry32(seed))
    const tNoise = createNoise2D(mulberry32(seed ^ 0xdeadbeef))
    this.heightFn = makeHeightFn(hNoise)

    // Sky + terrain
    this.skyDome = buildSkyDome(); this.scene.add(this.skyDome)
    this.scene.add(buildTerrain(this.heightFn))
    this.water = buildWater(); this.scene.add(this.water)

    // Village landmarks — capture refs for dynamic effects
    this.houseLampLight = buildHome(this.scene, this.heightFn)
    buildTrainingHall(this.scene, this.heightFn)
    buildMemoryGrove(this.scene, this.heightFn)
    buildAchievementPlaza(this.scene, this.heightFn)
    const rexRefs = buildRexSanctuary(this.scene, this.heightFn)
    this.rexGlowLights = rexRefs.glowLights
    this.rexWorldPos   = rexRefs.worldPos
    buildCommitmentShrine(this.scene, this.heightFn)
    buildJourneyTower(this.scene, this.heightFn)
    this.campfire = buildCampfire(this.scene, this.heightFn)
    buildRoads(this.scene, this.heightFn)
    buildLanterns(this.scene, this.heightFn)

    // Background
    scatterBackgroundTrees(this.scene, this.heightFn, tNoise)
    this.scene.add(scatterGrass(this.heightFn, tNoise))

    // Kivo — spawn at a random landmark each load
    this.wpIndex = Math.floor(Math.random() * WAYPOINTS.length)
    const spawnWP = WAYPOINTS[this.wpIndex]
    this.kivoX   = spawnWP.x + (Math.random() - 0.5) * 1.5
    this.kivoZ   = spawnWP.z + (Math.random() - 0.5) * 1.5
    this.targetX = this.kivoX
    this.targetZ = this.kivoZ
    // Stay at spawn for 4-8 minutes before first move
    this.wpDwellSec = 240 + Math.random() * 240
    this.wpTimer    = 0
    this.kivoActivity = ACTIVITY_TEXT[spawnWP.label]?.[0] ?? 'Kivo is resting.'

    this.kivo = buildKivo()
    this.kivo.group.position.set(this.kivoX, this.heightFn(this.kivoX, this.kivoZ), this.kivoZ)
    this.scene.add(this.kivo.group)

    // Kivo aura glow sphere
    const auraMat = new THREE.MeshBasicMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.06, side: THREE.FrontSide })
    this.kivoAura = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), auraMat)
    this.kivoAura.position.y = 0.65
    this.kivo.group.add(this.kivoAura)

    // Fireflies
    this.buildFireflies()

    // Rex Sanctuary click detection
    this.setupClickDetection(canvas)

    // Lighting
    this.hemi   = new THREE.HemisphereLight(0x87ceeb, 0x4a6e2a, 0.85); this.scene.add(this.hemi)
    this.ambient= new THREE.AmbientLight(0xfff5e0, 0.85); this.scene.add(this.ambient)
    this.sun    = new THREE.DirectionalLight(0xfff8e7, 2.1)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const ssh = this.sun.shadow.camera as THREE.OrthographicCamera
    ssh.left=ssh.bottom=-80; ssh.right=ssh.top=80
    this.sun.shadow.camera.near=0.5; this.sun.shadow.camera.far=200
    this.scene.add(this.sun)

    this.ro = new ResizeObserver(() => {
      const w=canvas.clientWidth, h=canvas.clientHeight; if(!w||!h) return
      this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix()
    })
    this.ro.observe(canvas)
    this.loop()
  }

  // ── Kivo autonomous routine ───────────────────────────────────────────────────
  private isWalkingToWaypoint = false

  private updateKivoRoutine(dt: number) {
    const dx = this.targetX - this.kivoX
    const dz = this.targetZ - this.kivoZ
    const dist = Math.sqrt(dx*dx + dz*dz)

    if (dist > 0.5) {
      // Currently walking — move toward target
      this.isWalkingToWaypoint = true
      const speed = 2.2
      this.kivoX += (dx/dist) * speed * dt
      this.kivoZ += (dz/dist) * speed * dt
    } else {
      // Arrived (or at spawn) — count dwell time
      if (this.isWalkingToWaypoint) {
        // Just arrived — set dwell time and update activity
        this.isWalkingToWaypoint = false
        const wp = WAYPOINTS[this.wpIndex]
        const [min, max] = DWELL[wp.label] ?? [240, 360]
        this.wpDwellSec = min + Math.random() * (max - min)
        this.wpTimer    = 0
        this.currentBehavior = wp.label
        const text = pickActivity(wp.label)
        this.kivoActivity = text
        this.onActivityChange?.(text)
      }

      this.wpTimer += dt

      if (this.wpTimer >= this.wpDwellSec) {
        // Dwell done — pick a random different waypoint
        let nextIdx: number
        do { nextIdx = Math.floor(Math.random() * WAYPOINTS.length) }
        while (nextIdx === this.wpIndex && WAYPOINTS.length > 1)
        this.wpIndex = nextIdx
        this.targetX = WAYPOINTS[nextIdx].x + (Math.random()-0.5)*1.5
        this.targetZ = WAYPOINTS[nextIdx].z + (Math.random()-0.5)*1.5
        this.wpTimer = 0
        const walkText = pickActivity('walking')
        this.kivoActivity = walkText
        this.onActivityChange?.(walkText)
      }
    }
  }

  // ── Firefly particle system ────────────────────────────────────────────────────
  private buildFireflies() {
    const count = 60
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i*3+0] = (Math.random() - 0.5) * 70
      pos[i*3+1] = 1.2 + Math.random() * 4
      pos[i*3+2] = (Math.random() - 0.5) * 70
      vel[i*3+0] = (Math.random() - 0.5) * 0.008
      vel[i*3+1] = (Math.random() - 0.5) * 0.004
      vel[i*3+2] = (Math.random() - 0.5) * 0.008
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ color: 0xaaff55, size: 0.18, transparent: true, opacity: 0, sizeAttenuation: true })
    this.fireflyPoints = new THREE.Points(geo, mat)
    this.fireflyVels   = vel
    this.scene.add(this.fireflyPoints)
  }

  private updateFireflies(t: number) {
    if (!this.fireflyPoints || !this.fireflyVels) return
    const isNight = this.realTime > 20 || this.realTime < 6
    const mat = this.fireflyPoints.material as THREE.PointsMaterial
    const targetOpacity = isNight ? 0.75 : 0
    mat.opacity += (targetOpacity - mat.opacity) * 0.02
    if (mat.opacity < 0.01 && !isNight) return  // skip position update when invisible

    const attr = this.fireflyPoints.geometry.attributes.position as THREE.BufferAttribute
    const arr  = attr.array as Float32Array
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i*3+0] += this.fireflyVels![i*3+0] + Math.sin(t * 0.7 + i) * 0.003
      arr[i*3+1] += Math.sin(t * 0.9 + i * 0.5) * 0.004
      arr[i*3+2] += this.fireflyVels![i*3+2] + Math.cos(t * 0.6 + i) * 0.003
      // Soft boundary wrap
      if (arr[i*3+0] >  38) arr[i*3+0] = -38
      if (arr[i*3+0] < -38) arr[i*3+0] =  38
      if (arr[i*3+2] >  38) arr[i*3+2] = -38
      if (arr[i*3+2] < -38) arr[i*3+2] =  38
    }
    attr.needsUpdate = true
  }

  // ── Rex Sanctuary click ────────────────────────────────────────────────────────
  private setupClickDetection(canvas: HTMLCanvasElement) {
    canvas.addEventListener('click', (e) => {
      if (!this.onRexSanctuaryClick) return
      const rect = canvas.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
        ((e.clientY - rect.top)  / rect.height) * -2 + 1,
      )
      this.raycaster.setFromCamera(mouse, this.camera)
      // Distance-based test: did the ray pass near Rex Sanctuary?
      const closest = new THREE.Vector3()
      this.raycaster.ray.closestPointToPoint(this.rexWorldPos, closest)
      if (closest.distanceTo(this.rexWorldPos) < 5) this.onRexSanctuaryClick()
    })
  }

  // ── Kivo animation ────────────────────────────────────────────────────────────
  private animateKivo(t: number, isWalking: boolean) {
    const { group, body, head, eyeL, eyeR, earL, earR, tail, wL, wR } = this.kivo
    const gy  = this.heightFn(this.kivoX, this.kivoZ)
    const dx  = this.targetX - this.kivoX, dz = this.targetZ - this.kivoZ
    const beh = isWalking ? 'walking' : this.currentBehavior

    const isSleeping = beh === 'sleep'
    const isTraining = beh === 'train'
    const isSitting  = beh === 'sit' || beh === 'reflect'

    // Base Y position — sleeping crouches down
    const baseY  = isSleeping ? gy + 0.18 : gy + 0.55
    const bobAmp = isSleeping ? 0.02 : isTraining ? 0.08 : 0.12
    const bobSpd = isTraining ? 3.5 : isWalking ? 2.8 : 0.9
    group.position.set(this.kivoX, baseY + Math.sin(t * bobSpd) * bobAmp, this.kivoZ)

    // Face direction
    const faceYaw = Math.abs(dx)+Math.abs(dz) > 0.4 ? Math.atan2(dx, dz) : this.cameraYaw + Math.PI
    group.rotation.y += (faceYaw - group.rotation.y) * 0.08

    // Body scale — training pulses, sleeping is flat
    const bodyTarget = isSleeping
      ? new THREE.Vector3(1.15, 0.5, 1.15)
      : new THREE.Vector3(
          1 + Math.sin(t * (isTraining ? 4 : 1.3)) * (isTraining ? 0.055 : 0.03),
          1,
          1 + Math.sin(t * (isTraining ? 4 : 1.3)) * (isTraining ? 0.055 : 0.03),
        )
    body.scale.lerp(bodyTarget, 0.08)

    // Head
    head.rotation.y = isSleeping ? 0 : Math.sin(t * 0.28) * 0.55
    head.rotation.x = isSleeping ? 0.7 : isSitting ? 0.15 : Math.sin(t * 0.42) * 0.09
    head.rotation.z = isSleeping ? -0.4 : 0

    // Blink (suppressed when sleeping)
    if (!isSleeping) {
      const bc = t % 3.8; eyeL.scale.y = eyeR.scale.y = bc>3.65 ? Math.max(0.05, 1-(bc-3.65)*65) : 1
    } else {
      eyeL.scale.y = eyeR.scale.y = 0.05  // closed
    }

    // Ears
    earL.rotation.z = -0.35 + Math.sin(t*2.6+0.3)*0.18
    earR.rotation.z =  0.35 - Math.sin(t*2.6)*0.18

    // Tail
    tail.rotation.x = -0.75 + Math.sin(t * (isWalking ? 3.5 : isSleeping ? 0.4 : 2.1)) * (isSleeping ? 0.1 : 0.38)

    // Wings
    const wingSpd = isTraining ? 6 : isWalking ? 5 : 3.2
    const wingAmp = isTraining ? 0.55 : isWalking ? 0.4 : 0.28
    wL.rotation.x =  Math.sin(t * wingSpd)       * wingAmp
    wR.rotation.x = -Math.sin(t * wingSpd + 0.5) * wingAmp

    // Aura glow — bright when training, faint when sleeping, subtle otherwise
    if (this.kivoAura) {
      const auraMat = this.kivoAura.material as THREE.MeshBasicMaterial
      const targetOp = isTraining ? 0.22 + Math.sin(t * 5) * 0.08
                     : isSleeping ? 0.03
                     : 0.06
      auraMat.opacity += (targetOp - auraMat.opacity) * 0.05
      if (isTraining) {
        auraMat.color.setHex(0xbfff00)
      } else {
        auraMat.color.lerp(new THREE.Color(0x88ffaa), 0.03)
      }
    }
  }

  // ── Camera: always looks at Kivo ──────────────────────────────────────────────
  private updateCamera(dt: number) {
    const kgy = this.heightFn(this.kivoX, this.kivoZ)
    const cy  = kgy + 1.1

    if (this.introRevealActive) {
      this.introRevealTimer += dt
      const t = Math.min(1, this.introRevealTimer / this.introRevealDuration)
      const e = 1 - Math.pow(1 - t, 3)  // cubic ease-out

      // Descend from high aerial view to normal follow position
      const yaw = this.cameraYaw
      const normalTarget = new THREE.Vector3(
        this.kivoX - Math.sin(yaw) * 9.5,
        cy + 5.5,
        this.kivoZ - Math.cos(yaw) * 9.5,
      )
      const aerialTarget = new THREE.Vector3(this.kivoX - 5, kgy + 55, this.kivoZ - 5)
      const pos = aerialTarget.clone().lerp(normalTarget, e)
      this.camPos.lerp(pos, 0.04)

      const normalLook = new THREE.Vector3(this.kivoX, cy + 0.4, this.kivoZ)
      const aerialLook = new THREE.Vector3(this.kivoX, kgy, this.kivoZ)
      const look = aerialLook.clone().lerp(normalLook, e)
      this.camLook.lerp(look, 0.04)

      if (t >= 1) this.introRevealActive = false
    } else if (this.cinemaMode !== 'following') {
      // Cinematic pan in progress
      this.cinemaTimer += dt * 1000

      if (this.cinemaMode === 'panning') {
        this.camPos.lerp(this.cinemaPanPos, 0.016)
        this.camLook.lerp(this.cinemaPanLook, 0.016)
        if (this.camPos.distanceTo(this.cinemaPanPos) < 1.5) {
          this.cinemaMode  = 'holding'
          this.cinemaTimer = 0
        }
      } else if (this.cinemaMode === 'holding') {
        if (this.cinemaTimer >= 5_000) {
          this.cinemaMode  = 'returning'
          this.cinemaTimer = 0
        }
      } else if (this.cinemaMode === 'returning') {
        const yaw = this.cameraYaw
        const followPos  = new THREE.Vector3(this.kivoX - Math.sin(yaw)*9.5, cy+5.5, this.kivoZ - Math.cos(yaw)*9.5)
        const followLook = new THREE.Vector3(this.kivoX, cy+0.4, this.kivoZ)
        this.camPos.lerp(followPos, 0.022)
        this.camLook.lerp(followLook, 0.022)
        if (this.camPos.distanceTo(followPos) < 2) {
          this.cinemaMode    = 'following'
          this.cinemaTimer   = 0
          this.cinemaInterval = 40_000 + Math.random() * 30_000
        }
      }
    } else {
      // Normal follow — also accumulate cinema timer
      this.cinemaTimer += dt * 1000
      if (this.cinemaTimer >= this.cinemaInterval) this.startCinematic()

      const yaw = this.cameraYaw
      const target = new THREE.Vector3(
        this.kivoX - Math.sin(yaw) * 9.5,
        cy + 5.5,
        this.kivoZ - Math.cos(yaw) * 9.5,
      )
      const look = new THREE.Vector3(this.kivoX, cy + 0.4, this.kivoZ)
      this.camPos.lerp(target, 0.06)
      this.camLook.lerp(look, 0.06)
    }

    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    this.skyDome.position.copy(this.camera.position)
  }

  private startCinematic() {
    const targets = [
      { pos: V.center,   label: 'campfire'   },
      { pos: V.home,     label: 'home'       },
      { pos: V.training, label: 'training'   },
      { pos: V.rex,      label: 'sanctuary'  },
      { pos: V.grove,    label: 'grove'      },
      { pos: V.tower,    label: 'tower'      },
    ]
    const t    = targets[Math.floor(Math.random() * targets.length)]
    const hFn  = this.heightFn
    const by   = hFn(t.pos.x, t.pos.z)
    this.cinemaPanLook.set(t.pos.x, by + 2.5, t.pos.z)
    this.cinemaPanPos.set(t.pos.x - 10, by + 12, t.pos.z - 10)
    this.cinemaMode  = 'panning'
    this.cinemaTimer = 0
  }

  // ── Day/night ─────────────────────────────────────────────────────────────────
  private updateDayNight(t: number) {
    const s       = lerpSky(this.realTime)
    const isDay   = this.realTime >= 6 && this.realTime < 20
    const isNight = this.realTime > 20 || this.realTime < 6
    const ang     = ((this.realTime - 6) / 12) * Math.PI
    const sky     = this.skyDome.material as THREE.ShaderMaterial
    sky.uniforms.top.value.setHex(s.top)
    sky.uniforms.bottom.value.setHex(s.bot)

    // Fog: sky colour base + denser at low world health
    const fog = this.scene.fog as THREE.Fog
    fog.color.setHex(s.bot)
    const healthFogFar = 80 + (this.worldHealth / 100) * 60  // 80–140
    fog.far += (healthFogFar - fog.far) * 0.01

    this.sun.intensity    = s.sun
    this.ambient.intensity= s.amb
    this.hemi.intensity   = isDay ? 0.85 : 0.3
    this.sun.position.set(Math.cos(ang)*110, Math.abs(Math.sin(ang))*110, 45)

    // Campfire flicker
    this.campfire.intensity = 1.5 + Math.sin(t * 7.3) * 0.4 + Math.sin(t * 13.7) * 0.25

    // House lamp — warm glow at night only
    if (this.houseLampLight) {
      const targetIntensity = isNight ? 1.2 + Math.sin(t * 0.4) * 0.1 : 0
      this.houseLampLight.intensity += (targetIntensity - this.houseLampLight.intensity) * 0.03
    }

    // Rex Sanctuary green glow pulse
    this.rexGlowLights.forEach(gl => {
      gl.intensity = 0.8 + Math.sin(t * 1.8) * 0.4 + Math.sin(t * 2.9) * 0.2
    })

    this.water.position.y = 0.4 + Math.sin(t * 0.5) * 0.025
  }

  // ── Loop ──────────────────────────────────────────────────────────────────────
  private lastTime = 0
  private loop = () => {
    const t  = this.clock.getElapsedTime()
    const dt = Math.min(t - this.lastTime, 0.05); this.lastTime = t
    const dx = this.targetX - this.kivoX, dz = this.targetZ - this.kivoZ
    const isWalking = Math.sqrt(dx*dx + dz*dz) > 0.8
    this.updateDayNight(t)
    this.updateKivoRoutine(dt)
    this.animateKivo(t, isWalking)
    this.updateFireflies(t)
    this.updateCamera(dt)
    this.renderer.render(this.scene, this.camera)
    this.frame = requestAnimationFrame(this.loop)
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  public updateCameraYaw(yaw: number) { this.cameraYaw = yaw }
  public updatePlayerPosition(_x: number, _z: number) { /* camera only — Kivo is autonomous */ }
  public updateTime(t: number) { this.realTime = t }
  public updateWorldHealth(h: number) { this.worldHealth = h }
  public getActivity(): string { return this.kivoActivity }

  public startIntroReveal() {
    // Place camera high above Kivo, then let updateCamera() descend it
    const kgy = this.heightFn(this.kivoX, this.kivoZ)
    this.camPos.set(this.kivoX - 5, kgy + 55, this.kivoZ - 5)
    this.camLook.set(this.kivoX, kgy, this.kivoZ)
    this.introRevealActive = true
    this.introRevealTimer  = 0
  }
  public dispose() {
    if (this.frame!==null) cancelAnimationFrame(this.frame)
    this.ro.disconnect(); this.renderer.dispose()
  }
}
