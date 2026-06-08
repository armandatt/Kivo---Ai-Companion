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
function buildHome(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
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
  const fl = new THREE.PointLight(0xff9955, 0.9, 9); fl.position.set(bx, by + 1.5, bz); scene.add(fl)
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

// ─── Landmark: Rex Sanctuary ──────────────────────────────────────────────────
function buildRexSanctuary(scene: THREE.Scene, hFn: (x:number,z:number)=>number) {
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
  // Wisdom stones
  ;[-3.5, 3.5].forEach(xo => {
    place(g, box(0.6, 1.2, 0.45, M(0xb0a890)), xo, 1.05, 2.5)
    const glow = new THREE.PointLight(0xffaa44, 0.5, 4)
    glow.position.set(bx + xo, by + 1.8, bz + 2.5); scene.add(glow)
  })
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
  private kivoX      = V.home.x               // creature autonomous position
  private kivoZ      = V.home.z
  private targetX    = V.center.x
  private targetZ    = V.center.z
  private wpIndex    = 0
  private wpTimer    = 0
  private realTime   = 14
  private clock      = new THREE.Clock()
  private frame:     number | null = null
  private ro:        ResizeObserver

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

    // Village landmarks
    buildHome(this.scene, this.heightFn)
    buildTrainingHall(this.scene, this.heightFn)
    buildMemoryGrove(this.scene, this.heightFn)
    buildAchievementPlaza(this.scene, this.heightFn)
    buildRexSanctuary(this.scene, this.heightFn)
    buildCommitmentShrine(this.scene, this.heightFn)
    buildJourneyTower(this.scene, this.heightFn)
    this.campfire = buildCampfire(this.scene, this.heightFn)
    buildRoads(this.scene, this.heightFn)
    buildLanterns(this.scene, this.heightFn)

    // Background
    scatterBackgroundTrees(this.scene, this.heightFn, tNoise)
    this.scene.add(scatterGrass(this.heightFn, tNoise))

    // Kivo
    this.kivo = buildKivo()
    this.kivo.group.position.set(this.kivoX, this.heightFn(this.kivoX, this.kivoZ), this.kivoZ)
    this.scene.add(this.kivo.group)

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
  private updateKivoRoutine(dt: number) {
    this.wpTimer += dt

    // Walk toward target
    const dx = this.targetX - this.kivoX
    const dz = this.targetZ - this.kivoZ
    const dist = Math.sqrt(dx*dx + dz*dz)
    const speed = 2.2
    if (dist > 0.3) {
      this.kivoX += (dx/dist) * speed * dt
      this.kivoZ += (dz/dist) * speed * dt
    }

    // Arrived — wait then pick next waypoint
    if (dist < 0.8 && this.wpTimer > 6) {
      this.wpTimer = 0
      this.wpIndex = (this.wpIndex + 1) % WAYPOINTS.length
      this.targetX = WAYPOINTS[this.wpIndex].x + (Math.random()-0.5)*1.5
      this.targetZ = WAYPOINTS[this.wpIndex].z + (Math.random()-0.5)*1.5
    }
  }

  // ── Kivo animation ────────────────────────────────────────────────────────────
  private animateKivo(t: number, isWalking: boolean) {
    const { group, body, head, eyeL, eyeR, earL, earR, tail, wL, wR } = this.kivo
    const gy = this.heightFn(this.kivoX, this.kivoZ)
    const dx = this.targetX - this.kivoX, dz = this.targetZ - this.kivoZ
    const faceYaw = Math.abs(dx)+Math.abs(dz) > 0.4 ? Math.atan2(dx, dz) : this.cameraYaw + Math.PI
    group.position.set(this.kivoX, gy + 0.55 + Math.sin(t * 0.9) * 0.12, this.kivoZ)
    group.rotation.y += (faceYaw - group.rotation.y) * 0.08
    body.scale.setScalar(1 + Math.sin(t * (isWalking ? 3.5 : 1.3)) * (isWalking ? 0.025 : 0.03))
    head.rotation.y = Math.sin(t * 0.28) * 0.55
    head.rotation.x = Math.sin(t * 0.42) * 0.09
    const bc = t % 3.8; eyeL.scale.y = eyeR.scale.y = bc>3.65 ? Math.max(0.05, 1-(bc-3.65)*65) : 1
    earL.rotation.z = -0.35 + Math.sin(t*2.6+0.3)*0.18
    earR.rotation.z =  0.35 - Math.sin(t*2.6)*0.18
    tail.rotation.x = -0.75 + Math.sin(t * (isWalking ? 3.5 : 2.1)) * 0.38
    wL.rotation.x = Math.sin(t * (isWalking ? 5 : 3.2)) * (isWalking ? 0.4 : 0.28)
    wR.rotation.x = -Math.sin(t * (isWalking ? 5 : 3.2)+0.5) * (isWalking ? 0.4 : 0.28)
  }

  // ── Camera: always looks at Kivo ──────────────────────────────────────────────
  private updateCamera() {
    const kgy = this.heightFn(this.kivoX, this.kivoZ)
    const cy  = kgy + 1.1
    const yaw = this.cameraYaw
    const target = new THREE.Vector3(
      this.kivoX - Math.sin(yaw) * 9.5,
      cy + 5.5,
      this.kivoZ - Math.cos(yaw) * 9.5,
    )
    const look = new THREE.Vector3(this.kivoX, cy + 0.4, this.kivoZ)
    this.camPos.lerp(target, 0.06)
    this.camLook.lerp(look, 0.06)
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)
    this.skyDome.position.copy(this.camera.position)
  }

  // ── Day/night ─────────────────────────────────────────────────────────────────
  private updateDayNight(t: number) {
    const s    = lerpSky(this.realTime)
    const isD  = this.realTime >= 6 && this.realTime < 20
    const ang  = ((this.realTime - 6) / 12) * Math.PI
    const sky  = this.skyDome.material as THREE.ShaderMaterial
    sky.uniforms.top.value.setHex(s.top)
    sky.uniforms.bottom.value.setHex(s.bot)
    ;(this.scene.fog as THREE.Fog).color.setHex(s.bot)
    this.sun.intensity    = s.sun
    this.ambient.intensity= s.amb
    this.hemi.intensity   = isD ? 0.85 : 0.3
    this.sun.position.set(Math.cos(ang)*110, Math.abs(Math.sin(ang))*110, 45)
    // Campfire flicker
    this.campfire.intensity = 1.5 + Math.sin(t * 7.3) * 0.4 + Math.sin(t * 13.7) * 0.25
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
    this.updateCamera()
    this.renderer.render(this.scene, this.camera)
    this.frame = requestAnimationFrame(this.loop)
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  public updateCameraYaw(yaw: number) { this.cameraYaw = yaw }
  public updatePlayerPosition(_x: number, _z: number) { /* camera only — Kivo is autonomous */ }
  public updateTime(t: number) { this.realTime = t }
  public updateWorldHealth(_h: number) {}
  public dispose() {
    if (this.frame!==null) cancelAnimationFrame(this.frame)
    this.ro.disconnect(); this.renderer.dispose()
  }
}
