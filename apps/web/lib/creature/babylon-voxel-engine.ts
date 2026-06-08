/**
 * Kivo World Engine — smooth stylized RPG world, no voxel blocks.
 * Architecture: single large terrain mesh (vertex-displaced PlaneGeometry),
 * instanced trees, instanced grass billboards, animated creature character,
 * smooth lerp camera, sky dome shader, day/night lighting.
 */

import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import type { BiomeType } from './game-state'

export type { BiomeType }
export interface VoxelBlock { position: THREE.Vector3; blockType: string; biome: BiomeType }

// ─── World constants ──────────────────────────────────────────────────────────
const WORLD    = 320   // terrain spans -160 to +160 world units
const SEGS     = 160   // mesh subdivisions per axis (160×160 = smooth hills)
const WATER_Y  = 0.4   // water surface height
const SPAWN_R  = 28    // radius of flat spawn area near (0,0)

// ─── Noise helpers ────────────────────────────────────────────────────────────
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

// ─── Terrain height function ──────────────────────────────────────────────────
function makeHeightFn(hN: (x:number,y:number)=>number) {
  return (wx: number, wz: number): number => {
    const dist  = Math.sqrt(wx*wx + wz*wz)
    // Flat spawn area fades into rolling hills then ocean at edge
    const spawn = Math.exp(-Math.pow(dist / SPAWN_R, 2)) * 2.5     // gentle central plateau
    const isle  = Math.max(0, 1 - Math.pow(dist / 130, 2.5)) * 8  // island falloff
    const n1    = hN(wx / 80, wz / 80) * 6    // large hills
    const n2    = hN(wx / 28, wz / 28) * 2.5  // medium bumps
    const n3    = hN(wx / 10, wz / 10) * 0.9  // surface detail
    return Math.max(-2, spawn + isle + (n1 + n2 + n3))
  }
}

// ─── Height → terrain colour ──────────────────────────────────────────────────
function lerp3(c: THREE.Color, a: number, b: number, t: number) {
  c.setHex(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)))
}
function heightColor(h: number): THREE.Color {
  const c = new THREE.Color()
  if      (h < -0.2) { lerp3(c, 0x1a5580, 0x2a80b5, (h+2)/1.8); }
  else if (h < 0.5)  { lerp3(c, 0xcfba82, 0xd9cb90, (h+0.2)/0.7); }
  else if (h < 3.0)  { lerp3(c, 0x5ab840, 0x4aa835, (h-0.5)/2.5); }
  else if (h < 6.5)  { lerp3(c, 0x4a9830, 0x3a8025, (h-3.0)/3.5); }
  else if (h < 9.5)  { lerp3(c, 0x7a7260, 0x8a8270, (h-6.5)/3.0); }
  else               { c.setHex(0xe8eaf6) }
  return c
}

// ─── Terrain mesh ─────────────────────────────────────────────────────────────
function buildTerrain(hFn: (x:number,z:number)=>number): THREE.Mesh {
  const geo  = new THREE.PlaneGeometry(WORLD, WORLD, SEGS, SEGS)
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

// ─── Water plane ──────────────────────────────────────────────────────────────
function buildWater(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD).rotateX(-Math.PI / 2) as THREE.BufferGeometry,
    new THREE.MeshLambertMaterial({ color: 0x2a90d0, transparent: true, opacity: 0.78 })
  )
  mesh.position.y = WATER_Y
  return mesh
}

