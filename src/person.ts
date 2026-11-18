import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Car } from './car'
import { ROOM, obstacles } from './garage'

type State = 'inside' | 'exiting' | 'onfoot' | 'approach' | 'entering'

export interface WalkInput {
  fwd: number // -1..1
  turn: number // -1 (right) .. 1 (left)
  run: boolean
}

const sm = (t: number, a: number, b: number) => {
  const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1)
  return x * x * (3 - 2 * x)
}
const lerp = THREE.MathUtils.lerp

// Where the person stands next to the driver's door, in the car's local axes (+x is the car's left).
const DOOR_X = 1.75
const DOOR_Z = 0.1
const RADIUS = 0.32

/** A low-poly driver that can step out of the car, walk around the garage and get back in. */
export class Person {
  readonly group = new THREE.Group()
  state: State = 'inside'
  heading = 0

  private rig = new THREE.Group()
  private torso = new THREE.Group()
  private head = new THREE.Group()
  private hip: THREE.Group[] = []
  private knee: THREE.Group[] = []
  private shoulder: THREE.Group[] = []
  private elbow: THREE.Group[] = []
  private p = 0 // exit progress 0..1 (entering plays it backwards)
  private phase = 0
  private walkAmt = 0
  private onFootTime = 0
  private clock = 0

