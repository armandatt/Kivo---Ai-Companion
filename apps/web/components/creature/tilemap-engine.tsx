'use client'

import React, { useEffect, useRef, useState } from 'react'
import { TerrainGenerator } from '@/lib/creature/terrain-generator'
import { TILE_SIZE, TILE_HEIGHT, CHUNK_SIZE, Tile, RENDER_DISTANCE } from '@/lib/creature/game-state'

interface TilemapEngineProps {
  userSeed: string
  unlockedBiomes: string[]
  worldHealth: number
  playerX: number
  playerY: number
  currentTime: number
}

export function TilemapEngine({
  userSeed,
  unlockedBiomes,
  worldHealth,
  playerX,
  playerY,
  currentTime,
}: TilemapEngineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const generatorRef = useRef<TerrainGenerator | null>(null)
  const chunksRef = useRef<Map<string, Tile[]>>(new Map())
  const [isDark, setIsDark] = useState(false)

  // Initialize terrain generator
  useEffect(() => {
    generatorRef.current = new TerrainGenerator(userSeed, unlockedBiomes as any)
  }, [userSeed, unlockedBiomes])

  // Update day/night state
  useEffect(() => {
    setIsDark(currentTime > 20 || currentTime < 6)
  }, [currentTime])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !generatorRef.current) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const render = () => {
      // Clear canvas with sky color
      const skyColor = isDark ? '#1a1a2e' : '#87CEEB'
      ctx.fillStyle = skyColor
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Calculate camera position (center on player)
      const cameraX = canvas.width / 2 - (playerX * TILE_SIZE) / 2
      const cameraY = canvas.height / 2 - (playerY * TILE_HEIGHT) / 2

      // Save and apply camera transform
      ctx.save()
      ctx.translate(cameraX, cameraY)

      // Get visible chunks
      const playerChunkX = Math.floor(playerX / CHUNK_SIZE)
      const playerChunkY = Math.floor(playerY / CHUNK_SIZE)

      // Render visible chunks
      for (let cx = playerChunkX - RENDER_DISTANCE; cx <= playerChunkX + RENDER_DISTANCE; cx++) {
        for (let cy = playerChunkY - RENDER_DISTANCE; cy <= playerChunkY + RENDER_DISTANCE; cy++) {
          renderChunk(ctx, cx, cy)
        }
      }

      // Draw player at center
      drawPlayer(ctx, playerX, playerY)

      ctx.restore()
    }

    const renderChunk = (ctx: CanvasRenderingContext2D, chunkX: number, chunkY: number) => {
      const chunkKey = `${chunkX},${chunkY}`

      // Load or generate chunk
      if (!chunksRef.current.has(chunkKey)) {
        const tiles = generatorRef.current!.generateChunk(chunkX, chunkY)
        chunksRef.current.set(chunkKey, tiles)
      }

      const tiles = chunksRef.current.get(chunkKey)!

      // Render tiles in isometric order (back to front)
      const sortedTiles = [...tiles].sort((a, b) => {
        const aDepth = a.x + a.y
        const bDepth = b.x + b.y
        return aDepth - bDepth
      })

      for (const tile of sortedTiles) {
        drawIsometricTile(ctx, tile)
      }
    }

    const drawIsometricTile = (ctx: CanvasRenderingContext2D, tile: Tile) => {
      const color = generatorRef.current!.getTileColor(tile, worldHealth)

      // Isometric projection
      const screenX = (tile.x - tile.y) * (TILE_SIZE / 2)
      const screenY = (tile.x + tile.y) * (TILE_HEIGHT / 2)

      // Draw diamond-shaped tile
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(screenX, screenY - TILE_HEIGHT)
      ctx.lineTo(screenX + TILE_SIZE / 2, screenY)
      ctx.lineTo(screenX, screenY + TILE_HEIGHT)
      ctx.lineTo(screenX - TILE_SIZE / 2, screenY)
      ctx.closePath()
      ctx.fill()

      // Draw border
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
      ctx.lineWidth = 0.5
      ctx.stroke()
    }

    const drawPlayer = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
      const screenX = (x - y) * (TILE_SIZE / 2)
      const screenY = (x + y) * (TILE_HEIGHT / 2)

      // Draw player character (simple colored circle for now)
      ctx.fillStyle = '#BFFF00' // Lime green accent
      ctx.beginPath()
      ctx.arc(screenX, screenY - TILE_HEIGHT / 2, 8, 0, Math.PI * 2)
      ctx.fill()

      // Draw outline
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Render on next frame
    const animationId = requestAnimationFrame(render)

    return () => cancelAnimationFrame(animationId)
  }, [playerX, playerY, worldHealth, isDark])

  return (
    <canvas
      ref={canvasRef}
      width={typeof window !== 'undefined' ? window.innerWidth : 1920}
      height={typeof window !== 'undefined' ? window.innerHeight : 1080}
      className="absolute inset-0 w-full h-full"
    />
  )
}
