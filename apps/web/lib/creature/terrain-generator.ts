import { createNoise2D } from 'simplex-noise'
import {
  BlockType,
  BiomeType,
  Tile,
  CHUNK_SIZE,
  BIOME_UNLOCKS,
} from './game-state'

export class TerrainGenerator {
  private noise2D: (x: number, y: number) => number
  private seed: string
  private unlockedBiomes: BiomeType[]

  constructor(seed: string, unlockedBiomes: BiomeType[]) {
    // Seed the noise with a deterministic value based on user ID
    this.seed = seed
    this.noise2D = createNoise2D(() => {
      // Simple deterministic PRNG based on seed
      const x = Math.sin(seed.charCodeAt(0) || 0) * 10000
      return x - Math.floor(x)
    })
    this.unlockedBiomes = unlockedBiomes
  }

  /**
   * Generate a chunk of terrain at the given chunk coordinates
   */
  generateChunk(chunkX: number, chunkY: number): Tile[] {
    const tiles: Tile[] = []

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        const worldX = chunkX * CHUNK_SIZE + x
        const worldY = chunkY * CHUNK_SIZE + y

        const tile = this.generateTile(worldX, worldY)
        tiles.push(tile)
      }
    }

    return tiles
  }

  /** Public accessor for single tile at world coordinates */
  getTile(x: number, y: number): Tile {
    return this.generateTile(x, y)
  }

  /**
   * Generate a single tile at world coordinates
   */
  private generateTile(x: number, y: number): Tile {
    // Distance from spawn (0, 0) determines base biome
    const distanceFromSpawn = Math.sqrt(x * x + y * y)

    // Get biome based on distance and available unlocks
    const biome = this.getBiomeForDistance(distanceFromSpawn)

    // Generate base height/type using Simplex noise
    const baseNoise = this.noise2D(x / 100, y / 100)
    const treeNoise = this.noise2D(x / 50, y / 50)

    // Determine block type based on biome and noise
    const blockType = this.getBlockType(biome, baseNoise, treeNoise)

    return {
      x,
      y,
      type: blockType,
      biome,
    }
  }

  /**
   * Determine which biome a position belongs to based on distance from spawn
   */
  private getBiomeForDistance(distance: number): BiomeType {
    const biomes: Array<[BiomeType, number]> = [
      ['forest', 0],
      ['mountain', 100],
      ['desert', 200],
      ['nether', 350],
      ['sky', 500],
      ['end', 750],
    ]

    for (let i = biomes.length - 1; i >= 0; i--) {
      const [biome, minDistance] = biomes[i]
      if (
        this.unlockedBiomes.includes(biome) &&
        distance >= minDistance
      ) {
        return biome
      }
    }

    return 'forest' // Always available
  }

  /**
   * Get the block type for a position based on biome and noise values
   */
  private getBlockType(
    biome: BiomeType,
    baseNoise: number,
    treeNoise: number
  ): BlockType {
    switch (biome) {
      case 'forest':
        if (treeNoise > 0.4) return 'tree'
        if (baseNoise < -0.3) return 'water'
        return baseNoise < 0 ? 'grass' : 'dirt'

      case 'mountain':
        if (baseNoise > 0.5) return 'snow'
        if (baseNoise > 0.2) return 'stone'
        if (treeNoise > 0.5) return 'tree'
        return 'grass'

      case 'desert':
        if (baseNoise < -0.2) return 'water'
        return 'sand'

      case 'nether':
        if (baseNoise > 0.3) return 'lava'
        if (baseNoise > -0.2) return 'stone'
        return 'dirt'

      case 'sky':
        if (baseNoise < -0.5) return 'void'
        if (baseNoise < 0) return 'stone'
        return 'grass'

      case 'end':
        if (baseNoise > 0) return 'stone'
        return 'void'

      default:
        return 'grass'
    }
  }

  /**
   * Adjust tile colors based on world health (streak)
   */
  getTileColor(tile: Tile, worldHealth: number): string {
    const { BLOCK_COLORS } = require('./game-state')
    const colorSet = BLOCK_COLORS[tile.type]

    if (!colorSet) return '#888888'

    // Interpolate between healthy and withered colors based on health
    const healthRatio = Math.max(0, Math.min(1, worldHealth / 100))

    if (healthRatio > 0.5) {
      return colorSet.healthy
    } else {
      // Fade to withered when health drops
      const fadeRatio = (healthRatio * 2) // 0-1 when health is 0-50%
      return this.interpolateColor(colorSet.healthy, colorSet.withered, fadeRatio)
    }
  }

  /**
   * Interpolate between two hex colors
   */
  private interpolateColor(color1: string, color2: string, ratio: number): string {
    const c1 = parseInt(color1.slice(1), 16)
    const c2 = parseInt(color2.slice(1), 16)

    const r1 = (c1 >> 16) & 255
    const g1 = (c1 >> 8) & 255
    const b1 = c1 & 255

    const r2 = (c2 >> 16) & 255
    const g2 = (c2 >> 8) & 255
    const b2 = c2 & 255

    const r = Math.round(r1 + (r2 - r1) * ratio)
    const g = Math.round(g1 + (g2 - g1) * ratio)
    const b = Math.round(b1 + (b2 - b1) * ratio)

    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
  }
}
