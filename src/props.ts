import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Car } from './car'
import { ROOM, obstacles, type ShelfUnit, type Spawn } from './garage'
import type { Person } from './person'

interface Body {
  spawn: Spawn
  mesh: THREE.Group
  kind: Spawn['kind']
  r: number
  h: number
  mass: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  yawVel: number
  spinX: number
  spinZ: number
  shelf: number | null // still resting on this shelving unit
  carried: boolean
  init: { x: number; y: number; z: number; yaw: number; shelf: number | null }
}

const FRICTION = { box: 3.2, barrel: 1.7, tyres: 2.0 }
const CAR_HALF_W = 0.98
const CAR_HALF_L = 2.33
const PERSON_R = 0.32
const REACH = 1.7

/** Boxes, barrels and tyres you can shove, knock off shelves, pick up, carry and throw. */
export class Props {
  private bodies: Body[] = []
  private rattle: number[]
  private clock = 0
  private carriedBody: Body | null = null
  private thumpCooldown = 0

  constructor(scene: THREE.Scene, spawns: Spawn[], private shelves: ShelfUnit[]) {
    this.rattle = shelves.map(() => 0)
    const tape = new THREE.MeshStandardMaterial({ color: '#d9c9a0', roughness: 0.6 })
    const ring = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.5, metalness: 0.6 })
    const tyre = new THREE.MeshStandardMaterial({ color: '#171717', roughness: 0.9 })

    for (const sp of spawns) {
      const mesh = new THREE.Group()
      const mat = new THREE.MeshStandardMaterial({ color: sp.color, roughness: sp.kind === 'barrel' ? 0.45 : 0.85, metalness: sp.kind === 'barrel' ? 0.5 : 0 })
      const add = (m: THREE.Mesh) => {
        m.castShadow = m.receiveShadow = true
        mesh.add(m)
        return m
      }
      if (sp.kind === 'box') {
        add(new THREE.Mesh(new RoundedBoxGeometry(sp.w, sp.h, sp.d, 3, 0.03), mat)).position.y = sp.h / 2
        const strip = add(new THREE.Mesh(new THREE.BoxGeometry(sp.w * 0.18, 0.012, sp.d * 1.002), tape))
        strip.position.y = sp.h + 0.001
      } else if (sp.kind === 'barrel') {
        add(new THREE.Mesh(new THREE.CylinderGeometry(sp.w / 2, sp.w / 2, sp.h, 24), mat)).position.y = sp.h / 2
        for (const y of [0.25, sp.h - 0.25]) add(new THREE.Mesh(new THREE.CylinderGeometry(sp.w / 2 + 0.012, sp.w / 2 + 0.012, 0.05, 24), ring)).position.y = y
      } else {
        for (let i = 0; i < 4; i++) {
          const t = add(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.2, 14, 28), tyre))
          t.rotation.x = Math.PI / 2
          t.position.y = 0.2 + i * 0.4
        }
      }
      scene.add(mesh)
      const r = Math.max(sp.w, sp.d) / 2 * (sp.kind === 'box' ? 1.0 : 1.0)
      this.bodies.push({
        spawn: sp, mesh, kind: sp.kind, r, h: sp.h, mass: sp.mass,
        x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0, yaw: Math.random() * 0.08 - 0.04, yawVel: 0, spinX: 0, spinZ: 0,
        shelf: sp.shelf ?? null, carried: false,
        init: { x: sp.x, y: sp.y, z: sp.z, yaw: 0, shelf: sp.shelf ?? null },
      })
      const b = this.bodies[this.bodies.length - 1]
      b.init.yaw = b.yaw
      this.place(b)
    }
  }

  get carrying() {
    return this.carriedBody !== null
  }

  /** Put everything back where it started. */
  reset() {
    this.carriedBody = null
    for (const b of this.bodies) {
      Object.assign(b, { x: b.init.x, y: b.init.y, z: b.init.z, yaw: b.init.yaw, shelf: b.init.shelf, vx: 0, vy: 0, vz: 0, yawVel: 0, spinX: 0, spinZ: 0, carried: false })
      b.mesh.rotation.set(0, 0, 0)
      this.place(b)
    }
    this.rattle.fill(0)
    for (const s of this.shelves) s.group.rotation.set(0, 0, 0)
  }

  /** The closest box within arm's reach, if any. */
  pickCandidate(person: Person): Body | null {
    if (this.carriedBody) return null
    const fx = Math.sin(person.heading)
    const fz = Math.cos(person.heading)
    let best: Body | null = null
    let bestD = REACH
    for (const b of this.bodies) {
      if (b.kind !== 'box' || b.carried || b.mass > 1) continue
      if (Math.abs(b.y + b.h / 2 - 1.15) > 1.5) continue
      const d = Math.hypot(b.x - (person.position.x + fx * 0.25), b.z - (person.position.z + fz * 0.25))
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  pick(person: Person) {
    const b = this.pickCandidate(person)
    if (!b) return false
    b.carried = true
    b.shelf = null
    b.vx = b.vy = b.vz = 0
    this.carriedBody = b
    return true
  }

  drop(person: Person, throwIt: boolean) {
    const b = this.carriedBody
    if (!b) return
    b.carried = false
    this.carriedBody = null
    const fx = Math.sin(person.heading)
    const fz = Math.cos(person.heading)
    const speed = throwIt ? 7.5 : 1.0
    b.vx = fx * speed
    b.vz = fz * speed
    b.vy = throwIt ? 2.6 : 0.3
    b.yawVel = throwIt ? (Math.random() - 0.5) * 6 : 0
    b.spinX = throwIt ? 4 + Math.random() * 3 : 0
  }

  /** Advance the simulation; returns a 0..1 strength if something just hit the floor or the car crashed. */
  update(dt: number, car: Car, person: Person): number {
    this.clock += dt
    this.thumpCooldown = Math.max(0, this.thumpCooldown - dt)
    let thump = 0

    const onFoot = person.state === 'onfoot'

    // A hard hit on a shelving unit shakes it and knocks its boxes off.
    if (car.impact > 3.2) {
      this.shelves.forEach((s, k) => {
        if (this.carTouches(car, s)) {
          this.knock(k, car)
          thump = Math.max(thump, Math.min(1, car.impact / 10))
        }
      })
    }
    this.shelves.forEach((s, k) => {
      if (this.rattle[k] > 0) {
        this.rattle[k] = Math.max(0, this.rattle[k] - dt)
        const a = this.rattle[k] / 0.7
        s.group.rotation.z = Math.sin(this.clock * 55) * 0.014 * a
        s.group.rotation.x = Math.sin(this.clock * 47 + 1) * 0.008 * a
      }
    })

    const px = person.position.x
    const pz = person.position.z
    const active = this.bodies.filter((b) => b.shelf === null && !b.carried)

    for (const b of active) {
      // Gravity.
      if (b.y > 0 || b.vy !== 0) {
        b.vy -= 9.8 * dt
        b.y += b.vy * dt
        b.mesh.rotation.x += b.spinX * dt
        b.mesh.rotation.z += b.spinZ * dt
        if (b.y <= 0) {
          b.y = 0
          if (b.vy < -1.6) thump = Math.max(thump, Math.min(1, -b.vy / 7))
          b.vy = Math.abs(b.vy) > 1.8 ? -b.vy * 0.2 : 0
          b.spinX = b.spinZ = 0
        }
      } else {
        // Settle flat again.
        b.mesh.rotation.x *= 0.7
        b.mesh.rotation.z *= 0.7
      }
      const grounded = b.y <= 0.001
      const damp = Math.exp(-(grounded ? FRICTION[b.kind] : 0.15) * dt)
      b.vx *= damp
      b.vz *= damp
      b.x += b.vx * dt
      b.z += b.vz * dt
      b.yaw += b.yawVel * dt
      b.yawVel *= Math.exp(-3 * dt)

      // Room walls.
      const hw = ROOM.w / 2 - b.r - 0.05
      const hd = ROOM.d / 2 - b.r - 0.05
      if (b.x > hw) { b.x = hw; b.vx *= -0.35 }
      if (b.x < -hw) { b.x = -hw; b.vx *= -0.35 }
      if (b.z > hd) { b.z = hd; b.vz *= -0.35 }
      if (b.z < -hd) { b.z = -hd; b.vz *= -0.35 }

      // Fixed furniture (bench, chest, shelving frames): push out of them once on the ground.
      if (b.y < 0.5) {
        for (const o of obstacles) {
          const cx = THREE.MathUtils.clamp(b.x, o.minX, o.maxX)
          const cz = THREE.MathUtils.clamp(b.z, o.minZ, o.maxZ)
          let dx = b.x - cx
          let dz = b.z - cz
          const d = Math.hypot(dx, dz)
          if (d < b.r) {
            if (d < 1e-4) {
              // Centre is inside the rectangle: leave through the nearest side.
              // Pick the nearest side that leaves the prop inside the room (not through a wall).
              const wx = ROOM.w / 2 - b.r
              const wz = ROOM.d / 2 - b.r
              const sides = [
                { d: b.x - o.minX, x: -1, z: 0, ok: o.minX - b.r >= -wx },
                { d: o.maxX - b.x, x: 1, z: 0, ok: o.maxX + b.r <= wx },
                { d: b.z - o.minZ, x: 0, z: -1, ok: o.minZ - b.r >= -wz },
                { d: o.maxZ - b.z, x: 0, z: 1, ok: o.maxZ + b.r <= wz },
              ].filter((sd) => sd.ok)
              const best = sides.sort((p, q) => p.d - q.d)[0] ?? { d: 0, x: 1, z: 0 }
              dx = best.x
              dz = best.z
              b.x += dx * (best.d + b.r)
              b.z += dz * (best.d + b.r)
              b.vx += dx * 1.2
              b.vz += dz * 1.2
            } else {
              const pen = b.r - d
              b.x += (dx / d) * pen
              b.z += (dz / d) * pen
              const vn = b.vx * (dx / d) + b.vz * (dz / d)
              if (vn < 0) {
                b.vx -= 1.3 * vn * (dx / d)
                b.vz -= 1.3 * vn * (dz / d)
              }
            }
          }
        }
      }

      // The car.
      if (b.y < 1.2) thump = Math.max(thump, this.carPush(b, car))

      // The person walking into it.
      if (onFoot && b.y < 1.0) {
        const dx = b.x - px
        const dz = b.z - pz
        const d = Math.hypot(dx, dz)
        const min = b.r + PERSON_R
        if (d < min && d > 1e-4) {
          const nx = dx / d
          const nz = dz / d
          b.x += nx * (min - d)
          b.z += nz * (min - d)
          // If the wall stops it, the person stops instead of squeezing through.
          const wx = ROOM.w / 2 - b.r - 0.05
          const wz = ROOM.d / 2 - b.r - 0.05
          const cx = THREE.MathUtils.clamp(b.x, -wx, wx)
          const cz = THREE.MathUtils.clamp(b.z, -wz, wz)
          const sx = b.x - cx
          const sz = b.z - cz
          if (sx !== 0 || sz !== 0) {
            b.x = cx
            b.z = cz
            person.position.x -= sx
            person.position.z -= sz
            b.vx = b.vz = 0
          }
          // Walking into it shoves it along at (a bit more than) walking pace.
          const into = nx * person.velocity.x + nz * person.velocity.z
          if (into > 0.2) {
            const want = (into * 1.05) / (0.7 + b.mass * 0.5)
            const cur = b.vx * nx + b.vz * nz
            if (cur < want) {
              b.vx += (want - cur) * nx
              b.vz += (want - cur) * nz
            }
          }
        }
      }
    }

    // Props bumping into each other.
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]
        const c = active[j]
        if (Math.abs(a.y - c.y) > 0.6) continue
        const dx = c.x - a.x
        const dz = c.z - a.z
        const d = Math.hypot(dx, dz)
        const min = a.r + c.r
        if (d >= min || d < 1e-4) continue
        const nx = dx / d
        const nz = dz / d
        const pen = min - d
        const wa = c.mass / (a.mass + c.mass)
        a.x -= nx * pen * wa
        a.z -= nz * pen * wa
        c.x += nx * pen * (1 - wa)
        c.z += nz * pen * (1 - wa)
        const vn = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz
        if (vn < 0) {
          const j2 = (-(1 + 0.3) * vn) / (1 / a.mass + 1 / c.mass)
          a.vx -= (j2 / a.mass) * nx
          a.vz -= (j2 / a.mass) * nz
          c.vx += (j2 / c.mass) * nx
          c.vz += (j2 / c.mass) * nz
          if (-vn > 1.2) thump = Math.max(thump, Math.min(0.6, -vn / 8))
        }
      }
    }

    // A carried box rides in front of the driver's chest.
    const cb = this.carriedBody
    if (cb) {
      const fx = Math.sin(person.heading)
      const fz = Math.cos(person.heading)
      cb.x = person.position.x + fx * 0.62
      cb.z = person.position.z + fz * 0.62
      cb.y = 0.95
      cb.yaw = person.heading
      cb.mesh.rotation.x = cb.mesh.rotation.z = 0
    }

    for (const b of this.bodies) this.place(b)
    if (thump > 0 && this.thumpCooldown > 0) return 0
    if (thump > 0) this.thumpCooldown = 0.12
    return thump
  }

  private place(b: Body) {
    b.mesh.position.set(b.x, b.y, b.z)
    b.mesh.rotation.y = b.yaw
  }

  /** True when the car's body overlaps (a slightly grown) shelving footprint. */
  private carTouches(car: Car, s: ShelfUnit) {
    const sn = Math.sin(car.heading)
    const cs = Math.cos(car.heading)
    for (const lx of [-CAR_HALF_W, 0, CAR_HALF_W]) {
      for (const lz of [-CAR_HALF_L, -CAR_HALF_L / 2, 0, CAR_HALF_L / 2, CAR_HALF_L]) {
        const x = car.position.x + lx * cs + lz * sn
        const z = car.position.z - lx * sn + lz * cs
        if (x > s.minX - 0.3 && x < s.maxX + 0.3 && z > s.minZ - 0.3 && z < s.maxZ + 0.3) return true
      }
    }
    return false
  }

  private knock(k: number, car: Car) {
    this.rattle[k] = 0.7
    const dir = -Math.sign(car.forward) || 1
    const fx = Math.sin(car.heading) * dir
    const fz = Math.cos(car.heading) * dir
    const power = Math.min(car.impact, 12)
    for (const b of this.bodies) {
      if (b.shelf !== k) continue
      b.shelf = null
      b.vx = fx * power * 0.18 + (Math.random() - 0.3) * 1.6
      b.vz = fz * power * 0.18 + (Math.random() - 0.5) * 1.6
      b.vy = Math.random() * 1.2
      b.yawVel = (Math.random() - 0.5) * 7
      b.spinX = (Math.random() - 0.5) * 7
      b.spinZ = (Math.random() - 0.5) * 7
    }
  }

  /** Shove a body out of the car. Returns an impact strength for sound. */
  private carPush(b: Body, car: Car): number {
    const dx = b.x - car.position.x
    const dz = b.z - car.position.z
    const cs = Math.cos(car.heading)
    const sn = Math.sin(car.heading)
    const lx = dx * cs - dz * sn
    const lz = dx * sn + dz * cs
    const cx = THREE.MathUtils.clamp(lx, -CAR_HALF_W, CAR_HALF_W)
    const cz = THREE.MathUtils.clamp(lz, -CAR_HALF_L, CAR_HALF_L)
    let nlx = lx - cx
    let nlz = lz - cz
    let d = Math.hypot(nlx, nlz)
    if (d >= b.r) return 0
    if (d < 1e-4) {
      // Centre swallowed by the car: eject along the side it is closest to.
      const side = CAR_HALF_W - Math.abs(lx) < CAR_HALF_L - Math.abs(lz)
      nlx = side ? Math.sign(lx) || 1 : 0
      nlz = side ? 0 : Math.sign(lz) || 1
      d = 1
    }
    nlx /= d
    nlz /= d
    const nx = nlx * cs + nlz * sn
    const nz = -nlx * sn + nlz * cs
    const pen = b.r - (d === 1 ? 0 : d)
    b.x += nx * pen
    b.z += nz * pen
    const vn = (b.vx - car.vx) * nx + (b.vz - car.vz) * nz
    if (vn >= 0) return 0
    const share = 1 / (0.7 + b.mass * 0.45)
    b.vx -= (1 + 0.35) * vn * nx * share
    b.vz -= (1 + 0.35) * vn * nz * share
    b.yawVel += (Math.random() - 0.5) * Math.min(-vn, 8) * 0.8
    // Heavy things slow the car a little.
    const slow = 1 - Math.min(0.1, 0.045 * b.mass)
    car.vx *= slow
    car.vz *= slow
    return -vn > 1.5 ? Math.min(0.8, -vn / 9) : 0
  }
}
