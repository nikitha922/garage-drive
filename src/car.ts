import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { ROOM, obstacles } from './garage'

export interface Controls {
  throttle: number // 0..1
  brake: number // 0..1
  steer: number // -1 (right) .. 1 (left)
  handbrake: boolean
}

export type DriveMode = 'eco' | 'sport'

// Local car axes: +z is the nose, +x is the driver's left.
const HALF_W = 0.98
const HALF_L = 2.33
const WHEELBASE = 2.7
const WHEEL_X = 0.93
const WHEEL_R = 0.4
const MAX_REV = 5
const MAX_STEER = 0.55

const MODES = {
  eco: { power: 8, max: 12, grip: 9 },
  sport: { power: 15, max: 21, grip: 5.5 },
}

export const PAINTS = ['#d62828', '#1d6fdc', '#f2b705', '#17a673', '#f5f5f5', '#2b2b30'] as const

/** Extrude a side profile (u = along the car, v = height) across the car's width. */
function extrudeProfile(points: [number, number][], width: number, bevel: number, smooth: boolean) {
  let pts = points.map(([u, v]) => new THREE.Vector2(u, v))
  if (smooth) {
    const curve = new THREE.CatmullRomCurve3(points.map(([u, v]) => new THREE.Vector3(u, v, 0)), true, 'centripetal')
    pts = curve.getPoints(160).map((p) => new THREE.Vector2(p.x, p.y))
  }
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 1,
  })
  geo.translate(0, 0, -(width - bevel * 2) / 2)
  geo.rotateY(-Math.PI / 2) // shape x -> world z, depth -> world x
  geo.computeVertexNormals()
  return geo
}

export class Car {
  readonly group = new THREE.Group()
  heading = Math.PI
  vx = 0
  vz = 0
  steer = 0
  mode: DriveMode = 'sport'
  headlightsOn = true
  engineOn = true
  underglowOn = false
  /** Forward speed in m/s (negative when reversing). */
  forward = 0
  /** Sideways slide in m/s. */
  slip = 0
  rpm = 0.15
  /** Driver's door opening, 0 (shut) .. 1 (open). */
  door = 0
  gear = 'N'

  private frontPivots: THREE.Object3D[] = []
  private wheelSpinners: THREE.Object3D[] = []
  private tailMat = new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff1010', emissiveIntensity: 0.8 })
  private headMat = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#e6f1ff', emissiveIntensity: 8 })
  private beams: THREE.SpotLight[] = []
  private glow = new THREE.PointLight('#19e6ff', 0, 7, 2)
  private glowStrip: THREE.Mesh[] = []
  private paint = new THREE.MeshPhysicalMaterial({ color: PAINTS[0], roughness: 0.28, metalness: 0.65, clearcoat: 1, clearcoatRoughness: 0.05 })
  private body = new THREE.Group()
  private roll = 0
  private doorPivot = new THREE.Group()

  constructor() {
    this.group.add(this.body)
    this.build()
    this.reset()
  }

  setPaint(i: number) {
    this.paint.color.set(PAINTS[i % PAINTS.length])
  }

  reset() {
    this.group.position.set(0, 0, 6)
    this.heading = Math.PI
    this.vx = this.vz = this.forward = this.slip = 0
    this.steer = 0
    this.sync()
  }

  get position() {
    return this.group.position
  }

  get speed() {
    return Math.hypot(this.vx, this.vz)
  }

  /** World position of a rear tyre contact point: side -1 (right) or 1 (left). */
  rearWheel(side: number) {
    const s = Math.sin(this.heading)
    const k = Math.cos(this.heading)
    const lx = side * WHEEL_X
    const lz = -WHEELBASE / 2
    return { x: this.group.position.x + lx * k + lz * s, z: this.group.position.z - lx * s + lz * k }
  }