  constructor(scene: THREE.Scene) {
    const mat = (color: string, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough })
    const skin = mat('#d9a47e', 0.6)
    const hoodie = mat('#3b4a66', 0.85)
    const jeans = mat('#2d3b5c', 0.9)
    const shoe = mat('#ece9e2', 0.55)
    const sole = mat('#cfcac0', 0.7)
    const hair = mat('#1f1611', 0.85)
    const white = mat('#f5f5f2', 0.4)
    const iris = mat('#2b1a10', 0.3)
    const lip = mat('#a8605a', 0.6)

    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const o = new THREE.Mesh(geo, m)
      o.position.set(x, y, z)
      o.castShadow = true
      o.receiveShadow = true
      parent.add(o)
      return o
    }
    const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14)

    // Legs: hip -> thigh -> knee -> shin -> trainer.
    for (const side of [1, -1]) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.095, 0.93, 0)
      mesh(capsule(0.088, 0.32), jeans, 0, -0.21, 0, hip)
      const knee = new THREE.Group()
      knee.position.set(0, -0.44, 0)
      mesh(capsule(0.066, 0.31), jeans, 0, -0.2, 0, knee)
      const foot = mesh(new RoundedBoxGeometry(0.105, 0.075, 0.27, 4, 0.035), shoe, 0, -0.455, 0.05, knee)
      foot.scale.set(1, 1, 1)
      mesh(new RoundedBoxGeometry(0.11, 0.02, 0.28, 2, 0.01), sole, 0, -0.495, 0.05, knee)
      hip.add(knee)
      this.rig.add(hip)
      this.hip.push(hip)
      this.knee.push(knee)
    }

    // Pelvis and upper body (the torso group twists a little when walking).
    const pelvis = mesh(new THREE.SphereGeometry(0.15, 18, 14), jeans, 0, 0.95, 0, this.rig)
    pelvis.scale.set(1.25, 0.75, 0.85)
    this.torso.position.set(0, 0.95, 0)
    this.rig.add(this.torso)
    const chest = mesh(capsule(0.14, 0.2), hoodie, 0, 0.3, 0, this.torso)
    chest.scale.set(1.3, 1, 0.82)
    const waist = mesh(new THREE.CylinderGeometry(0.15, 0.165, 0.2, 18), hoodie, 0, 0.06, 0, this.torso)
    waist.scale.set(1.15, 1, 0.8)
    const shoulders = mesh(capsule(0.07, 0.3), hoodie, 0, 0.5, 0, this.torso)
    shoulders.rotation.z = Math.PI / 2
    // Hood bunched around the neck.
    const hood = mesh(new THREE.TorusGeometry(0.075, 0.035, 10, 20), hoodie, 0, 0.56, -0.01, this.torso)
    hood.rotation.x = Math.PI / 2
    hood.scale.set(1.2, 1, 1)
    mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.1, 12), skin, 0, 0.6, 0, this.torso)

    // Head with face.
    this.head.position.set(0, 0.74, 0.01)
    this.torso.add(this.head)
    const skull = mesh(new THREE.SphereGeometry(0.105, 26, 20), skin, 0, 0, 0, this.head)
    skull.scale.set(0.9, 1.12, 1.0)
    const jaw = mesh(new THREE.SphereGeometry(0.08, 18, 14), skin, 0, -0.045, 0.012, this.head)
    jaw.scale.set(0.95, 0.9, 1)
    const hairCap = mesh(new THREE.SphereGeometry(0.113, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, 0, 0.012, -0.012, this.head)
    hairCap.scale.set(0.93, 1.12, 1.04)
    const fringe = mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI, 0, Math.PI * 0.35), hair, 0, 0.065, 0.045, this.head)
    fringe.rotation.x = -0.35
    fringe.scale.set(1, 0.6, 0.9)
    for (const x of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.022, 10, 8), skin, x * 0.093, -0.005, -0.005, this.head).scale.set(0.5, 1.2, 0.9)
      mesh(new THREE.SphereGeometry(0.014, 12, 10), white, x * 0.036, 0.012, 0.097, this.head).scale.set(1.15, 0.8, 0.6)
      mesh(new THREE.SphereGeometry(0.0075, 10, 8), iris, x * 0.036, 0.012, 0.106, this.head)
      const brow = mesh(new THREE.BoxGeometry(0.036, 0.007, 0.01), hair, x * 0.036, 0.036, 0.1, this.head)
      brow.rotation.z = x * -0.12
    }
    const nose = mesh(new THREE.SphereGeometry(0.018, 12, 10), skin, 0, -0.012, 0.108, this.head)
    nose.scale.set(0.8, 1.3, 1.1)
    mesh(new THREE.BoxGeometry(0.04, 0.007, 0.01), lip, 0, -0.057, 0.098, this.head)

    // Arms: shoulder -> upper arm -> elbow -> forearm -> hand.
    for (const side of [1, -1]) {
      const sh = new THREE.Group()
      sh.position.set(side * 0.215, 0.48, 0)
      mesh(capsule(0.052, 0.19), hoodie, 0, -0.17, 0, sh)
      const elbow = new THREE.Group()
      elbow.position.set(0, -0.31, 0)
      mesh(capsule(0.044, 0.18), hoodie, 0, -0.16, 0, elbow)
      mesh(new THREE.SphereGeometry(0.047, 14, 12), skin, 0, -0.34, 0.005, elbow).scale.set(0.85, 1.2, 1)
      sh.add(elbow)
      this.torso.add(sh)
      this.shoulder.push(sh)
      this.elbow.push(elbow)
    }

    this.group.add(this.rig)
    this.group.visible = false
    scene.add(this.group)
  }

  get position() {
    return this.group.position
  }

  get active() {
    return this.state !== 'inside'
  }

  /** World position of the spot beside the driver's door. */
  doorPoint(car: Car) {
    return this.toWorld(car, DOOR_X, DOOR_Z)
  }

  distanceToDoor(car: Car) {
    const d = this.doorPoint(car)
    return Math.hypot(d.x - this.group.position.x, d.z - this.group.position.z)
  }

  private toWorld(car: Car, lx: number, lz: number) {
    const s = Math.sin(car.heading)
    const k = Math.cos(car.heading)
    return { x: car.position.x + lx * k + lz * s, z: car.position.z - lx * s + lz * k }
  }

  exit(car: Car) {
    if (this.state !== 'inside') return
    this.state = 'exiting'
    this.p = 0
    this.onFootTime = 0
    this.group.visible = true
    this.applyExit(car)
  }

  /** Start walking back to the door. Returns false if the car is too far away. */
  tryEnter(car: Car) {
    if (this.state !== 'onfoot' || this.distanceToDoor(car) > 4) return false
    this.state = 'approach'
    return true
  }

  update(dt: number, car: Car, input: WalkInput) {
    switch (this.state) {
      case 'inside':
        car.door += (0 - car.door) * Math.min(1, dt * 5)
        return
      case 'exiting':
        this.p = Math.min(1, this.p + dt / 1.8)
        this.applyExit(car)
        car.door = sm(this.p, 0, 0.22)
        if (this.p >= 1) {
          this.state = 'onfoot'
          this.heading = car.heading
        }
        return
      case 'approach': {
        const d = this.doorPoint(car)
        const dx = d.x - this.group.position.x
        const dz = d.z - this.group.position.z
        const dist = Math.hypot(dx, dz)
        car.door += (1 - car.door) * Math.min(1, dt * 5)
        if (dist < 0.1) {
          this.state = 'entering'
          this.p = 1
          return
        }
        this.heading = Math.atan2(dx, dz)
        const step = Math.min(dist, 2.6 * dt)
        this.group.position.x += (dx / dist) * step
        this.group.position.z += (dz / dist) * step
        this.walk(dt, 1)
        this.finish()
        return
      }
      case 'entering':
        this.p = Math.max(0, this.p - dt / 1.6)
        this.applyExit(car)
        car.door = Math.max(sm(this.p, 0, 0.22), 0)
        if (this.p <= 0) {
          this.state = 'inside'
          this.group.visible = false
        }
        return
      case 'onfoot':
        this.onFootTime += dt
        // The door swings shut shortly after the driver steps away.
        if (this.onFootTime > 0.8) car.door += (0 - car.door) * Math.min(1, dt * 4)
        this.moveOnFoot(dt, car, input)
    }
  }

  private moveOnFoot(dt: number, car: Car, input: WalkInput) {
    this.heading += input.turn * 2.6 * dt
    const speed = input.fwd * (input.run ? 4.6 : 2.3)
    const dx = Math.sin(this.heading) * speed * dt
    const dz = Math.cos(this.heading) * speed * dt
    const p = this.group.position
    if (!this.blocked(p.x + dx, p.z, car)) p.x += dx
    if (!this.blocked(p.x, p.z + dz, car)) p.z += dz
    this.walk(dt, Math.max(Math.abs(input.fwd), Math.abs(input.turn) * 0.35) * (input.run ? 1.6 : 1))
    this.finish()
  }

  private walk(dt: number, amount: number) {
    this.walkAmt += (Math.min(amount, 1.6) - this.walkAmt) * Math.min(1, dt * 10)
    this.phase += dt * (3.6 + this.walkAmt * 3.6)
    this.pose(0)
  }

  private finish() {
    this.group.rotation.y = this.heading
  }

  /** Position/pose while sliding out of (or into) the driver's seat. */
  private applyExit(car: Car) {
    const p = this.p
    const lx = lerp(0.85, 1.12, sm(p, 0.1, 0.45)) + (DOOR_X - 1.12) * sm(p, 0.5, 0.95)
    const w = this.toWorld(car, lx, DOOR_Z)
    this.group.position.set(w.x, 0, w.z)
    this.heading = car.heading + (Math.PI / 2) * (sm(p, 0.2, 0.55) - sm(p, 0.72, 1))
    this.group.rotation.y = this.heading
    this.walkAmt = 0.7 * sm(p, 0.65, 0.8)
    this.phase += 0.12
    this.pose(1 - sm(p, 0.3, 0.75))
  }

  /** seat: 1 = seated, 0 = standing. */
  private pose(seat: number) {
    this.clock += 0.016
    const w = this.walkAmt * (1 - seat)
    const swing = Math.sin(this.phase) * 0.62 * w
    const hip = (-Math.PI / 2) * seat
    // Legs: the knee only bends while the foot is swinging forward, like a real stride.
    this.hip[0].rotation.x = hip + swing
    this.hip[1].rotation.x = hip - swing
    this.knee[0].rotation.x = (Math.PI / 2) * seat + Math.max(0, -Math.cos(this.phase) * w) * 0.9 * (swing < 0 ? 1 : 0.25) + 0.05
    this.knee[1].rotation.x = (Math.PI / 2) * seat + Math.max(0, Math.cos(this.phase) * w) * 0.9 * (swing > 0 ? 1 : 0.25) + 0.05
    // Arms swing opposite the legs with a relaxed bend at the elbow.
    this.shoulder[0].rotation.x = -swing * 0.8 - 0.85 * seat + 0.04
    this.shoulder[1].rotation.x = swing * 0.8 - 0.85 * seat + 0.04
    this.shoulder[0].rotation.z = -0.07
    this.shoulder[1].rotation.z = 0.07
    this.elbow[0].rotation.x = -0.25 - Math.max(0, -swing) * 0.9 - 0.8 * seat
    this.elbow[1].rotation.x = -0.25 - Math.max(0, swing) * 0.9 - 0.8 * seat
    // Torso: counter-twist, slight forward lean when moving fast, gentle breathing when idle.
    this.torso.rotation.y = -Math.sin(this.phase) * 0.14 * w
    this.torso.rotation.x = 0.04 + w * 0.06 + seat * 0.05
    this.torso.scale.y = 1 + Math.sin(this.clock * 2.2) * 0.008
    this.head.rotation.y = Math.sin(this.phase) * 0.06 * w + Math.sin(this.clock * 0.7) * 0.05 * (1 - w)
    this.head.rotation.x = -0.03 - w * 0.04
    // Body height: lowered when seated, small bob while walking.
    this.rig.position.y = lerp(0, -0.3, seat) - Math.abs(Math.cos(this.phase)) * 0.03 * w
  }

  private blocked(x: number, z: number, car: Car) {
    const hw = ROOM.w / 2 - RADIUS - 0.1
    const hd = ROOM.d / 2 - RADIUS - 0.1
    if (Math.abs(x) > hw || Math.abs(z) > hd) return true
    for (const o of obstacles) {
      if (x > o.minX - RADIUS && x < o.maxX + RADIUS && z > o.minZ - RADIUS && z < o.maxZ + RADIUS) return true
    }
    // The parked car is a solid box in its own local space.
    const dx = x - car.position.x
    const dz = z - car.position.z
    const lx = dx * Math.cos(car.heading) - dz * Math.sin(car.heading)
    const lz = dx * Math.sin(car.heading) + dz * Math.cos(car.heading)
    return Math.abs(lx) < 0.98 + RADIUS && Math.abs(lz) < 2.33 + RADIUS
  }
}
