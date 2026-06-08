// @ts-nocheck — BabylonJS API differences between versions are handled at runtime
import * as BABYLON from '@babylonjs/core'
import { TerrainGenerator } from './terrain-generator'
import { BiomeType } from './game-state'

export interface VoxelBlock {
  position: BABYLON.Vector3
  blockType: string
  biome: BiomeType
  mesh?: BABYLON.Mesh
}

export class BabylonVoxelEngine {
  private scene: BABYLON.Scene
  private engine: BABYLON.Engine
  private canvas: HTMLCanvasElement
  private camera: BABYLON.UniversalCamera
  private light: BABYLON.Light
  private terrainGenerator: TerrainGenerator
  private loadedChunks: Map<string, VoxelBlock[]> = new Map()
  private chunkSize = 16
  private viewDistance = 3
  private voxelSize = 2
  private worldHealth: number
  private currentTime: number

  // Materials cache
  private materials: Map<string, BABYLON.Material> = new Map()

  constructor(
    canvas: HTMLCanvasElement,
    userSeed: string,
    unlockedBiomes: BiomeType[],
    worldHealth: number,
  ) {
    this.canvas = canvas
    this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true })
    this.scene = new BABYLON.Scene(this.engine)
    this.terrainGenerator = new TerrainGenerator(userSeed, unlockedBiomes)
    this.worldHealth = worldHealth
    this.currentTime = 14

    // Setup scene
    this.setupScene()
    this.setupCamera()
    this.setupLighting()
    this.createMaterials()

    // Start render loop
    this.engine.runRenderLoop(() => {
      this.scene.render()
    })

    // Handle window resize
    window.addEventListener('resize', () => {
      this.engine.resize()
    })
  }

  private setupScene() {
    this.scene.clearColor = new BABYLON.Color4(0.2, 0.3, 0.5, 1.0)
    this.scene.collisionsEnabled = true
    // Physics disabled for now - voxel rendering doesn't need it
    // this.scene.enablePhysics(new BABYLON.Vector3(0, -20, 0), new BABYLON.CannonJSPlugin())
  }

  private setupCamera() {
    this.camera = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, 20, -30), this.scene)
    this.camera.attachControl(this.canvas, true)
    this.camera.inertia = 0.7
    this.camera.angularSensibility = 1000
    this.camera.speed = 0.5
    this.camera.minZ = 0.1
    this.camera.maxZ = 1000

    // Isometric-like camera angle
    this.camera.rotation = new BABYLON.Vector3(
      Math.PI / 4, // 45 degrees pitch
      Math.PI / 4, // 45 degrees yaw
      0,
    )
  }

  private setupLighting() {
    // Sun light (directional, mimics day/night)
    this.light = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(1, 1, 1))
    this.light.intensity = 0.8
    this.light.range = 1000

    // Ambient light for fill
    const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0))
    ambient.intensity = 0.5
    ambient.groundColor = new BABYLON.Color3(0.1, 0.1, 0.15)
    ambient.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2)

    // Shadow support
    const shadowGenerator = new BABYLON.ShadowGenerator(1024, this.light as BABYLON.DirectionalLight)
    shadowGenerator.bias = 0.00005
  }

  private createMaterials() {
    const materials: Record<string, [number, number, number]> = {
      grass: [0.4, 0.8, 0.2],
      dirt: [0.6, 0.45, 0.2],
      stone: [0.5, 0.5, 0.5],
      sand: [0.9, 0.8, 0.3],
      water: [0.2, 0.5, 0.8],
      lava: [1.0, 0.4, 0.0],
      snow: [0.95, 0.95, 0.98],
      tree: [0.3, 0.6, 0.2],
      log: [0.4, 0.25, 0.1],
    }

    Object.entries(materials).forEach(([name, [r, g, b]]) => {
      const mat = new BABYLON.StandardMaterial(name, this.scene)
      mat.diffuse = new BABYLON.Color3(r, g, b)
      mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2)
      mat.specularPower = 32

      // Adjust colors based on world health (withering effect)
      const healthFactor = this.worldHealth / 100
      if (name !== 'water' && name !== 'lava') {
        mat.diffuse = mat.diffuse.scale(0.5 + healthFactor * 0.5)
      }

      this.materials.set(name, mat)
    })
  }

  public updateWorldHealth(health: number) {
    this.worldHealth = health
    // Regenerate materials with new health value
    this.materials.clear()
    this.createMaterials()
  }

  public updateTime(time: number) {
    this.currentTime = time
    this.updateLighting()
  }

  private updateLighting() {
    // Sun position based on time of day
    const timePercent = this.currentTime / 24
    const sunAngle = Math.PI * 2 * timePercent - Math.PI / 2

    const sunDir = new BABYLON.Vector3(
      Math.cos(sunAngle) * 0.7,
      Math.sin(sunAngle),
      0.3,
    )
    ;(this.light as BABYLON.DirectionalLight).direction = sunDir

    // Dynamic sky color
    let skyColor: BABYLON.Color4
    if (this.currentTime >= 6 && this.currentTime < 18) {
      // Day - clear blue
      const dayPercent = (this.currentTime - 6) / 12
      const r = 0.2 + dayPercent * 0.3
      const g = 0.3 + dayPercent * 0.4
      const b = 0.5 + dayPercent * 0.3
      skyColor = new BABYLON.Color4(r, g, b, 1.0)
      this.light.intensity = 0.6 + dayPercent * 0.4
    } else {
      // Night - dark purple
      const nightPercent =
        this.currentTime >= 18
          ? (this.currentTime - 18) / 12
          : (this.currentTime + 6) / 12
      const r = 0.1 * (1 - nightPercent * 0.3)
      const g = 0.12 * (1 - nightPercent * 0.3)
      const b = 0.2 * (1 - nightPercent * 0.3)
      skyColor = new BABYLON.Color4(r, g, b, 1.0)
      this.light.intensity = 0.2
    }

    this.scene.clearColor = skyColor
  }

  public loadChunk(chunkX: number, chunkZ: number) {
    const chunkKey = `${chunkX},${chunkZ}`

    if (this.loadedChunks.has(chunkKey)) {
      return
    }

    const tiles = this.terrainGenerator.generateChunk(chunkX, chunkZ, this.chunkSize)
    const blocks: VoxelBlock[] = []

    tiles.forEach((tile) => {
      // Create voxel at position
      const position = new BABYLON.Vector3(
        tile.x * this.voxelSize,
        0,
        tile.y * this.voxelSize,
      )

      const box = BABYLON.MeshBuilder.CreateBox(
        `block_${tile.x}_${tile.y}`,
        { size: this.voxelSize * 0.95 },
        this.scene,
      )
      box.position = position

      // Apply material
      const material = this.materials.get(tile.type) || this.materials.get('grass')
      if (material) {
        box.material = material
      }

      // Store block data
      blocks.push({
        position,
        blockType: tile.type,
        biome: tile.biome,
        mesh: box,
      })
    })

    this.loadedChunks.set(chunkKey, blocks)
  }

  public unloadChunk(chunkX: number, chunkZ: number) {
    const chunkKey = `${chunkX},${chunkZ}`
    const blocks = this.loadedChunks.get(chunkKey)

    if (blocks) {
      blocks.forEach((block) => {
        if (block.mesh) {
          block.mesh.dispose()
        }
      })
      this.loadedChunks.delete(chunkKey)
    }
  }

  public updatePlayerPosition(playerX: number, playerZ: number) {
    // Update camera to follow player
    const cameraDistance = 40
    const cameraHeight = 25

    this.camera.position = new BABYLON.Vector3(
      playerX - cameraDistance * Math.cos(Math.PI / 4),
      cameraHeight,
      playerZ - cameraDistance * Math.sin(Math.PI / 4),
    )

    this.camera.setTarget(new BABYLON.Vector3(playerX, 5, playerZ))

    // Load/unload chunks based on player position
    const currentChunkX = Math.floor(playerX / (this.chunkSize * this.voxelSize))
    const currentChunkZ = Math.floor(playerZ / (this.chunkSize * this.voxelSize))

    for (let x = -this.viewDistance; x <= this.viewDistance; x++) {
      for (let z = -this.viewDistance; z <= this.viewDistance; z++) {
        this.loadChunk(currentChunkX + x, currentChunkZ + z)
      }
    }

    // Unload distant chunks
    this.loadedChunks.forEach((_, chunkKey) => {
      const [x, z] = chunkKey.split(',').map(Number)
      if (
        Math.abs(x - currentChunkX) > this.viewDistance ||
        Math.abs(z - currentChunkZ) > this.viewDistance
      ) {
        this.unloadChunk(x, z)
      }
    })
  }

  public dispose() {
    this.engine.dispose()
  }
}
