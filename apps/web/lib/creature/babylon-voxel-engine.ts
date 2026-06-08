import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import type { BiomeType } from './game-state'

export type { BiomeType }
export interface VoxelBlock { position: THREE.Vector3; blockType: string; biome: BiomeType }

// ─── Constants ────────────────────────────────────────────────────────────────
const CHUNK   = 16
const VIEW    = 3
const WATER   = 2
const CLIFF_D = 10

// ─── Block palette ────────────────────────────────────────────────────────────
type M = 'grass'|'dirt'|'stone'|'water'|'sand'|'log'|'leaf1'|'leaf2'|'leaf3'|'lava'

function makeMats(): Record<M, THREE.MeshLambertMaterial> {
  const l = (c: number, o: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
    new THREE.MeshLambertMaterial({ color: c, ...o })
  return {
    grass : l(0x5a9c2e, { vertexColors: true }),
    dirt  : l(0x7a5c3a),
    stone : l(0x828282),
    water : l(0x3d7fb5, { transparent: true, opacity: 0.75 }),
    sand  : l(0xd9c47a),
    log   : l(0x675030),
    leaf1 : l(0x3a7d21),
    leaf2 : l(0x4c9a2a),
    leaf3 : l(0x2d5e18),
    lava  : new THREE.MeshLambertMaterial({ color: 0xff6d00, emissive: new THREE.Color(0xff3300), emissiveIntensity: 0.5 }),
  }
}

// Grass block: green top face, dirt-brown sides (vertex colours)
function makeGrassGeo(): THREE.BufferGeometry {
  const geo  = new THREE.BoxGeometry(1, 1, 1)
  const pos  = geo.attributes.position as THREE.BufferAttribute
  const cols = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.4) {
      cols[i*3]=0.353; cols[i*3+1]=0.612; cols[i*3+2]=0.180  // grass green
    } else {
      cols[i*3]=0.478; cols[i*3+1]=0.361; cols[i*3+2]=0.227  // dirt brown
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  return geo
}

// ─── Creature character (Minecraft-style biped) ───────────────────────────────
function buildCreature(): THREE.Group {
  const g       = new THREE.Group()
  const teal    = new THREE.MeshLambertMaterial({ color: 0x1e8c72 })
  const darkTeal= new THREE.MeshLambertMaterial({ color: 0x145c4e })
  const legMat  = new THREE.MeshLambertMaterial({ color: 0x0f4238 })
  const eyeMat  = new THREE.MeshBasicMaterial({ color: 0xf5e642 })   // glowing yellow
  const pupilMat= new THREE.MeshBasicMaterial({ color: 0x111111 })

  const add = (mat: THREE.Material|THREE.Material[], w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    g.add(mesh)
  }

  // Head (slightly oversized for character)
  add(teal, 0.62, 0.62, 0.62,  0, 1.72, 0)
  // Eyes
  add(eyeMat,  0.14, 0.10, 0.04,  -0.16, 1.76, 0.30)
  add(eyeMat,  0.14, 0.10, 0.04,   0.16, 1.76, 0.30)
  add(pupilMat,0.07, 0.07, 0.05,  -0.16, 1.74, 0.31)
  add(pupilMat,0.07, 0.07, 0.05,   0.16, 1.74, 0.31)
  // Neck stub
  add(darkTeal, 0.22, 0.12, 0.22, 0, 1.38, 0)
  // Body
  add(darkTeal, 0.56, 0.70, 0.32, 0, 0.96, 0)
  // Left arm
  add(teal, 0.22, 0.65, 0.22, -0.39, 0.96, 0)
  // Right arm
  add(teal, 0.22, 0.65, 0.22,  0.39, 0.96, 0)
  // Left leg
  add(legMat, 0.24, 0.62, 0.24, -0.15, 0.31, 0)
  // Right leg
  add(legMat, 0.24, 0.62, 0.24,  0.15, 0.31, 0)

  return g
}

// ─── PRNG / noise ─────────────────────────────────────────────────────────────
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

// ─── Sky colour stops ─────────────────────────────────────────────────────────
// Night is dark-blue (not black) so terrain stays visible
const SKY: Array<[number, THREE.Color]> = [
  [0,  new THREE.Color(0x0e2244)],  // midnight  — dark navy
  [4,  new THREE.Color(0x1a1650)],  // pre-dawn  — deep blue
  [6,  new THREE.Color(0xf08040)],  // sunrise   — orange
  [8,  new THREE.Color(0x5bb8f5)],  // morning   — bright blue
  [14, new THREE.Color(0x3ea8f0)],  // afternoon — vivid blue
  [18, new THREE.Color(0xf07030)],  // sunset    — orange
  [20, new THREE.Color(0x1a1255)],  // dusk      — indigo
  [24, new THREE.Color(0x0e2244)],
]
function skyAt(t: number): THREE.Color {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [t0,c0]=SKY[i], [t1,c1]=SKY[i+1]
    if (t >= t0 && t < t1) return c0.clone().lerp(c1, (t-t0)/(t1-t0))
  }
  return SKY[0][1].clone()
}

