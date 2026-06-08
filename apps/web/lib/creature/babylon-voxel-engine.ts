import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import type { BiomeType } from './game-state'

export type { BiomeType }
export interface VoxelBlock {
  position: THREE.Vector3
  blockType: string
  biome: BiomeType
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK = 16
const VIEW  = 2          // chunks each direction → 5×5 = 25 loaded
const WATER = 2          // water level y

// ─── Material palette ─────────────────────────────────────────────────────────

type M =
  | 'grass' | 'dirt' | 'stone'
  | 'water' | 'sand'
  | 'log'
  | 'leaf1' | 'leaf2' | 'leaf3'
  | 'lava'  | 'snow'

function makeMats(): Record<M, THREE.MeshLambertMaterial> {
  const l = (c: number, opts: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
    new THREE.MeshLambertMaterial({ color: c, ...opts })
  return {
    grass : l(0x4caf50),
    dirt  : l(0x8d6e63),
    stone : l(0x78909c),
    water : l(0x1976d2, { transparent: true, opacity: 0.72 }),
    sand  : l(0xf0d080),
    log   : l(0x4e342e),
    leaf1 : l(0x1b5e20),
    leaf2 : l(0x2e7d32),
    leaf3 : l(0x388e3c),
    lava  : new THREE.MeshLambertMaterial({
      color: 0xff6d00,
      emissive: new THREE.Color(0xff3300),
      emissiveIntensity: 0.55,
    }),
    snow  : l(0xeceff1),
  }
}

// ─── PRNG / noise helpers ─────────────────────────────────────────────────────

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

// ─── Sky palette ─────────────────────────────────────────────────────────────

const SKY_STOPS: Array<[number, THREE.Color]> = [
  [0,  new THREE.Color(0x07111f)],
  [5,  new THREE.Color(0x1a1040)],
  [6,  new THREE.Color(0xff6030)],
  [8,  new THREE.Color(0x5ba3d4)],
  [14, new THREE.Color(0x3d8fc7)],
  [18, new THREE.Color(0xff5722)],
  [20, new THREE.Color(0x1a0d33)],
  [24, new THREE.Color(0x07111f)],
]

function getSky(t: number): THREE.Color {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const [t0, c0] = SKY_STOPS[i]
    const [t1, c1] = SKY_STOPS[i + 1]
    if (t >= t0 && t < t1) {
      return c0.clone().lerp(c1, (t - t0) / (t1 - t0))
    }
  }
  return SKY_STOPS[0][1].clone()
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class BabylonVoxelEngine {
  private renderer:  THREE.WebGLRenderer
  private scene:     THREE.Scene
  private camera:    THREE.PerspectiveCamera
  private sun:       THREE.DirectionalLight
  private mats:      Record<M, THREE.MeshLambertMaterial>
  private box:       THREE.BoxGeometry
  private chunks    = new Map<string, THREE.Group>()
  private hNoise:    (x: number, y: number) => number
  private tNoise:    (x: number, y: number) => number
  private playerX   = 0
  private playerZ   = 0
  private currentTime: number
  private frame:     number | null = null
  private lastCX    = Infinity
  private lastCZ    = Infinity
  private ro:        ResizeObserver

  constructor(
    canvas: HTMLCanvasElement,
    userSeed: string,
    _unlockedBiomes: BiomeType[],
    worldHealth: number,
  ) {
    void worldHealth
    this.currentTime = 14

    // Noise
    const seed = strSeed(userSeed)
    this.hNoise = createNoise2D(mulberry32(seed))
    this.tNoise = createNoise2D(mulberry32(seed ^ 0xdeadbeef))

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    // Scene
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x3d8fc7, 0.014)

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      68,
      (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height),
      0.5,
      400,
    )

    // Lighting
    const ambient = new THREE.AmbientLight(0x405d27, 1.0)
    this.scene.add(ambient)

    this.sun = new THREE.DirectionalLight(0xfff5e4, 1.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far  = 300
    const sh = this.sun.shadow.camera as THREE.OrthographicCamera
    sh.left = sh.bottom = -80
    sh.right = sh.top   =  80
    this.scene.add(this.sun)

    // Shared geometry + materials
    this.box  = new THREE.BoxGeometry(1, 1, 1)
    this.mats = makeMats()

    // Resize observer
    this.ro = new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (!w || !h) return
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    })
    this.ro.observe(canvas)

