import * as THREE from 'three'

const SKID_MAX = 700
const SMOKE_MAX = 70

/** Tyre marks stamped on the floor plus drifting smoke puffs. */
export class Effects {
  private skids: THREE.InstancedMesh
  private skidIdx = 0
  private dummy = new THREE.Object3D()
  private last: ({ x: number; z: number } | null)[] = [null, null]
  private puffs: { s: THREE.Sprite; life: number; max: number; vx: number; vz: number; vy: number; size: number }[] = []
  private nextPuff = 0

  constructor(scene: THREE.Scene) {
    const skidMat = new THREE.MeshBasicMaterial({ color: '#050505', transparent: true, opacity: 0.55, depthWrite: false })
    skidMat.polygonOffset = true
    skidMat.polygonOffsetFactor = -2
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.26, 0.6), skidMat, SKID_MAX)
    this.skids.frustumCulled = false
    this.skids.renderOrder = 2
    this.dummy.scale.set(0, 0, 0)
    this.dummy.updateMatrix()
    for (let i = 0; i < SKID_MAX; i++) this.skids.setMatrixAt(i, this.dummy.matrix)
    scene.add(this.skids)

    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(c)
    for (let i = 0; i < SMOKE_MAX; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: '#dcdfe4' }))
      s.visible = false
      s.renderOrder = 3
      scene.add(s)
      this.puffs.push({ s, life: 0, max: 1, vx: 0, vz: 0, vy: 0, size: 1 })
    }
  }

  /** Stamp a tyre mark for wheel `i` (0/1) travelling along `angle` (radians around Y). */
  skid(i: number, x: number, z: number, angle: number) {
    const prev = this.last[i]
    if (prev && Math.hypot(x - prev.x, z - prev.z) < 0.34) return
    this.last[i] = { x, z }
    this.dummy.rotation.order = 'YXZ'
    this.dummy.rotation.set(-Math.PI / 2, angle, 0)
    this.dummy.position.set(x, 0.016, z)
    this.dummy.scale.set(1, 1, 1)
    this.dummy.updateMatrix()
    this.skids.setMatrixAt(this.skidIdx, this.dummy.matrix)
    this.skidIdx = (this.skidIdx + 1) % SKID_MAX
    this.skids.instanceMatrix.needsUpdate = true
  }

  lift(i: number) {
    this.last[i] = null
  }

  smoke(x: number, z: number, power: number) {
    const p = this.puffs[this.nextPuff]
    this.nextPuff = (this.nextPuff + 1) % SMOKE_MAX
    p.life = p.max = 0.9 + Math.random() * 0.8
    p.size = 0.7 + power * 0.25
    p.vx = (Math.random() - 0.5) * 0.6
    p.vz = (Math.random() - 0.5) * 0.6
    p.vy = 0.5 + Math.random() * 0.5
    p.s.position.set(x, 0.25, z)
    p.s.visible = true
  }

  clearSkids() {
    this.dummy.scale.set(0, 0, 0)
    this.dummy.updateMatrix()
    for (let i = 0; i < SKID_MAX; i++) this.skids.setMatrixAt(i, this.dummy.matrix)
    this.skids.instanceMatrix.needsUpdate = true
  }

  update(dt: number) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue
      p.life -= dt
      if (p.life <= 0) {
        p.s.visible = false
        continue
      }
      const t = 1 - p.life / p.max
      p.s.position.x += p.vx * dt
      p.s.position.z += p.vz * dt
      p.s.position.y += p.vy * dt
      p.s.scale.setScalar(p.size * (1 + t * 2.4))
      ;(p.s.material as THREE.SpriteMaterial).opacity = 0.42 * (1 - t)
    }
  }
}