// ─── Engine ───────────────────────────────────────────────────────────────────
export class BabylonVoxelEngine {
  private renderer:  THREE.WebGLRenderer
  private scene:     THREE.Scene
  private camera:    THREE.PerspectiveCamera
  private sun:       THREE.DirectionalLight
  private ambient:   THREE.AmbientLight
  private mats:      Record<M, THREE.MeshLambertMaterial>
  private grassGeo:  THREE.BufferGeometry
  private box:       THREE.BoxGeometry
  private chunks   = new Map<string, THREE.Group>()
  private creature:  THREE.Group
  private hNoise:    (x: number, y: number) => number
  private tNoise:    (x: number, y: number) => number
  private playerX  = 0
  private playerZ  = 0
  private cameraYaw= 0.5   // nice diagonal start view
  private time     = 14
  private frame:   number | null = null
  private lastCX   = Infinity
  private lastCZ   = Infinity
  private ro:      ResizeObserver

  constructor(
    canvas: HTMLCanvasElement,
    userSeed: string,
    _unlockedBiomes: BiomeType[],
    _worldHealth: number,
  ) {
    const seed = strSeed(userSeed)
    this.hNoise = createNoise2D(mulberry32(seed))
    this.tNoise = createNoise2D(mulberry32(seed ^ 0xdeadbeef))

    const rect = canvas.getBoundingClientRect()
    const W = rect.width  || canvas.clientWidth  || 800
    const H = rect.height || canvas.clientHeight || 600

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(W, H, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15

    // Scene
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x5bb8f5, 40, 110)

    // Camera — wider FOV feels more immersive
    this.camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 160)

    // Lighting — always bright enough to see (Minecraft feel)
    this.ambient = new THREE.AmbientLight(0xffffff, 1.4)
    this.scene.add(this.ambient)

    this.sun = new THREE.DirectionalLight(0xfff8e7, 2.2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.near = 0.5
    this.sun.shadow.camera.far  = 150
    const sh = this.sun.shadow.camera as THREE.OrthographicCamera
    sh.left = sh.bottom = -70; sh.right = sh.top = 70
    this.scene.add(this.sun)

    // Shared geometry
    this.grassGeo = makeGrassGeo()
    this.box      = new THREE.BoxGeometry(1, 1, 1)
    this.mats     = makeMats()

    // Creature character
    this.creature = buildCreature()
    this.scene.add(this.creature)

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
    const n1 = this.hNoise(wx / 55, wz / 55) * 6
    const n2 = this.hNoise(wx / 20, wz / 20) * 3
    const n3 = this.hNoise(wx / 7,  wz / 7)  * 1.2
    return Math.max(1, Math.round(5 + n1 + n2 + n3))
  }

  // ── Trees ─────────────────────────────────────────────────────────────────────
  private addTree(out: Map<M,[number,number,number][]>, wx: number, wz: number, groundY: number) {
    const nv = Math.abs(this.tNoise(wx * 0.31 + 71, wz * 0.31 + 71))
    const topY = groundY + 4 + Math.round(nv * 3)
    const push = (m: M, x: number, y: number, z: number) => {
      let a = out.get(m); if (!a) { a=[]; out.set(m,a) }; a.push([x,y,z])
    }
    for (let y = groundY+1; y <= topY; y++) push('log', wx, y, wz)
    const LM: M[] = ['leaf1','leaf2','leaf3']
    for (let lx=-2;lx<=2;lx++) for (let lz=-2;lz<=2;lz++) for (let ly=-1;ly<=2;ly++) {
      const corner = Math.abs(lx)===2 && Math.abs(lz)===2
      if (corner && ly<=0) continue
      if (corner && this.tNoise(wx+lx*0.7, wz+lz*0.7+200)>0.25) continue
      push(LM[Math.abs(lx+lz+ly+9)%3], wx+lx, topY+ly, wz+lz)
    }
  }