    // Bootstrap
    this.loadInitialChunks()
    this.loop()
  }

  // ── Terrain helpers ──────────────────────────────────────────────────────────

  private terrainH(wx: number, wz: number): number {
    const n1 = this.hNoise(wx / 55, wz / 55) * 4.5
    const n2 = this.hNoise(wx / 18, wz / 18) * 1.8
    const n3 = this.hNoise(wx / 6,  wz / 6)  * 0.8
    return Math.max(1, Math.round(4 + n1 + n2 + n3))
  }

  private addTree(
    out: Map<M, [number, number, number][]>,
    wx: number,
    wz: number,
    groundY: number,
  ) {
    // Deterministic trunk height from noise
    const nv = Math.abs(this.tNoise(wx * 0.3 + 71, wz * 0.3 + 71))
    const trunkH = 5 + Math.round(nv * 4)
    const topY   = groundY + trunkH
    const add = (m: M, x: number, y: number, z: number) => {
      let arr = out.get(m)
      if (!arr) { arr = []; out.set(m, arr) }
      arr.push([x, y, z])
    }

    for (let y = groundY + 1; y <= topY; y++) add('log', wx, y, wz)

    const LEAFMATS: M[] = ['leaf1', 'leaf2', 'leaf3']
    const R = 2
    for (let lx = -R; lx <= R; lx++) {
      for (let lz = -R; lz <= R; lz++) {
        for (let ly = -1; ly <= 3; ly++) {
          const corner = Math.abs(lx) === R && Math.abs(lz) === R
          // Skip outer corners on low rows for a rounder canopy
          if (corner && ly <= 0) continue
          // Use deterministic noise to thin outer leaves
          if (corner && this.tNoise(wx + lx * 0.7, wz + lz * 0.7 + 200) > 0.3) continue
          const mat = LEAFMATS[Math.abs(lx + lz + ly + 9) % 3]
          add(mat, wx + lx, topY + ly, wz + lz)
        }
      }
    }
  }

  // ── Chunk building ───────────────────────────────────────────────────────────

  private buildChunk(cx: number, cz: number): THREE.Group {
    const group = new THREE.Group()
    const out   = new Map<M, [number, number, number][]>()

    const add = (m: M, x: number, y: number, z: number) => {
      let arr = out.get(m)
      if (!arr) { arr = []; out.set(m, arr) }
      arr.push([x, y, z])
    }

    for (let tx = 0; tx < CHUNK; tx++) {
      for (let tz = 0; tz < CHUNK; tz++) {
        const wx = cx * CHUNK + tx
        const wz = cz * CHUNK + tz
        const h  = this.terrainH(wx, wz)

        if (h <= WATER) {
          add('water', wx, WATER, wz)
          add('sand',  wx, h,     wz)
          if (h > 1) add('sand', wx, h - 1, wz)
        } else {
          // Surface
          add('grass', wx, h, wz)
          // Dirt cap (3 layers)
          for (let dy = 1; dy <= 3; dy++) {
            const y = h - dy
            if (y >= 1) add('dirt', wx, y, wz)
          }

          // Dense jungle trees ~28% of surface tiles
          const tv = this.tNoise(wx / 7, wz / 7)
          if (tv > 0.44 && h > WATER + 1) {
            this.addTree(out, wx, wz, h)
          }
        }
      }
    }

    // One InstancedMesh per material
    const mat4 = new THREE.Matrix4()
    out.forEach((positions, key) => {
      if (!positions.length) return
      const mesh = new THREE.InstancedMesh(this.box, this.mats[key], positions.length)
      mesh.castShadow   = key !== 'water'
      mesh.receiveShadow = true
      positions.forEach(([x, y, z], i) => {
        mat4.setPosition(x, y, z)
        mesh.setMatrixAt(i, mat4)
      })
      mesh.instanceMatrix.needsUpdate = true
      group.add(mesh)
    })

    return group
  }

  // ── Chunk management ─────────────────────────────────────────────────────────

  private loadInitialChunks() {
    this.lastCX = Math.floor(this.playerX / CHUNK)
    this.lastCZ = Math.floor(this.playerZ / CHUNK)
    this.refreshChunks(this.lastCX, this.lastCZ)
  }

  private refreshChunks(px: number, pz: number) {
    for (let dx = -VIEW; dx <= VIEW; dx++) {
      for (let dz = -VIEW; dz <= VIEW; dz++) {
        const key = `${px + dx},${pz + dz}`
        if (!this.chunks.has(key)) {
          const g = this.buildChunk(px + dx, pz + dz)
          this.scene.add(g)
          this.chunks.set(key, g)
        }
      }
    }

    this.chunks.forEach((group, key) => {
      const [cx, cz] = key.split(',').map(Number)
      if (Math.abs(cx - px) > VIEW + 1 || Math.abs(cz - pz) > VIEW + 1) {
        this.scene.remove(group)
        group.traverse(obj => {
          if ((obj as THREE.InstancedMesh).isInstancedMesh) {
            (obj as THREE.InstancedMesh).dispose()
          }
        })
        this.chunks.delete(key)
      }
    })
  }

  // ── Camera ───────────────────────────────────────────────────────────────────

  private positionCamera() {
    const h    = this.terrainH(Math.round(this.playerX), Math.round(this.playerZ))
    const dist = 32
    const yOff = 22
    const ang  = Math.PI * 0.75  // looking from NW

    this.camera.position.set(
      this.playerX + Math.sin(ang) * dist,
      h + yOff,
      this.playerZ + Math.cos(ang) * dist,
    )
    this.camera.lookAt(this.playerX, h + 4, this.playerZ)
  }

  // ── Day/night ────────────────────────────────────────────────────────────────

  private updateDayNight() {
    const t   = this.currentTime
    const sky = getSky(t)
    this.scene.background = sky
    ;(this.scene.fog as THREE.FogExp2 | null)?.color.copy(sky)

    const dayAngle  = ((t - 6) / 12) * Math.PI
    const isDay     = t >= 6 && t < 20
    const intensity = isDay ? Math.max(0, Math.sin(dayAngle) * 1.4) : 0

    this.sun.intensity = intensity
    this.sun.position.set(
      Math.cos(dayAngle) * 120,
      Math.abs(Math.sin(dayAngle)) * 120,
      40,
    )
    ;(this.scene.fog as THREE.FogExp2 | null)?.color.copy(sky)
  }

  // ── Render loop ──────────────────────────────────────────────────────────────

  private loop = () => {
    this.updateDayNight()
    this.positionCamera()
    this.renderer.render(this.scene, this.camera)
    this.frame = requestAnimationFrame(this.loop)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  public updatePlayerPosition(playerX: number, playerZ: number) {
    this.playerX = playerX
    this.playerZ = playerZ
    const cx = Math.floor(playerX / CHUNK)
    const cz = Math.floor(playerZ / CHUNK)
    if (cx !== this.lastCX || cz !== this.lastCZ) {
      this.lastCX = cx
      this.lastCZ = cz
      this.refreshChunks(cx, cz)
    }
  }

  public updateTime(time: number) {
    this.currentTime = time
  }

  public updateWorldHealth(_health: number) {
    // World health could wither colours — left as future feature
  }

  public dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.ro.disconnect()
    this.renderer.dispose()
    this.box.dispose()
    Object.values(this.mats).forEach(m => m.dispose())
  }
}
