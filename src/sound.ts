/** Synthesised engine, tyre squeal and horn. Created lazily on the first key press (browser autoplay rules). */
export class Sound {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private filter!: BiquadFilterNode
  private oscA!: OscillatorNode
  private oscB!: OscillatorNode
  private squeal!: GainNode
  muted = false

  init() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const ctx = (this.ctx = new AudioContext())
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 500
    this.oscA = ctx.createOscillator()
    this.oscA.type = 'sawtooth'
    this.oscB = ctx.createOscillator()
    this.oscB.type = 'square'
    const gb = ctx.createGain()
    gb.gain.value = 0.45
    this.oscA.connect(this.filter)
    this.oscB.connect(gb).connect(this.filter)
    this.filter.connect(this.master).connect(ctx.destination)
    this.oscA.start()
    this.oscB.start()

    // Looping noise through a band-pass for tyre squeal.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1900
    band.Q.value = 3
    this.squeal = ctx.createGain()
    this.squeal.gain.value = 0
    noise.connect(band).connect(this.squeal).connect(ctx.destination)
    noise.start()
  }

  update(rpm: number, throttle: number, slip: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const f = 38 + rpm * 120
    this.oscA.frequency.setTargetAtTime(f, t, 0.05)
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.05)
    this.filter.frequency.setTargetAtTime(260 + rpm * 1400 + throttle * 700, t, 0.08)
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.05 + throttle * 0.06 + rpm * 0.03, t, 0.06)
    this.squeal.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.12, Math.max(0, slip - 2.5) * 0.03), t, 0.05)
  }

  toggleMute() {
    this.muted = !this.muted
    return this.muted
  }

  horn() {
    this.init()
    const ctx = this.ctx!
    const t = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(this.muted ? 0.0001 : 0.15, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    gain.connect(ctx.destination)
    for (const f of [392, 494]) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = f
      o.connect(gain)
      o.start(t)
      o.stop(t + 0.5)
    }
  }
}
