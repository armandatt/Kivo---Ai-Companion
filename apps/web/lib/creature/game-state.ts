// Game state types and constants for the Minecraft-like world

export type BiomeType = 'forest' | 'mountain' | 'desert' | 'nether' | 'sky' | 'end'
export type BlockType =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'sand'
  | 'water'
  | 'lava'
  | 'tree'
  | 'snow'
  | 'void'

export interface Tile {
  x: number
  y: number
  type: BlockType
  biome: BiomeType
}

export interface PlayerState {
  x: number
  y: number
  level: number
  experience: number
  health: number
  hunger: number
  inventory: InventoryItem[]
}

export interface InventoryItem {
  type: BlockType
  quantity: number
}

export interface WorldState {
  seed: string
  currentStreak: number
  worldHealth: number // 0-100
  unlockedBiomes: BiomeType[]
  unlockedStructures: string[]
  landmarks: Landmark[]
  visitedChunks: Set<string>
  currentTime: number // 0-24 (hour of day)
  weather: WeatherType
}

export type WeatherType = 'clear' | 'rain' | 'storm' | 'fog'

export interface Landmark {
  x: number
  y: number
  type: string
  title: string
  description: string
  date: string
  icon: string
}

// Biome unlock requirements (days of streak)
export const BIOME_UNLOCKS: Record<BiomeType, number> = {
  forest: 0,
  mountain: 7,
  desert: 30,
  nether: 60,
  sky: 90,
  end: 365,
}

// Structure unlock requirements (days of streak)
export const STRUCTURE_UNLOCKS: Record<string, number> = {
  workbench: 7,
  house: 30,
  watchtower: 60,
  fortress: 90,
  village: 180,
  gateway: 365,
}

// Block type colors for isometric rendering
export const BLOCK_COLORS: Record<BlockType, { healthy: string; withered: string }> = {
  grass: { healthy: '#90EE90', withered: '#8B7355' },
  dirt: { healthy: '#8B4513', withered: '#654321' },
  stone: { healthy: '#808080', withered: '#555555' },
  sand: { healthy: '#EDC9AF', withered: '#D4A574' },
  water: { healthy: '#4A90E2', withered: '#2C5282' },
  lava: { healthy: '#FF6B35', withered: '#CC5500' },
  tree: { healthy: '#228B22', withered: '#654321' },
  snow: { healthy: '#FFFAFA', withered: '#D3D3D3' },
  void: { healthy: '#1a1a2e', withered: '#0f0f1e' },
}

// World health affects colors and weather
export function getWeatherFromHealth(health: number): WeatherType {
  if (health >= 95) return 'clear'
  if (health >= 70) return 'rain'
  if (health >= 40) return 'fog'
  return 'storm'
}

// Chunk size for terrain generation
export const CHUNK_SIZE = 16
export const RENDER_DISTANCE = 3 // chunks in each direction

// Tile size in pixels (isometric)
export const TILE_SIZE = 32
export const TILE_HEIGHT = 16 // isometric height