  private build() {
    const paint = this.paint
    const glass = new THREE.MeshPhysicalMaterial({ color: '#0b1118', roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0 })
    const trim = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.55, metalness: 0.35 })
    const carbon = new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.35, metalness: 0.6 })
    const alloy = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.22, metalness: 1 })
    const tyreMat = new THREE.MeshStandardMaterial({ color: '#0e0e10', roughness: 0.92 })
    const disc = new THREE.MeshStandardMaterial({ color: '#8b8f96', roughness: 0.4, metalness: 0.9 })
    const caliper = new THREE.MeshStandardMaterial({ color: '#e11d2e', roughness: 0.4, metalness: 0.3 })

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      parent.add(m)
      return m
    }

    // Lower body: one smooth side profile extruded across the car.
    add(
      extrudeProfile(
        [[-2.0, 0.3], [-2.3, 0.34], [-2.33, 0.62], [-2.25, 0.9], [-1.7, 0.99], [-0.9, 1.0], [0.9, 1.0], [1.5, 0.95], [2.05, 0.8], [2.3, 0.6], [2.28, 0.36], [1.9, 0.29], [1.2, 0.28], [-1.2, 0.28]],
        1.9,
        0.1,
        true,
      ),
      paint,
      0,
      0,
      0,
    )

    // Greenhouse: tinted glass, painted roof cap and pillars.
    add(extrudeProfile([[-1.5, 0.97], [-0.82, 1.43], [0.62, 1.45], [1.3, 0.97]], 1.56, 0.05, false), glass, 0, 0, 0)
    add(extrudeProfile([[-0.86, 1.42], [0.66, 1.44], [0.62, 1.51], [-0.8, 1.5]], 1.5, 0.04, false), paint, 0, 0, 0)
    const strut = (a: [number, number], b: [number, number], x: number, w: number) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const m = add(new THREE.BoxGeometry(w, len, 0.08), paint, x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2)
      m.rotation.x = Math.atan2(b[0] - a[0], b[1] - a[1]) * -1
    }
    for (const x of [-0.79, 0.79]) {
      strut([1.3, 0.97], [0.62, 1.47], x, 0.07) // A pillar
      strut([-1.5, 0.97], [-0.82, 1.47], x, 0.2) // C pillar
    }

    // Aero: splitter, diffuser, side skirts, ducktail spoiler.
    add(new THREE.BoxGeometry(1.9, 0.05, 0.4), carbon, 0, 0.27, 2.2)
    add(new THREE.BoxGeometry(1.7, 0.1, 0.35), carbon, 0, 0.3, -2.2)
    for (const x of [-0.98, 0.98]) add(new THREE.BoxGeometry(0.06, 0.1, 3.0), carbon, x, 0.3, 0)
    add(new THREE.BoxGeometry(1.8, 0.05, 0.38), carbon, 0, 1.06, -2.2)
    for (const x of [-0.75, 0.75]) add(new THREE.BoxGeometry(0.05, 0.14, 0.2), carbon, x, 0.99, -2.2)
    // Mirrors and bonnet vents.
    for (const x of [-1.0, 1.0]) add(new RoundedBoxGeometry(0.16, 0.12, 0.26, 3, 0.04), paint, x, 1.05, 0.95)
    for (const x of [-0.35, 0.35]) add(new THREE.BoxGeometry(0.4, 0.015, 0.55), carbon, x, 0.97, 1.55)
    // Grille.
    add(new THREE.BoxGeometry(0.9, 0.12, 0.04), carbon, 0, 0.46, 2.3)

    // Lights: LED daylight strips, headlight clusters, full-width tail bar.
    for (const x of [-0.62, 0.62]) {
      const cluster = add(new RoundedBoxGeometry(0.62, 0.08, 0.1, 3, 0.03), this.headMat, x, 0.72, 2.2)
      cluster.rotation.y = x > 0 ? 0.25 : -0.25
      add(new THREE.BoxGeometry(0.5, 0.025, 0.06), this.headMat, x, 0.64, 2.27)
      const beam = new THREE.SpotLight('#eef4ff', 110, 24, Math.PI / 6, 0.55, 1.1)
      beam.position.set(x, 0.75, 2.2)
      beam.target.position.set(x * 0.6, 0.2, 9)
      this.body.add(beam, beam.target)
      this.beams.push(beam)
    }
    add(new THREE.BoxGeometry(1.75, 0.07, 0.05), this.tailMat, 0, 0.8, -2.34)
    for (const x of [-0.78, 0.78]) add(new RoundedBoxGeometry(0.28, 0.12, 0.06, 3, 0.03), this.tailMat, x, 0.74, -2.32)

    // Neon underglow strips (toggle with U).
    const glowMat = new THREE.MeshBasicMaterial({ color: '#19e6ff' })
    for (const x of [-0.9, 0.9]) {
      const m = add(new THREE.BoxGeometry(0.04, 0.03, 3.2), glowMat, x, 0.22, 0)
      m.castShadow = false
      this.glowStrip.push(m)
    }
    this.glow.position.set(0, 0.18, 0)
    this.body.add(this.glow)

    // Driver's door: hinged at its front edge on the left side, swings out when the driver steps out.
    this.doorPivot.position.set(0.97, 0, 0.78)
    this.body.add(this.doorPivot)
    add(new RoundedBoxGeometry(0.05, 0.64, 1.42, 3, 0.02), paint, 0, 0.64, -0.72, this.doorPivot)
    add(new THREE.BoxGeometry(0.04, 0.03, 0.2), carbon, 0.03, 0.83, -1.2, this.doorPivot)

    // Wheels. Dark arch decals first so the tyres sit in visible wheel wells.
    const archGeo = new THREE.CircleGeometry(0.47, 32)
    const tyreGeo = new THREE.TorusGeometry(0.29, 0.11, 18, 40)
    tyreGeo.rotateY(Math.PI / 2)
    tyreGeo.scale(1.45, 1, 1)
    const barrel = new THREE.CylinderGeometry(0.29, 0.29, 0.26, 24)
    barrel.rotateZ(Math.PI / 2)
    const discGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 28)
    discGeo.rotateZ(Math.PI / 2)
    const spokeGeo = new THREE.BoxGeometry(0.04, 0.26, 0.07)
    const capGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16)
    capGeo.rotateZ(Math.PI / 2)

    const spots: [number, number, boolean][] = [
      [-WHEEL_X, WHEELBASE / 2, true],
      [WHEEL_X, WHEELBASE / 2, true],
      [-WHEEL_X, -WHEELBASE / 2, false],
      [WHEEL_X, -WHEELBASE / 2, false],
    ]
    for (const [x, z, steered] of spots) {
      const side = Math.sign(x)
      const arch = new THREE.Mesh(archGeo, new THREE.MeshBasicMaterial({ color: '#050506' }))
      arch.position.set(side * 0.975, WHEEL_R, z)
      arch.rotation.y = side * (Math.PI / 2)
      this.body.add(arch)

      const pivot = new THREE.Group()
      pivot.position.set(x, WHEEL_R, z)
      const spin = new THREE.Group()
      pivot.add(spin)
      add(tyreGeo, tyreMat, 0, 0, 0, spin)
      add(barrel, trim, 0, 0, 0, spin)
      add(capGeo, alloy, side * 0.1, 0, 0, spin)
      for (let k = 0; k < 5; k++) {
        const holder = new THREE.Group()
        holder.rotation.x = (k * Math.PI * 2) / 5
        add(spokeGeo, alloy, side * 0.09, 0.16, 0, holder)
        spin.add(holder)
      }
      add(discGeo, disc, -side * 0.03, 0, 0, spin)
      add(new THREE.BoxGeometry(0.06, 0.16, 0.2), caliper, -side * 0.01, 0.17, 0.06, pivot)
      this.body.add(pivot)
      this.wheelSpinners.push(spin)
      if (steered) this.frontPivots.push(pivot)
    }
  }

  toggleHeadlights() {
    this.headlightsOn = !this.headlightsOn
  }
  toggleEngine() {
    this.engineOn = !this.engineOn
    return this.engineOn
  }
  toggleUnderglow() {
    this.underglowOn = !this.underglowOn
  }
  toggleMode() {
    this.mode = this.mode === 'sport' ? 'eco' : 'sport'
  }

  /** Advance the simulation. Returns true if the car hit something. */
  update(dt: number, c: Controls): boolean {
    // With the engine off there is no drive: the car just coasts to a stop.
    if (!this.engineOn) c = { ...c, throttle: 0 }
    const m = MODES[this.mode]
    const fx = Math.sin(this.heading)
    const fz = Math.cos(this.heading)
    const rx = Math.cos(this.heading)
    const rz = -Math.sin(this.heading)
    let f = this.vx * fx + this.vz * fz
    let l = this.vx * rx + this.vz * rz

    // Steering eases toward the target and tightens less at speed.
    const lock = MAX_STEER * (1 - Math.min(Math.abs(f) / (m.max * 1.6), 0.55))
    this.steer += (c.steer * lock - this.steer) * Math.min(1, dt * 8)

    // Longitudinal forces.
    let accel = 0
    if (c.throttle > 0) accel += f < 0 ? 16 * c.throttle : m.power * c.throttle * Math.max(0, 1 - f / m.max)
    if (c.brake > 0) accel -= (f > 0.3 ? 17 : 6 * Math.max(0, 1 - -f / MAX_REV)) * c.brake
    if (c.throttle === 0 && c.brake === 0) accel -= Math.sign(f) * 2.2 // engine braking
    accel -= f * 0.22 // drag
    if (c.handbrake) accel -= Math.sign(f) * 9
    const prev = f
    f += accel * dt
    if (c.throttle === 0 && prev * f < 0) f = 0
    f = THREE.MathUtils.clamp(f, -MAX_REV, m.max)

    // Tyre grip: sideways velocity bleeds off quickly, except with the handbrake on.
    const grip = c.handbrake ? 1.1 : m.grip
    l *= Math.exp(-grip * dt)

    this.vx = fx * f + rx * l
    this.vz = fz * f + rz * l

    // Bicycle-model yaw, boosted a bit while sliding so drifts feel lively.
    const yaw = (f / WHEELBASE) * Math.tan(this.steer) * (c.handbrake ? 1.55 : 1)
    const nextHeading = this.heading + yaw * dt

    const p = this.group.position
    let hit = false
    if (!this.blocked(p.x + this.vx * dt, p.z, nextHeading)) p.x += this.vx * dt
    else {
      hit = true
      this.vx *= -0.3
    }
    if (!this.blocked(p.x, p.z + this.vz * dt, nextHeading)) p.z += this.vz * dt
    else {
      hit = true
      this.vz *= -0.3
    }
    if (!this.blocked(p.x, p.z, nextHeading)) this.heading = nextHeading
    else {
      hit = true
      this.vx *= 0.6
      this.vz *= 0.6
    }

    this.forward = this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading)
    this.slip = Math.abs(this.vx * Math.cos(this.heading) - this.vz * Math.sin(this.heading))

    // Gearbox / revs (cosmetic but drives the HUD and engine sound).
    const af = Math.abs(this.forward)
    const bands = m.max / 5
    const gearNum = Math.min(5, Math.floor(af / bands) + 1)
    this.gear = this.forward < -0.4 ? 'R' : af < 0.25 && c.throttle === 0 ? 'N' : String(gearNum)
    const targetRpm = 0.16 + 0.84 * Math.min(1, (af - (gearNum - 1) * bands) / bands) * (0.55 + 0.45 * Math.max(c.throttle, 0.3))
    const wantRpm = this.engineOn ? Math.max(targetRpm, 0.14 + c.throttle * 0.3) : 0
    this.rpm += (wantRpm - this.rpm) * Math.min(1, dt * (this.engineOn ? 9 : 4))
    if (!this.engineOn) this.gear = '—'

    // Visuals: wheels, lights.
    for (const w of this.wheelSpinners) w.rotation.x += (this.forward * dt) / WHEEL_R
    for (const fp of this.frontPivots) fp.rotation.y = this.steer
    const braking = (c.brake > 0 && this.forward > 0.3) || c.handbrake
    this.tailMat.emissiveIntensity = braking ? 9 : this.forward < -0.2 ? 4 : 1.8
    this.headMat.emissiveIntensity = this.headlightsOn ? 8 : 0.1
    for (const b of this.beams) b.intensity = this.headlightsOn ? 110 : 0
    this.glow.intensity = this.underglowOn ? 30 : 0
    for (const s of this.glowStrip) s.visible = this.underglowOn

    // Body roll into corners.
    const targetRoll = -this.steer * Math.min(af / m.max, 1) * 0.08
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6)
    this.body.rotation.z = this.roll
    this.body.rotation.x = THREE.MathUtils.clamp(-accel * 0.0012, -0.03, 0.03)

    this.sync()
    return hit
  }

  private sync() {
    this.group.rotation.y = this.heading
    this.doorPivot.rotation.y = -this.door * 1.05
  }

  private blocked(x: number, z: number, heading: number): boolean {
    const s = Math.sin(heading)
    const k = Math.cos(heading)
    const hw = ROOM.w / 2 - 0.1
    const hd = ROOM.d / 2 - 0.1
    for (const lx of [-HALF_W, 0, HALF_W]) {
      for (const lz of [-HALF_L, -HALF_L / 2, 0, HALF_L / 2, HALF_L]) {
        const wx = x + lx * k + lz * s
        const wz = z - lx * s + lz * k
        if (Math.abs(wx) > hw || Math.abs(wz) > hd) return true
        for (const o of obstacles) {
          if (wx > o.minX && wx < o.maxX && wz > o.minZ && wz < o.maxZ) return true
        }
      }
    }
    return false
  }
}