// ─── Sky dome (gradient shader) ───────────────────────────────────────────────
function buildSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top:    { value: new THREE.Color(0x1565c0) },
      bottom: { value: new THREE.Color(0x90caf9) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 bottom;
      varying vec3 vPos;
      void main() {
        float h = clamp(vPos.y / 148.0, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, pow(h, 0.6)), 1.0);
      }
    `,
    side: THREE.BackSide,
  })
  return new THREE.Mesh(new THREE.SphereGeometry(148, 32, 16), mat)
}

// ─── Instanced trees ──────────────────────────────────────────────────────────
function scatterTrees(hFn:(x:number,z:number)=>number, tN:(x:number,y:number)=>number, scene: THREE.Scene) {
  const spots: Array<[number,number,number,number]> = []  // wx,wz,h,scale
  const halfW = WORLD/2 - 12, step = 14
  const dummy = new THREE.Object3D()

  for (let wx = -halfW; wx < halfW; wx += step) {
    for (let wz = -halfW; wz < halfW; wz += step) {
      const jx = wx + tN(wx*.09, wz*.09+50) * step * .85
      const jz = wz + tN(wx*.09+80, wz*.09) * step * .85
      const h  = hFn(jx, jz)
      if (h < 2.8 || h > 8.5) continue
      if (tN(jx/16, jz/16) < 0.1) continue
      const scale = 0.85 + Math.abs(tN(jx*.4, jz*.4+300)) * 0.55
      spots.push([jx, jz, h, scale])
    }
  }

  const N = spots.length
  const mat4 = new THREE.Matrix4()

  // Trunks
  const trunkM = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.13, 0.20, 2.0, 7),
    new THREE.MeshLambertMaterial({ color: 0x6b4226 }), N
  )
  trunkM.castShadow = true

  // Three canopy cone layers
  const coneRadii  = [1.7, 1.35, 1.0]
  const coneColors = [0x2d6b22, 0x3d7c2a, 0x4e8c38]
  const coneY      = [1.9, 2.9, 3.8]
  const coneMeshes = coneRadii.map((r, i) => {
    const m = new THREE.InstancedMesh(
      new THREE.ConeGeometry(r, 1.8, 8),
      new THREE.MeshLambertMaterial({ color: coneColors[i] }), N
    )
    m.castShadow = true
    return m
  })

  spots.forEach(([wx, wz, h, sc], i) => {
    dummy.position.set(wx, h + sc * 1.0, wz); dummy.scale.setScalar(sc); dummy.rotation.set(0,0,0)
    dummy.updateMatrix(); trunkM.setMatrixAt(i, dummy.matrix)
    coneY.forEach((yOff, li) => {
      dummy.position.set(wx, h + sc * yOff, wz)
      dummy.rotation.y = i * 0.7
      dummy.updateMatrix(); coneMeshes[li].setMatrixAt(i, dummy.matrix)
    })
  })

  trunkM.instanceMatrix.needsUpdate = true
  coneMeshes.forEach(m => { m.instanceMatrix.needsUpdate = true; scene.add(m) })
  scene.add(trunkM)
}

// ─── Instanced grass billboards ───────────────────────────────────────────────
function scatterGrass(hFn:(x:number,z:number)=>number, tN:(x:number,y:number)=>number): THREE.InstancedMesh {
  const mat = new THREE.MeshLambertMaterial({ color: 0x5aaa40, side: THREE.DoubleSide, transparent: true, alphaTest: 0.1 })
  const geo  = new THREE.PlaneGeometry(0.55, 0.75)
  const COUNT = 5000
  const mesh  = new THREE.InstancedMesh(geo, mat, COUNT * 2)
  const dummy = new THREE.Object3D()
  let idx = 0
  while (idx < COUNT) {
    const wx = (Math.random() - 0.5) * (WORLD - 24)
    const wz = (Math.random() - 0.5) * (WORLD - 24)
    const h  = hFn(wx, wz)
    if (h < 0.6 || h > 7.5) continue
    if (tN(wx/7, wz/7) < -0.35) continue
    const sc = 0.55 + Math.random() * 0.9
    // Plane 1
    dummy.position.set(wx, h + 0.37 * sc, wz); dummy.scale.setScalar(sc)
    dummy.rotation.set(0, Math.random() * Math.PI, 0); dummy.updateMatrix()
    mesh.setMatrixAt(idx * 2, dummy.matrix)
    // Cross plane
    dummy.rotation.y += Math.PI / 2; dummy.updateMatrix()
    mesh.setMatrixAt(idx * 2 + 1, dummy.matrix)
    idx++
  }
  mesh.count = COUNT * 2; mesh.instanceMatrix.needsUpdate = true
  return mesh
}

// ─── Kivo — animated companion creature ───────────────────────────────────────
interface Kivo {
  group: THREE.Group
  body:  THREE.Mesh
  head:  THREE.Group      // whole head group rotates for look-around
  eyeL:  THREE.Mesh       // white ball — scaled for blink
  eyeR:  THREE.Mesh
  earL:  THREE.Mesh
  earR:  THREE.Mesh
  tail:  THREE.Mesh
  wL:    THREE.Mesh       // wing left
  wR:    THREE.Mesh       // wing right
}

function buildKivo(): Kivo {
  const group = new THREE.Group()
  const teal  = new THREE.MeshLambertMaterial({ color: 0x1a9e8c })
  const pale  = new THREE.MeshLambertMaterial({ color: 0x8adfd5 })
  const dark  = new THREE.MeshLambertMaterial({ color: 0x0d7060 })
  const eW    = new THREE.MeshLambertMaterial({ color: 0xfafafa })
  const eB    = new THREE.MeshBasicMaterial   ({ color: 0x00d4ff })  // glowing iris
  const eP    = new THREE.MeshBasicMaterial   ({ color: 0x050a14 })
  const wMat  = new THREE.MeshLambertMaterial ({ color: 0x0e8a7a, transparent: true, opacity: 0.82 })

  // Body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), teal)
  body.scale.set(1, 0.88, 1); body.position.y = 0.52; body.castShadow = true
  group.add(body)
  // Belly highlight
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), pale)
  belly.scale.set(0.88, 0.72, 0.5); belly.position.set(0, 0.48, 0.2)
  group.add(belly)

  // Head group (rotates for look-around animation)
  const headGroup = new THREE.Group()
  headGroup.position.set(0, 1.05, 0.14)
  group.add(headGroup)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), teal)
  head.castShadow = true
  headGroup.add(head)
  // Snout
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), pale)
  snout.scale.set(0.9, 0.6, 0.75); snout.position.set(0, -0.08, 0.38)
  headGroup.add(snout)
  // Nostrils
  ;[-0.07, 0.07].forEach(xOff => {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), dark)
    nostril.position.set(xOff, -0.12, 0.52)
    headGroup.add(nostril)
  })

  // Eyes
  const mkEye = (xOff: number): THREE.Mesh => {
    const eg = new THREE.Group()
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), eW)
    const iris  = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eB)
    iris.position.z = 0.05
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 8), eP)
    pupil.position.z = 0.085
    // Catchlight
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    shine.position.set(0.04, 0.04, 0.11)
    eg.add(white, iris, pupil, shine)
    eg.position.set(xOff, 0.08, 0.38)
    headGroup.add(eg)
    return white  // return white for blink scale
  }
  const eyeL = mkEye(-0.17)
  const eyeR = mkEye( 0.17)

  // Ears (fin-shaped cones)
  const mkEar = (xOff: number, zRot: number): THREE.Mesh => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.3, 5), dark)
    ear.position.set(xOff, 0.36, -0.06); ear.rotation.z = zRot
    headGroup.add(ear)
    return ear
  }
  const earL = mkEar(-0.22, -0.35)
  const earR = mkEar( 0.22,  0.35)

  // Tail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.72, 8), teal)
  tail.position.set(0, 0.4, -0.5); tail.rotation.x = -0.75; tail.castShadow = true
  group.add(tail)
  // Tail tip
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), pale)
  tip.position.set(0, -0.38, 0)
  tail.add(tip)

  // Wings
  const wGeo = new THREE.BufferGeometry()
  const wV = new Float32Array([0,0,0, 0.72,0.28,-0.05, 0.42,0.62,0.08])
  wGeo.setAttribute('position', new THREE.BufferAttribute(wV, 3))
  wGeo.computeVertexNormals()
  const wL = new THREE.Mesh(wGeo, wMat)
  wL.position.set(-0.45, 0.72, -0.1); group.add(wL)
  const wGeo2 = wGeo.clone()
  const wV2 = new Float32Array([0,0,0, -0.72,0.28,-0.05, -0.42,0.62,0.08])
  wGeo2.setAttribute('position', new THREE.BufferAttribute(wV2, 3))
  wGeo2.computeVertexNormals()
  const wR = new THREE.Mesh(wGeo2, wMat)
  wR.position.set(0.45, 0.72, -0.1); group.add(wR)

  // Legs
  const legM = new THREE.MeshLambertMaterial({ color: 0x0d6e5f })
  ;[-0.22, 0.22].forEach((xOff, i) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.32, 6), legM)
    leg.position.set(xOff, 0.14, 0.12); leg.rotation.z = xOff > 0 ? 0.18 : -0.18
    group.add(leg)
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), legM)
    foot.position.set(xOff > 0 ? 0.04 : -0.04, 0, 0.05); foot.scale.set(1.2,0.55,1.3)
    leg.add(foot)
  })

  return { group, body, head: headGroup, eyeL, eyeR, earL, earR, tail, wL, wR }
}

// ─── Day/night sky colours ────────────────────────────────────────────────────
type SkyStop = { t: number; top: number; bot: number; sun: number; amb: number }
const SKY_STOPS: SkyStop[] = [
  { t:  0, top: 0x030820, bot: 0x0a1830, sun: 0.10, amb: 0.35 },
  { t:  5, top: 0x0a1040, bot: 0x1a1555, sun: 0.12, amb: 0.38 },
  { t:  6, top: 0x7a2010, bot: 0xf09060, sun: 0.70, amb: 0.60 },
  { t:  8, top: 0x1455c0, bot: 0x82caf8, sun: 1.90, amb: 0.85 },
  { t: 14, top: 0x0e45b0, bot: 0x72baf4, sun: 2.10, amb: 0.90 },
  { t: 17, top: 0x1a3080, bot: 0xf09060, sun: 1.50, amb: 0.75 },
  { t: 19, top: 0x060820, bot: 0x2a1540, sun: 0.30, amb: 0.42 },
  { t: 24, top: 0x030820, bot: 0x0a1830, sun: 0.10, amb: 0.35 },
]
function lerpSky(t: number): SkyStop {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const a = SKY_STOPS[i], b = SKY_STOPS[i+1]
    if (t >= a.t && t < b.t) {
      const p = (t - a.t) / (b.t - a.t)
      return {
        t,
        top: new THREE.Color(a.top).lerp(new THREE.Color(b.top), p).getHex(),
        bot: new THREE.Color(a.bot).lerp(new THREE.Color(b.bot), p).getHex(),
        sun: a.sun + (b.sun - a.sun) * p,
        amb: a.amb + (b.amb - a.amb) * p,
      }
    }
  }
  return SKY_STOPS[0]
}

// ─── Engine class ─────────────────────────────────────────────────────────────
export class BabylonVoxelEngine {
  private renderer: THREE.WebGLRenderer
  private scene:    THREE.Scene
  private camera:   THREE.PerspectiveCamera
  private sun:      THREE.DirectionalLight
  private hemi:     THREE.HemisphereLight
  private ambient:  THREE.AmbientLight
  private skyDome:  THREE.Mesh
  private water:    THREE.Mesh
  private kivo:     Kivo
  private heightFn: (wx:number,wz:number)=>number
  private playerX   = 0
  private playerZ   = 0
  private cameraYaw = 0.6
  private camPos    = new THREE.Vector3()
  private camLook   = new THREE.Vector3()
  private clock     = new THREE.Clock()
  private realTime  = 14
  private frame:    number | null = null
  private ro:       ResizeObserver

  constructor(canvas: HTMLCanvasElement, userSeed: string, _unlockedBiomes: BiomeType[], _worldHealth: number) {
    const rect = canvas.getBoundingClientRect()
    const W    = rect.width  || canvas.clientWidth  || 800
    const H    = rect.height || canvas.clientHeight || 600

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(W, H, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.18

    // Scene
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x82caf8, 65, 148)

    // Camera
    this.camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 165)
    this.camPos.set(0, 8, 10); this.camLook.set(0, 1.5, 0)
    this.camera.position.copy(this.camPos)

    // Noise
    const seed = strSeed(userSeed)
    const hNoise = createNoise2D(mulberry32(seed))
    const tNoise = createNoise2D(mulberry32(seed ^ 0xdeadbeef))
    this.heightFn = makeHeightFn(hNoise)

    // World geometry
    this.skyDome = buildSkyDome(); this.scene.add(this.skyDome)
    this.scene.add(buildTerrain(this.heightFn))
    this.water = buildWater(); this.scene.add(this.water)
    scatterTrees(this.heightFn, tNoise, this.scene)
    this.scene.add(scatterGrass(this.heightFn, tNoise))

    // Creature
    this.kivo = buildKivo(); this.scene.add(this.kivo.group)

    // Lighting
    this.hemi   = new THREE.HemisphereLight(0x87ceeb, 0x4a6e2a, 0.85); this.scene.add(this.hemi)
    this.ambient= new THREE.AmbientLight(0xfff5e0, 0.8); this.scene.add(this.ambient)
    this.sun    = new THREE.DirectionalLight(0xfff8e7, 2.1)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const sh = this.sun.shadow.camera as THREE.OrthographicCamera
    sh.left=sh.bottom=-90; sh.right=sh.top=90
    this.sun.shadow.camera.near=0.5; this.sun.shadow.camera.far=200
    this.scene.add(this.sun)

    // Resize
    this.ro = new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (!w || !h) return
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
    })
    this.ro.observe(canvas)

    this.loop()
  }

  private getTerrainY(wx: number, wz: number) { return this.heightFn(wx, wz) }

  // ── Creature animation ────────────────────────────────────────────────────────
  private animateKivo(t: number) {
    const { group, body, head, eyeL, eyeR, earL, earR, tail, wL, wR } = this.kivo
    const gy = this.getTerrainY(this.playerX, this.playerZ)

    // Gentle hover
    group.position.set(this.playerX, gy + 0.55 + Math.sin(t * 0.85) * 0.13, this.playerZ)
    group.rotation.y = this.cameraYaw + Math.PI  // always face camera

    // Breathing
    body.scale.setScalar(1 + Math.sin(t * 1.3) * 0.032)

    // Head look-around (slow, organic)
    head.rotation.y = Math.sin(t * 0.28) * 0.55
    head.rotation.x = Math.sin(t * 0.42) * 0.09

    // Blink every ~3.5s
    const bc = t % 3.8
    const bScale = bc > 3.65 ? Math.max(0.05, 1 - (bc - 3.65) * 65) : 1
    eyeL.scale.y = eyeR.scale.y = bScale

    // Ear flutter
    earL.rotation.z = -0.35 + Math.sin(t * 2.6 + 0.3) * 0.18
    earR.rotation.z =  0.35 - Math.sin(t * 2.6) * 0.18

    // Tail wag
    tail.rotation.x = -0.75 + Math.sin(t * 2.1) * 0.38

    // Wing flutter
    wL.rotation.x = Math.sin(t * 3.2) * 0.28
    wR.rotation.x = -Math.sin(t * 3.2 + 0.5) * 0.28
  }

  // ── Smooth camera (lerp follow) ───────────────────────────────────────────────
  private updateCamera() {
    const gy  = this.getTerrainY(this.playerX, this.playerZ)
    const cy  = gy + 1.1
    const yaw = this.cameraYaw
    const DIST= 9.5, UP = 5.8

    const tp = new THREE.Vector3(
      this.playerX - Math.sin(yaw) * DIST,
      cy + UP,
      this.playerZ - Math.cos(yaw) * DIST,
    )
    const tl = new THREE.Vector3(this.playerX, cy + 0.4, this.playerZ)

    this.camPos.lerp(tp, 0.055)
    this.camLook.lerp(tl, 0.055)
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.camLook)

    this.skyDome.position.copy(this.camera.position)
  }

  // ── Day / night ───────────────────────────────────────────────────────────────
  private updateDayNight() {
    const s   = lerpSky(this.realTime)
    const isD = this.realTime >= 6 && this.realTime < 20
    const ang = ((this.realTime - 6) / 12) * Math.PI

    const skyMat = this.skyDome.material as THREE.ShaderMaterial
    skyMat.uniforms.top.value.setHex(s.top)
    skyMat.uniforms.bottom.value.setHex(s.bot)

    const fogC = new THREE.Color(s.bot)
    ;(this.scene.fog as THREE.Fog).color.copy(fogC)

    this.sun.intensity    = s.sun
    this.ambient.intensity= s.amb
    this.hemi.intensity   = isD ? 0.85 : 0.28
    this.sun.position.set(Math.cos(ang) * 110, Math.abs(Math.sin(ang)) * 110, 45)

    this.water.position.y = WATER_Y + Math.sin(this.clock.getElapsedTime() * 0.5) * 0.025
  }

  private loop = () => {
    const t = this.clock.getElapsedTime()
    this.updateDayNight()
    this.animateKivo(t)
    this.updateCamera()
    this.renderer.render(this.scene, this.camera)
    this.frame = requestAnimationFrame(this.loop)
  }

  public updatePlayerPosition(px: number, pz: number) {
    const dx = px - this.playerX, dz = pz - this.playerZ
    if (dx !== 0 || dz !== 0) this.cameraYaw = Math.atan2(dx, dz)
    this.playerX = px; this.playerZ = pz
  }
  public updateTime(t: number) { this.realTime = t }
  public updateWorldHealth(_h: number) {}
  public dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.ro.disconnect(); this.renderer.dispose()
  }
}
