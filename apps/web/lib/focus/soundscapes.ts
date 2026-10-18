// ─── Focus soundscapes ────────────────────────────────────────────────────────
// Ambient sound made in the browser with Web Audio: no recordings, so nothing
// to license and nothing to download. Each soundscape is a small graph of
// noise, filters and slow modulation, with occasional events (a raindrop, a
// bird, a crackle) scheduled at random. Several can play at once, each at its
// own volume, under one master volume.
//
// The noise generators are pure and exported for tests; the engine needs a
// browser AudioContext and is created only after a click (browsers refuse to
// start audio before one).

export type SoundId = 'rain' | 'forest' | 'ocean' | 'fire' | 'cafe' | 'brown' | 'white'

export const SOUNDS: Array<{ id: SoundId; name: string; hint: string }> = [
  { id: 'rain',   name: 'Rain',        hint: 'Steady rain on a window' },
  { id: 'forest', name: 'Forest',      hint: 'Wind in leaves, a few birds' },
  { id: 'ocean',  name: 'Ocean',       hint: 'Slow waves' },
  { id: 'fire',   name: 'Fireplace',   hint: 'A low fire, crackling' },
  { id: 'cafe',   name: 'Café',        hint: 'Murmur of a quiet café' },
  { id: 'brown',  name: 'Brown noise', hint: 'Deep, even, for blocking out' },
  { id: 'white',  name: 'White noise', hint: 'Bright, even hiss' },
]

// ── Noise, pure ───────────────────────────────────────────────────────────────
// A seeded generator, so a test sees the same samples every run.
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

export function whiteNoise(length: number, rand: () => number = Math.random): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1
  return out
}

// Paul Kellet's refined pink filter: equal energy per octave.
export function pinkNoise(length: number, rand: () => number = Math.random): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < length; i++) {
    const w = rand() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852;    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522;    b5 = -0.7616 * b5 - w * 0.016898
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
  }
  return out
}

// Integrated white noise, kept from drifting: a deep rumble.
export function brownNoise(length: number, rand: () => number = Math.random): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length)
  let last = 0
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02
    out[i] = last * 3.5
  }
  return out
}

// ── The engine ───────────────────────────────────────────────────────────────

type Voice = { gain: GainNode; stop: () => void }

const FADE = 0.8

export class SoundEngine {
  private ctx: AudioContext
  private master: GainNode
  private buffers: Partial<Record<'white' | 'pink' | 'brown', AudioBuffer>> = {}
  private voices = new Map<SoundId, Voice>()