  // ── Chunk building ───────────────────────────────────────────────────────────
  private buildChunk(cx: number, cz: number): THREE.Group {
    const group = new THREE.Group()
    const out   = new Map<M,[number,number,number][]>()
    const push  = (m: M, x: number, y: number, z: number) => {
      let a=out.get(m); if (!a){a=[];out.set(m,a)}; a.push([x,y,z])
    }
    for (let tx=0;tx<CHUNK;tx++) for (let tz=0;tz<CHUNK;tz++) {
      const wx=cx*CHUNK+tx, wz=cz*CHUNK+tz
      const h=this.terrainH(wx,wz)
      if (h<=WATER) {
        push('water',wx,WATER,wz); push('sand',wx,h,wz)
        if (h>1) push('sand',wx,h-1,wz)
      } else {
        push('grass',wx,h,wz)
        for (let dy=1;dy<=CLIFF_D;dy++) {
          const y=h-dy; if (y<1) break
          push(dy<=3?'dirt':'stone',wx,y,wz)
        }
        if (this.tNoise(wx/7,wz/7)>0.5 && h>WATER+1) this.addTree(out,wx,wz,h)
      }
    }
    const mat4=new THREE.Matrix4()
    out.forEach((positions,key) => {
      if (!positions.length) return
      const mesh=new THREE.InstancedMesh(key==='grass'?this.grassGeo:this.box, this.mats[key], positions.length)
      mesh.castShadow=key!=='water'; mesh.receiveShadow=true
      positions.forEach(([x,y,z],i) => { mat4.setPosition(x,y,z); mesh.setMatrixAt(i,mat4) })
      mesh.instanceMatrix.needsUpdate=true; group.add(mesh)
    })
    return group
  }

  // ── Chunk management ─────────────────────────────────────────────────────────
  private loadInitialChunks() {
    this.lastCX=Math.floor(this.playerX/CHUNK)
    this.lastCZ=Math.floor(this.playerZ/CHUNK)
    this.refreshChunks(this.lastCX,this.lastCZ)
  }
  private refreshChunks(px: number, pz: number) {
    for (let dx=-VIEW;dx<=VIEW;dx++) for (let dz=-VIEW;dz<=VIEW;dz++) {
      const key=`${px+dx},${pz+dz}`
      if (!this.chunks.has(key)) {
        const g=this.buildChunk(px+dx,pz+dz); this.scene.add(g); this.chunks.set(key,g)
      }
    }
    this.chunks.forEach((group,key) => {
      const [cx,cz]=key.split(',').map(Number)
      if (Math.abs(cx-px)>VIEW+1||Math.abs(cz-pz)>VIEW+1) {
        this.scene.remove(group)
        group.traverse(o=>{if((o as THREE.InstancedMesh).isInstancedMesh)(o as THREE.InstancedMesh).dispose()})
        this.chunks.delete(key)
      }
    })
  }

  // ── Camera (third-person, character centred, sky visible) ─────────────────────
  private positionCamera() {
    const px=this.playerX, pz=this.playerZ
    const groundY=this.terrainH(Math.round(px),Math.round(pz))
    const charY=groundY+1.0   // creature centre

    const yaw=this.cameraYaw
    const DIST=9, UP=5.5      // further back + higher = more sky visible

    this.camera.position.set(
      px - Math.sin(yaw)*DIST,
      charY + UP,
      pz - Math.cos(yaw)*DIST,
    )
    // Look AT the creature — keeps it at screen centre
    this.camera.lookAt(px, charY + 0.5, pz)

    // Place creature on terrain surface, facing camera
    this.creature.position.set(px, groundY, pz)
    this.creature.rotation.y = yaw + Math.PI  // face toward camera
  }

  // ── Day / night ──────────────────────────────────────────────────────────────
  private updateDayNight() {
    const t   = this.time
    const sky = skyAt(t)
    this.scene.background = sky
    ;(this.scene.fog as THREE.Fog).color.copy(sky)

    const angle = ((t-6)/12)*Math.PI
    const isDay = t>=6 && t<20

    // Minimum 0.6 at night — world is ALWAYS visible (moonlight)
    this.ambient.intensity = isDay ? 1.4 : 0.9
    this.sun.intensity     = isDay ? Math.max(0.6, Math.sin(angle)*2.2) : 0.4
    this.sun.position.set(Math.cos(angle)*100, Math.abs(Math.sin(angle))*100, 40)
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
    const dx=playerX-this.playerX, dz=playerZ-this.playerZ
    if (dx!==0||dz!==0) this.cameraYaw=Math.atan2(dx,dz)
    this.playerX=playerX; this.playerZ=playerZ
    const cx=Math.floor(playerX/CHUNK), cz=Math.floor(playerZ/CHUNK)
    if (cx!==this.lastCX||cz!==this.lastCZ) { this.lastCX=cx; this.lastCZ=cz; this.refreshChunks(cx,cz) }
  }
  public updateTime(t: number) { this.time=t }
  public updateWorldHealth(_h: number) {}
  public dispose() {
    if (this.frame!==null) cancelAnimationFrame(this.frame)
    this.ro.disconnect(); this.renderer.dispose()
    this.grassGeo.dispose(); this.box.dispose()
    Object.values(this.mats).forEach(m=>m.dispose())
  }
}
