import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { ROOM, obstacles } from './garage'

export interface Controls {
  throttle: boolean
  brake: boolean
  left: boolean
  right: boolean
  handbrake: boolean
}

// Local car axes: +z is the nose, +x is the driver's left.
const HALF_W = 0.98
const HALF_L = 2.3
const WHEELBASE = 2.7
const WHEEL_R = 0.38
const MAX_FWD = 13 // m/s
const MAX_REV = 5
const MAX_STEER = 0.55

export class Car {
  readonly group = new THREE.Group()
  heading = Math.PI // facing the back wall
  speed = 0
  steer = 0
  headlightsOn = true

  private frontPivots: THREE.Object3D[] = []
  private wheelSpinners: THREE.Object3D[] = []
  private tailMat = new THREE.MeshStandardMaterial({ color: '#7a0b0b', emissive: '#ff0000', emissiveIntensity: 0.6 })
  private headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 2.5 })
  private beams: THREE.SpotLight[] = []
  private body: THREE.Group

  constructor() {
    this.body = new THREE.Group()
    this.group.add(this.body)
    this.build()
    this.reset()
  }

  reset() {
    this.group.position.set(0, 0, 6)
    this.heading = Math.PI
    this.speed = 0
    this.steer = 0
    this.sync()
  }

  get position() {
    return this.group.position
  }

  private build() {
    const paint = new THREE.MeshPhysicalMaterial({ color: '#d62828', roughness: 0.25, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08 })
    const glass = new THREE.MeshPhysicalMaterial({ color: '#10161d', roughness: 0.05, metalness: 0.1, transmission: 0, clearcoat: 1 })
    const trim = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6, metalness: 0.3 })
    const chrome = new THREE.MeshStandardMaterial({ color: '#d7dbe0', roughness: 0.2, metalness: 1 })

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      parent.add(m)
      return m
    }
    const rbox = (w: number, h: number, d: number, r = 0.12) => new RoundedBoxGeometry(w, h, d, 4, r)

    // Lower body, bonnet and boot.
    add(rbox(1.96, 0.62, 4.6, 0.2), paint, 0, 0.66, 0)
    add(rbox(1.8, 0.16, 1.4, 0.07), paint, 0, 1.0, 1.45) // bonnet crown
    add(rbox(1.8, 0.16, 1.1, 0.07), paint, 0, 1.0, -1.7) // boot lid
    // Cabin and glass.
    add(rbox(1.62, 0.56, 2.1, 0.12), glass, 0, 1.28, -0.2)
    add(rbox(1.7, 0.09, 2.3, 0.04), paint, 0, 1.6, -0.25) // roof
    for (const x of [-0.81, 0.81]) {
      for (const z of [0.78, -1.18]) add(new THREE.BoxGeometry(0.07, 0.56, 0.12), paint, x, 1.28, z) // pillars
      add(new THREE.BoxGeometry(0.07, 0.56, 0.1), paint, x, 1.28, -0.2) // B pillar
    }
    // Bumpers, grille, side skirts.
    add(rbox(1.9, 0.22, 0.2, 0.06), trim, 0, 0.42, 2.3)
    add(rbox(1.9, 0.22, 0.2, 0.06), trim, 0, 0.42, -2.3)
    add(new THREE.BoxGeometry(1.0, 0.2, 0.05), trim, 0, 0.66, 2.32)
    add(new THREE.BoxGeometry(0.06, 0.12, 4.0), trim, 0.99, 0.36, 0)
    add(new THREE.BoxGeometry(0.06, 0.12, 4.0), trim, -0.99, 0.36, 0)
    // Spoiler.
    add(rbox(1.7, 0.06, 0.4, 0.02), trim, 0, 1.22, -2.15)
    for (const x of [-0.7, 0.7]) add(new THREE.BoxGeometry(0.06, 0.28, 0.12), trim, x, 1.06, -2.15)
    // Mirrors.
    for (const x of [-1.05, 1.05]) add(rbox(0.16, 0.14, 0.26, 0.04), paint, x, 1.2, 0.72)
    // Racing stripe.
    const stripe = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.3, metalness: 0.4 })
    add(new THREE.BoxGeometry(0.34, 0.012, 4.4), stripe, 0, 1.081, 0).scale.set(1, 1, 0.99)

    // Headlights and tail lights.
    for (const x of [-0.68, 0.68]) {
      add(rbox(0.4, 0.14, 0.08, 0.04), this.headMat, x, 0.74, 2.3)
      add(rbox(0.42, 0.13, 0.08, 0.04), this.tailMat, x, 0.82, -2.31)
      const beam = new THREE.SpotLight('#fff3d6', 90, 22, Math.PI / 6, 0.55, 1.2)
      beam.position.set(x, 0.75, 2.2)
      beam.target.position.set(x * 0.6, 0.2, 9)
      this.body.add(beam, beam.target)
      this.beams.push(beam)
    }

    // Wheels: [x, z, steered]
    const tyreMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 })
    const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 28)
    tyreGeo.rotateZ(Math.PI / 2)
    const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.32, 12)
    rimGeo.rotateZ(Math.PI / 2)
    const spokeGeo = new THREE.BoxGeometry(0.33, 0.05, 0.5)

    const wheelSpots: [number, number, boolean][] = [
      [-HALF_W + 0.1, WHEELBASE / 2, true],
      [HALF_W - 0.1, WHEELBASE / 2, true],
      [-HALF_W + 0.1, -WHEELBASE / 2, false],
      [HALF_W - 0.1, -WHEELBASE / 2, false],
    ]
    for (const [x, z, steered] of wheelSpots) {
      const pivot = new THREE.Group()
      pivot.position.set(x, WHEEL_R, z)
      const spin = new THREE.Group()
      pivot.add(spin)
      add(tyreGeo, tyreMat, 0, 0, 0, spin)
      add(rimGeo, chrome, 0, 0, 0, spin)
      for (let k = 0; k < 3; k++) {
        const s = add(spokeGeo, trim, 0, 0, 0, spin)
        s.rotation.x = (k * Math.PI) / 3
      }
      this.body.add(pivot)
      this.wheelSpinners.push(spin)
      if (steered) this.frontPivots.push(pivot)
    }
  }

  toggleHeadlights() {
    this.headlightsOn = !this.headlightsOn
  }

  /** Advance the simulation by dt seconds. Returns true if the car hit something. */
  update(dt: number, c: Controls): boolean {
    // Steering eases toward the target and is limited at speed.
    const lock = MAX_STEER * (1 - Math.min(Math.abs(this.speed) / (MAX_FWD * 1.6), 0.55))
    const target = (c.left ? 1 : 0) * lock - (c.right ? 1 : 0) * lock
    this.steer += (target - this.steer) * Math.min(1, dt * 8)

    // Longitudinal forces.
    let accel = 0
    if (c.throttle) accel += this.speed < 0 ? 16 : 9
    if (c.brake) accel -= this.speed > 0.3 ? 16 : 6
    if (!c.throttle && !c.brake) accel -= Math.sign(this.speed) * 2.2 // engine braking
    accel -= this.speed * 0.25 // drag
    if (c.handbrake) accel -= Math.sign(this.speed) * 22
    const prev = this.speed
    this.speed += accel * dt
    // Stop cleanly instead of jittering around zero.
    if (!c.throttle && !c.brake && prev * this.speed < 0) this.speed = 0
    if (c.handbrake && prev * this.speed < 0) this.speed = 0
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REV, MAX_FWD)

    // Bicycle-model turning.
    const turn = (this.speed / WHEELBASE) * Math.tan(this.steer)
    const nextHeading = this.heading + turn * dt
    const fx = Math.sin(nextHeading)
    const fz = Math.cos(nextHeading)
    const step = this.speed * dt
    const p = this.group.position
    let hit = false

    // Resolve x and z separately so the car slides along walls instead of sticking.
    if (!this.blocked(p.x + fx * step, p.z, nextHeading)) p.x += fx * step
    else hit = true
    if (!this.blocked(p.x, p.z + fz * step, nextHeading)) p.z += fz * step
    else hit = true
    if (!this.blocked(p.x, p.z, nextHeading)) this.heading = nextHeading
    else hit = true
    if (hit) this.speed *= -0.25

    // Wheel animation and lights.
    for (const w of this.wheelSpinners) w.rotation.x += (this.speed * dt) / WHEEL_R
    for (const f of this.frontPivots) f.rotation.y = this.steer
    const braking = c.brake && this.speed > 0.3
    this.tailMat.emissiveIntensity = braking || c.handbrake ? 4 : this.speed < -0.2 ? 1.8 : 0.6
    this.headMat.emissiveIntensity = this.headlightsOn ? 2.5 : 0.05
    for (const b of this.beams) b.intensity = this.headlightsOn ? 90 : 0

    this.sync()
    return hit
  }

  private sync() {
    this.group.rotation.y = this.heading
    // Slight body roll and pitch for a bit of life.
    const t = this.steer * Math.min(Math.abs(this.speed) / MAX_FWD, 1)
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, t * 0.06, 0.2)
  }

  private blocked(x: number, z: number, heading: number): boolean {
    const s = Math.sin(heading)
    const k = Math.cos(heading)
    const hw = ROOM.w / 2 - 0.1
    const hd = ROOM.d / 2 - 0.1
    // Test the corners plus the midpoints of every edge.
    const pts: [number, number][] = []
    for (const lx of [-HALF_W, 0, HALF_W]) for (const lz of [-HALF_L, 0, HALF_L]) pts.push([lx, lz])
    for (const [lx, lz] of pts) {
      const wx = x + lx * k + lz * s
      const wz = z - lx * s + lz * k
      if (Math.abs(wx) > hw || Math.abs(wz) > hd) return true
      for (const o of obstacles) {
        if (wx > o.minX && wx < o.maxX && wz > o.minZ && wz < o.maxZ) return true
      }
    }
    return false
  }
}