  constructor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.8
    this.master.connect(this.ctx.destination)
  }

  get playing(): SoundId[] { return [...this.voices.keys()] }

  async resume() { if (this.ctx.state === 'suspended') await this.ctx.resume() }

  setMaster(volume: number) {
    this.master.gain.setTargetAtTime(clamp(volume), this.ctx.currentTime, 0.05)
  }

  setVolume(id: SoundId, volume: number) {
    const v = this.voices.get(id)
    if (v) v.gain.gain.setTargetAtTime(clamp(volume), this.ctx.currentTime, 0.08)
  }

  start(id: SoundId, volume: number) {
    if (this.voices.has(id)) { this.setVolume(id, volume); return }
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    gain.connect(this.master)
    const stop = this.build(id, gain)
    gain.gain.setTargetAtTime(clamp(volume), this.ctx.currentTime, FADE / 3)
    this.voices.set(id, { gain, stop })
  }

  stop(id: SoundId) {
    const v = this.voices.get(id)
    if (!v) return
    this.voices.delete(id)
    v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, FADE / 4)
    window.setTimeout(() => { v.stop(); v.gain.disconnect() }, FADE * 1000 + 200)
  }

  stopAll() { for (const id of [...this.voices.keys()]) this.stop(id) }

  dispose() {
    for (const v of this.voices.values()) v.stop()
    this.voices.clear()
    void this.ctx.close()
  }

  // ── Building blocks ──
  private buffer(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const cached = this.buffers[kind]
    if (cached) return cached
    const seconds = 6, rate = this.ctx.sampleRate
    const buf = this.ctx.createBuffer(2, seconds * rate, rate)
    for (let ch = 0; ch < 2; ch++) {
      const data = kind === 'white' ? whiteNoise(buf.length) : kind === 'pink' ? pinkNoise(buf.length) : brownNoise(buf.length)
      buf.copyToChannel(data, ch)
    }
    return (this.buffers[kind] = buf)
  }

  private noise(kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer(kind)
    src.loop = true
    // Start somewhere different each time, so two layers never line up.
    src.start(0, Math.random() * 5)
    return src
  }

  private filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter()
    f.type = type; f.frequency.value = frequency; f.Q.value = q
    return f
  }

  // A slow wobble on a parameter: base ± depth at `hz`.
  private lfo(param: AudioParam, hz: number, depth: number): OscillatorNode {
    const osc = this.ctx.createOscillator()
    const amount = this.ctx.createGain()
    osc.frequency.value = hz; amount.gain.value = depth
    osc.connect(amount).connect(param)
    osc.start()
    return osc
  }

  // Calls `fire` at random intervals between min and max seconds until stopped.
  private every(minS: number, maxS: number, fire: () => void): () => void {
    let timer = 0, alive = true
    const next = () => {
      if (!alive) return
      timer = window.setTimeout(() => { if (alive) { fire(); next() } }, (minS + Math.random() * (maxS - minS)) * 1000)
    }
    next()
    return () => { alive = false; window.clearTimeout(timer) }
  }

  // A short burst of filtered noise: a drop, a crackle, a clink.
  private burst(out: AudioNode, opts: { kind: 'white' | 'pink'; type: BiquadFilterType; freq: number; q: number; level: number; attack: number; decay: number; pan?: number }) {
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer(opts.kind)
    const f = this.filter(opts.type, opts.freq, opts.q)
    const g = this.ctx.createGain()
    const p = this.ctx.createStereoPanner()
    p.pan.value = opts.pan ?? (Math.random() * 2 - 1) * 0.8
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(opts.level, t + opts.attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay)
    src.connect(f).connect(g).connect(p).connect(out)
    src.start(t, Math.random() * 5, opts.attack + opts.decay + 0.05)
  }

  private chirp(out: AudioNode) {
    const t = this.ctx.currentTime
    const notes = 2 + Math.floor(Math.random() * 3)
    const pan = this.ctx.createStereoPanner()
    pan.pan.value = (Math.random() * 2 - 1) * 0.9
    pan.connect(out)
    for (let i = 0; i < notes; i++) {
      const at = t + i * (0.09 + Math.random() * 0.06)
      const osc = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      const base = 2400 + Math.random() * 1600
      osc.type = 'sine'
      osc.frequency.setValueAtTime(base, at)
      osc.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), at + 0.07)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.05, at + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11)
      osc.connect(g).connect(pan)
      osc.start(at); osc.stop(at + 0.13)
    }
  }

  // ── The soundscapes ──
  private build(id: SoundId, out: GainNode): () => void {
    const nodes: AudioScheduledSourceNode[] = []
    const cancels: Array<() => void> = []
    const keep = <T extends AudioScheduledSourceNode>(n: T) => { nodes.push(n); return n }

    switch (id) {
      case 'white': {
        const g = this.ctx.createGain(); g.gain.value = 0.18
        keep(this.noise('white')).connect(this.filter('lowpass', 9000)).connect(g).connect(out)
        break
      }
      case 'brown': {
        const g = this.ctx.createGain(); g.gain.value = 0.9
        keep(this.noise('brown')).connect(this.filter('lowpass', 900)).connect(g).connect(out)
        break
      }
      case 'rain': {
        // The body of the rain: pink noise without its rumble or its hiss.
        const g = this.ctx.createGain(); g.gain.value = 0.55
        keep(this.noise('pink')).connect(this.filter('highpass', 450)).connect(this.filter('lowpass', 7000)).connect(g).connect(out)
        // Drops on the glass, close and far.
        cancels.push(this.every(0.04, 0.22, () => this.burst(out, { kind: 'white', type: 'bandpass', freq: 2500 + Math.random() * 3500, q: 6, level: 0.05 + Math.random() * 0.12, attack: 0.002, decay: 0.03 + Math.random() * 0.05 })))
        break
      }
      case 'ocean': {
        const g = this.ctx.createGain(); g.gain.value = 0.5
        const lp = this.filter('lowpass', 900)
        keep(this.noise('brown')).connect(lp).connect(g).connect(out)
        keep(this.lfo(g.gain, 0.075, 0.35))
        keep(this.lfo(lp.frequency, 0.075, 500))
        // The hiss as a wave breaks.
        const hiss = this.ctx.createGain(); hiss.gain.value = 0.05
        keep(this.noise('pink')).connect(this.filter('highpass', 2500)).connect(hiss).connect(out)
        keep(this.lfo(hiss.gain, 0.075, 0.05))
        break
      }
      case 'forest': {
        const g = this.ctx.createGain(); g.gain.value = 0.35
        const bp = this.filter('bandpass', 700, 0.6)
        keep(this.noise('pink')).connect(bp).connect(g).connect(out)
        keep(this.lfo(bp.frequency, 0.05, 300))
        keep(this.lfo(g.gain, 0.11, 0.12))
        cancels.push(this.every(2.5, 9, () => this.chirp(out)))
        break
      }
      case 'fire': {
        const g = this.ctx.createGain(); g.gain.value = 0.7
        keep(this.noise('brown')).connect(this.filter('lowpass', 500)).connect(g).connect(out)
        keep(this.lfo(g.gain, 0.3, 0.15))
        cancels.push(this.every(0.05, 0.5, () => this.burst(out, { kind: 'white', type: 'highpass', freq: 1800 + Math.random() * 2000, q: 0.8, level: 0.04 + Math.random() * 0.2, attack: 0.001, decay: 0.006 + Math.random() * 0.03 })))
        break
      }
      case 'cafe': {
        // Voices are mostly 200–1500 Hz; a slow wander makes it a room.
        const g = this.ctx.createGain(); g.gain.value = 0.4
        const bp = this.filter('bandpass', 650, 0.9)
        keep(this.noise('pink')).connect(bp).connect(g).connect(out)
        keep(this.lfo(bp.frequency, 0.21, 220))
        keep(this.lfo(g.gain, 0.37, 0.1))
        cancels.push(this.every(4, 14, () => this.burst(out, { kind: 'white', type: 'bandpass', freq: 3000 + Math.random() * 1500, q: 18, level: 0.07, attack: 0.002, decay: 0.35 })))
        break
      }
    }

    return () => {
      for (const c of cancels) c()
      for (const n of nodes) { try { n.stop() } catch { /* already stopped */ } n.disconnect() }
    }
  }
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
