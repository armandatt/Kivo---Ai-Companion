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

const CHUNK      = 16
const VIEW       = 3        // chunks each direction
const WATER      = 2        // water level y
const CLIFF_D    = 10       // layers to render below surface for cliff faces

// ─── Minecraft-faithful block palette ─────────────────────────────────────────

type M = 'grass' | 'dirt' | 'stone' | 'water' | 'sand' | 'log' | 'leaf1' | 'leaf2' | 'leaf3' | 'lava'

function makeMats(): Record<M, THREE.MeshLambertMaterial> {
  const l = (c: number, o: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
    new THREE.MeshLambertMaterial({ color: c, ...o })
  return {
    grass : l(0x5a9c2e, { vertexColors: true }),   // vertex-coloured (green top / dirt sides)
    dirt  : l(0x7a5c3a),
    stone : l(0x828282),
    water : l(0x3d7fb5, { transparent: true, opacity: 0.78 }),
    sand  : l(0xd9c47a),
    log   : l(0x675030),
    leaf1 : l(0x375e1f),
    leaf2 : l(0x4a7a28),
    leaf3 : l(0x2d5018),
    lava  : new THREE.MeshLambertMaterial({ color: 0xff6d00, emissive: new THREE.Color(0xff3300), emissiveIntensity: 0.5 }),
  }
}

// ─── Grass block geometry: green top face, dirt-brown sides ───────────────────

function makeGrassGeo(): THREE.BufferGeometry {
  const geo  = new THREE.BoxGeometry(1, 1, 1)
  const pos  = geo.attributes.position as THREE.BufferAttribute
  const cols = new Float32Array(pos.count * 3)
  // Top face vertices have y = +0.5; everything else gets dirt colour
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.4) {
      // Minecraft grass green: #5a9c2e
      cols[i * 3] = 0.353; cols[i * 3 + 1] = 0.612; cols[i * 3 + 2] = 0.180
    } else {
      // Dirt side: #7a5c3a
      cols[i * 3] = 0.478; cols[i * 3 + 1] = 0.361; cols[i * 3 + 2] = 0.227
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  return geo
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

const SKY: Array<[number, THREE.Color]> = [
  [0,  new THREE.Color(0x07111f)],
  [5,  new THREE.Color(0x1a1040)],
  [6,  new THREE.Color(0xf47c30)],
  [8,  new THREE.Color(0x7fc8f8)],
  [14, new THREE.Color(0x5ab4ee)],
  [18, new THREE.Color(0xf47c30)],
  [20, new THREE.Color(0x1a0d33)],
  [24, new THREE.Color(0x07111f)],
]

function skyAt(t: number): THREE.Color {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [t0, c0] = SKY[i]; const [t1, c1] = SKY[i + 1]
    if (t >= t0 && t < t1) return c0.clone().lerp(c1, (t - t0) / (t1 - t0))
  }
  return SKY[0][1].clone()
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class BabylonVoxelEngine {
  private renderer:  THREE.WebGLRenderer
  private scene:     THREE.Scene
  private camera:    THREE.PerspectiveCamera
  private sun:       THREE.DirectionalLight
  private mats:      Record<M, THREE.MeshLambertMaterial>
  private grassGeo:  THREE.BufferGeometry
  private box:       THREE.BoxGeometry
  private chunks    = new Map<string, THREE.Group>()
  private hNoise:    (x: number, y: number) => number
  private tNoise:    (x: number, y: number) => number
  private playerX   = 0
  private playerZ   = 0
  private cameraYaw = Math.PI  // start looking south
  private currentTime: number
  private frame:     number | null = null
  private lastCX    = Infinity
  private lastCZ    = Infinity
  private ro:        ResizeObserver

  constructor(
    canvas: HTMLCanvasElement,
    userSeed: string,
    _unlockedBiomes: BiomeType[],
    _worldHealth: number,
  ) {
    this.currentTime = 14

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
    this.renderer.toneMappingExposure = 1.05

    // Scene + Minecraft-style close fog
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x7fc8f8, 30, 90)

    // Camera — 65° FOV, close near plane for immersive feel
    this.camera = new THREE.PerspectiveCamera(65, (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height), 0.1, 150)

    // Lighting — bright directional like Minecraft daytime
    this.scene.add(new THREE.AmbientLight(0x8aafc8, 0.9))
    this.sun = new THREE.DirectionalLight(0xfff5e0, 1.5)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far  = 150
    const sh = this.sun.shadow.camera as THREE.OrthographicCamera
    sh.left = sh.bottom = -60; sh.right = sh.top = 60
    this.scene.add(this.sun)

    // Shared geometries + materials
    this.grassGeo = makeGrassGeo()
    this.box  = new THREE.BoxGeometry(1, 1, 1)
    this.mats = makeMats()

    // Resize
    this.ro = new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (!w || !h) return
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    })
    this.ro.observe(canvas)

    this.loadInitialChunks()
    this.loop()
  }

  // ── Terrain ──────────────────────────────────────────────────────────────────

  private terrainH(wx: number, wz: number): number {
    const n1 = this.hNoise(wx / 55, wz / 55) * 6    // sweeping hills
    const n2 = this.hNoise(wx / 20, wz / 20) * 3    // medium bumps
    const n3 = this.hNoise(wx / 7,  wz / 7)  * 1.2  // surface roughness
    return Math.max(1, Math.round(5 + n1 + n2 + n3))
  }

  // ── Tree planting (Minecraft oak style) ────────────────────────────────────

  private addTree(out: Map<M, [number,number,number][]>, wx: number, wz: number, groundY: number) {
    const nv = Math.abs(this.tNoise(wx * 0.31 + 71, wz * 0.31 + 71))
    const trunkH = 4 + Math.round(nv * 3)
    const topY   = groundY + trunkH
    const add    = (m: M, x: number, y: number, z: number) => {
      let a = out.get(m); if (!a) { a = []; out.set(m, a) }; a.push([x, y, z])
    }

    for (let y = groundY + 1; y <= topY; y++) add('log', wx, y, wz)

    const LMATS: M[] = ['leaf1', 'leaf2', 'leaf3']
    for (let lx = -2; lx <= 2; lx++) {
      for (let lz = -2; lz <= 2; lz++) {
        for (let ly = -1; ly <= 2; ly++) {
          const corner = Math.abs(lx) === 2 && Math.abs(lz) === 2
          if (corner && ly <= 0) continue
          if (corner && this.tNoise(wx + lx * 0.7, wz + lz * 0.7 + 200) > 0.25) continue
          add(LMATS[Math.abs(lx + lz + ly + 9) % 3], wx + lx, topY + ly, wz + lz)
        }
      }
    }
  }

  // ── Chunk building ───────────────────────────────────────────────────────────

  private buildChunk(cx: number, cz: number): THREE.Group {
    const group = new THREE.Group()
    const out   = new Map<M, [number,number,number][]>()
    const add   = (m: M, x: number, y: number, z: number) => {
      let a = out.get(m); if (!a) { a = []; out.set(m, a) }; a.push([x, y, z])
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
          // Surface grass block
          add('grass', wx, h, wz)

          // Cliff face: dirt + stone layers below surface
          for (let dy = 1; dy <= CLIFF_D; dy++) {
            const y = h - dy
            if (y < 1) break
            const m: M = dy <= 3 ? 'dirt' : 'stone'
            add(m, wx, y, wz)
          }

          // Trees (~25% of surfaces in open areas)
          const tv = this.tNoise(wx / 7, wz / 7)
          if (tv > 0.5 && h > WATER + 1) this.addTree(out, wx, wz, h)
        }
      }
    }

    // Build one InstancedMesh per material
    const mat4 = new THREE.Matrix4()
    out.forEach((positions, key) => {
      if (!positions.length) return
      const geo  = key === 'grass' ? this.grassGeo : this.box
      const mesh = new THREE.InstancedMesh(geo, this.mats[key], positions.length)
      mesh.castShadow = key !== 'water'
      mesh.receiveShadow = true
      positions.forEach(([x, y, z], i) => { mat4.setPosition(x, y, z); mesh.setMatrixAt(i, mat4) })
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
          this.scene.add(g); this.chunks.set(key, g)
        }
      }
    }
    this.chunks.forEach((group, key) => {
      const [cx, cz] = key.split(',').map(Number)
      if (Math.abs(cx - px) > VIEW + 1 || Math.abs(cz - pz) > VIEW + 1) {
        this.scene.remove(group)
        group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose() })
        this.chunks.delete(key)
      }
    })
  }

  // ── Third-person ground-level camera ─────────────────────────────────────────

  private positionCamera() {
    const px = this.playerX
    const pz = this.playerZ
    const groundY = this.terrainH(Math.round(px), Math.round(pz))
    const eyeY    = groundY + 1.65          // player eye height

    const yaw     = this.cameraYaw
    const camDist = 5.5                      // blocks behind player
    const camUp   = 2.2                      // blocks above eye

    this.camera.position.set(
      px - Math.sin(yaw) * camDist,
      eyeY + camUp,
      pz - Math.cos(yaw) * camDist,
    )
    this.camera.lookAt(
      px + Math.sin(yaw) * 2,
      eyeY - 0.3,
      pz + Math.cos(yaw) * 2,
    )
  }

  // ── Day / night ──────────────────────────────────────────────────────────────

  private updateDayNight() {
    const t   = this.currentTime
    const sky = skyAt(t)
    this.scene.background = sky
    ;(this.scene.fog as THREE.Fog).color.copy(sky)

    const angle    = ((t - 6) / 12) * Math.PI
    const isDay    = t >= 6 && t < 20
    this.sun.intensity = isDay ? Math.max(0.2, Math.sin(angle) * 1.6) : 0.05
    this.sun.position.set(Math.cos(angle) * 80, Math.abs(Math.sin(angle)) * 80, 30)
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
    const dx = playerX - this.playerX
    const dz = playerZ - this.playerZ
    if (dx !== 0 || dz !== 0) {
      // Camera follows movement direction
      this.cameraYaw = Math.atan2(dx, dz)
    }
    this.playerX = playerX
    this.playerZ = playerZ

    const cx = Math.floor(playerX / CHUNK)
    const cz = Math.floor(playerZ / CHUNK)
    if (cx !== this.lastCX || cz !== this.lastCZ) {
      this.lastCX = cx; this.lastCZ = cz
      this.refreshChunks(cx, cz)
    }
  }

  public updateTime(time: number) { this.currentTime = time }

  public updateWorldHealth(_h: number) { /* future: wither colours */ }

  public dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.ro.disconnect()
    this.renderer.dispose()
    this.grassGeo.dispose()
    this.box.dispose()
    Object.values(this.mats).forEach(m => m.dispose())
  }
}
