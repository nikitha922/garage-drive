import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

export const ROOM = { w: 26, d: 32, h: 7 }

/** Axis-aligned footprints (x/z) the car cannot drive through. */
export interface Box2 {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
export const obstacles: Box2[] = []

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (repeat) t.repeat.set(...repeat)
  return t
}

function speckle(ctx: CanvasRenderingContext2D, s: number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() > 0.5 ? 255 : 0
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`
    ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
}

/** Register a solid prop: adds the mesh to the scene and its footprint to the collision list. */
function solid(scene: THREE.Scene, mesh: THREE.Object3D, w: number, d: number) {
  scene.add(mesh)
  obstacles.push({
    minX: mesh.position.x - w / 2,
    maxX: mesh.position.x + w / 2,
    minZ: mesh.position.z - d / 2,
    maxZ: mesh.position.z + d / 2,
  })
}

const std = (color: number | string, rough = 0.7, metal = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.castShadow = m.receiveShadow = true
  return m
}

export function buildGarage(scene: THREE.Scene) {
  const { w, d, h } = ROOM
  const hw = w / 2
  const hd = d / 2

  // ---- Floor: polished concrete with painted bay lines -------------------
  const floorTex = canvasTexture(1024, (ctx, s) => {
    ctx.fillStyle = '#5a5d62'
    ctx.fillRect(0, 0, s, s)
    speckle(ctx, s, 9000, 0.12)
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'
    ctx.lineWidth = 3
    ctx.strokeRect(0, 0, s, s)
  }, [w / 6, d / 6])
  // Real mirror under a semi-transparent concrete layer = polished, reflective floor.
  const reflector = new Reflector(new THREE.PlaneGeometry(w, d), {
    textureWidth: Math.round(innerWidth * 0.6),
    textureHeight: Math.round(innerHeight * 0.6),
    color: 0x6f737a,
    clipBias: 0.003,
  })
  reflector.rotation.x = -Math.PI / 2
  reflector.position.y = -0.003
  scene.add(reflector)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.8 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  floor.renderOrder = -1
  scene.add(floor)

  // Painted bay outline + centre arrows on the floor.
  const paint = std('#e8c547', 0.6)
  const stripe = (sx: number, sz: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), paint)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.012, z)
    m.receiveShadow = true
    scene.add(m)
  }
  stripe(0.14, 11, -4.2, 3)
  stripe(0.14, 11, 4.2, 3)
  stripe(8.5, 0.14, 0, -2.5)

  // ---- Walls & ceiling -----------------------------------------------------
  const wallTex = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#c9cbcf'
    ctx.fillRect(0, 0, s, s)
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    const rows = 8
    for (let r = 0; r < rows; r++) ctx.fillRect(0, (r * s) / rows, s, 3)
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / 4 : 0
      for (let x = off; x < s; x += s / 2) ctx.fillRect(x, (r * s) / rows, 3, s / rows)
    }
    speckle(ctx, s, 5000, 0.08)
  }, [5, 1.6])
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 })
  // Darker lower band so the room feels grounded.
  const bandMat = std('#2f3238', 0.8)

  const wall = (sx: number, sz: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, h), wallMat)
    m.position.set(x, h / 2, z)
    m.rotation.y = ry
    m.receiveShadow = true
    scene.add(m)
  }
  wall(w, 0, 0, -hd, 0) // back
  wall(d, 0, -hw, 0, Math.PI / 2) // left
  wall(d, 0, hw, 0, -Math.PI / 2) // right
  wall(w, 0, 0, hd, Math.PI) // front (garage door wall)

  const band = (sx: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, 1.1), bandMat)
    m.position.set(x, 0.55, z)
    m.rotation.y = ry
    scene.add(m)
  }
  band(w, 0, -hd + 0.01, 0)
  band(d, -hw + 0.01, 0, Math.PI / 2)
  band(d, hw - 0.01, 0, -Math.PI / 2)
  band(w, 0, hd - 0.01, Math.PI)

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std('#aeb1b6', 0.95))
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = h
  scene.add(ceiling)

  // Exposed ceiling beams.
  const beamMat = std('#3a3d44', 0.6, 0.4)
  for (let z = -hd + 4; z < hd; z += 8) scene.add(box(w, 0.35, 0.4, beamMat, 0, h - 0.18, z))

  // ---- Closed roll-up garage door (front wall) -----------------------------
  const doorTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#8e949c'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 4; i++) {
      const y = (i * s) / 4
      const g = ctx.createLinearGradient(0, y, 0, y + s / 4)
      g.addColorStop(0, 'rgba(255,255,255,0.28)')
      g.addColorStop(0.5, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,0.4)')
      ctx.fillStyle = g
      ctx.fillRect(0, y, s, s / 4)
    }
  }, [1, 5])
  const door = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.2), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.5, metalness: 0.5 }))
  door.position.set(0, 2.6, hd - 0.04)
  door.rotation.y = Math.PI
  door.receiveShadow = true
  scene.add(door)
  const frameMat = std('#1d1f23', 0.6, 0.3)
  scene.add(box(14.6, 0.3, 0.3, frameMat, 0, 5.3, hd - 0.15))
  scene.add(box(0.3, 5.4, 0.3, frameMat, -7.2, 2.7, hd - 0.15))
  scene.add(box(0.3, 5.4, 0.3, frameMat, 7.2, 2.7, hd - 0.15))
  // Door window strip.
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.5), new THREE.MeshStandardMaterial({ color: '#9fd0ff', emissive: '#5a90c8', emissiveIntensity: 0.5, roughness: 0.2 }))
  strip.position.set(0, 4.45, hd - 0.06)
  strip.rotation.y = Math.PI
  scene.add(strip)

  // ---- Ceiling lights ------------------------------------------------------
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4e0', emissiveIntensity: 7 })
  const lightZ = [-9, -1.5, 6, 12]
  for (const z of lightZ) {
    for (const x of [-5, 5]) {
      scene.add(box(0.35, 0.1, 6, tubeMat, x, h - 0.45, z))
      scene.add(box(0.7, 0.12, 6.3, std('#222', 0.5), x, h - 0.38, z))
    }
  }
  const hemi = new THREE.HemisphereLight('#ffffff', '#40444a', 0.55)
  scene.add(hemi)
  const shadowSpots: THREE.SpotLight[] = []
  ;[-6, 4].forEach((z, i) => {
    const s = new THREE.SpotLight('#fff1dc', 300, 26, Math.PI / 2.6, 0.7, 1.4)
    s.position.set(0, h - 0.6, z)
    s.target.position.set(0, 0, z)
    s.castShadow = i === 1
    s.shadow.mapSize.set(2048, 2048)
    s.shadow.bias = -0.0004
    scene.add(s, s.target)
    shadowSpots.push(s)
  })
  for (const z of [-11, 11]) {
    const p = new THREE.PointLight('#ffe9c8', 70, 20, 1.6)
    p.position.set(0, h - 1, z)
    scene.add(p)
  }

  // ---- Props ------------------------------------------------------------------
  const metal = std('#6a707a', 0.45, 0.7)
  const wood = std('#8a5a33', 0.8)
  const crate = std('#a3794a', 0.85)
  const red = std('#c0302b', 0.5, 0.3)

  // Shelving unit with boxes along the left wall.
  for (let k = 0; k < 3; k++) {
    const z = -8 + k * 3.6
    const g = new THREE.Group()
    g.position.set(-hw + 0.7, 0, z)
    for (const dx of [-0.55, 0.55]) for (const dz of [-1.5, 1.5]) g.add(box(0.1, 3.2, 0.1, metal, dx, 1.6, dz))
    for (let lvl = 0; lvl < 4; lvl++) {
      g.add(box(1.2, 0.07, 3.3, metal, 0, 0.25 + lvl * 0.95, 0))
      for (let n = 0; n < 3; n++) {
        if (Math.random() > 0.25) {
          const bw = 0.5 + Math.random() * 0.25
          g.add(box(bw, 0.4 + Math.random() * 0.2, 0.8 + Math.random() * 0.3, Math.random() > 0.5 ? crate : red, (Math.random() - 0.5) * 0.3, 0.5 + lvl * 0.95, -1.1 + n * 1.05))
        }
      }
    }
    solid(scene, g, 1.4, 3.4)
  }

  // Workbench with vice + tool chest on the back wall.
  const bench = new THREE.Group()
  bench.position.set(-5, 0, -hd + 1.0)
  bench.add(box(6, 0.18, 1.6, wood, 0, 1.05, 0))
  for (const dx of [-2.8, 2.8]) bench.add(box(0.15, 1.05, 1.4, metal, dx, 0.52, 0))
  bench.add(box(5.6, 0.1, 1.3, metal, 0, 0.3, 0))
  bench.add(box(0.5, 0.35, 0.4, std('#333', 0.4, 0.8), 1.8, 1.4, 0.2))
  solid(scene, bench, 6, 1.6)

  const chest = new THREE.Group()
  chest.position.set(3.2, 0, -hd + 0.8)
  chest.add(box(2, 1.5, 1.0, red, 0, 0.75, 0))
  for (let i = 0; i < 4; i++) chest.add(box(1.8, 0.02, 0.02, std('#222'), 0, 0.3 + i * 0.32, 0.51))
  chest.add(box(2.1, 0.08, 1.1, std('#999', 0.3, 0.8), 0, 1.54, 0))
  solid(scene, chest, 2, 1)

  // Pegboard above the bench.
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), std('#caa46a', 0.9))
  peg.position.set(-5, 3.0, -hd + 0.02)
  scene.add(peg)
  for (let i = 0; i < 9; i++) {
    const tool = box(0.12, 0.7 + Math.random() * 0.5, 0.05, std(i % 2 ? '#bbb' : '#d33', 0.4, 0.6), -7.4 + i * 0.6, 3.0, -hd + 0.07)
    scene.add(tool)
  }

  // Tyre stack + barrels on the right side.
  const tyreMat = std('#171717', 0.9)
  const tyres = new THREE.Group()
  tyres.position.set(hw - 1.6, 0, -hd + 2.2)
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.2, 14, 28), tyreMat)
    t.rotation.x = Math.PI / 2
    t.position.y = 0.2 + i * 0.4
    t.castShadow = true
    tyres.add(t)
  }
  solid(scene, tyres, 1.3, 1.3)

  const barrelMat = std('#2554a0', 0.45, 0.5)
  ;[
    [hw - 1.4, 2.5],
    [hw - 1.4, 3.8],
    [hw - 2.7, 3.2],
  ].forEach(([x, z], i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 24), i === 2 ? std('#b53a2b', 0.45, 0.5) : barrelMat)
    b.position.set(x, 0.65, z)
    b.castShadow = b.receiveShadow = true
    solid(scene, b, 1.0, 1.0)
  })

  // Rolling jack stand + crate near the door.
  const crates = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.1, 1.4, 3, 0.05), crate)
  crates.position.set(hw - 1.5, 0.55, 11)
  crates.castShadow = crates.receiveShadow = true
  solid(scene, crates, 1.4, 1.4)

  // Neon-style sign above the bench (pure decoration).
  const sign = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#101216'
    ctx.fillRect(0, 0, s, s)
    ctx.font = '700 120px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#ff4d6d'
    ctx.shadowBlur = 30
    ctx.fillStyle = '#ff8fa3'
    ctx.fillText('GARAGE', s / 2, s / 2 - 40)
    ctx.font = '600 60px system-ui, sans-serif'
    ctx.fillStyle = '#ffd6dd'
    ctx.fillText('OPEN 24 / 7', s / 2, s / 2 + 90)
  })
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: '#ffffff', emissiveIntensity: 1.1 }))
  signMesh.position.set(3, 4.6, -hd + 0.03)
  scene.add(signMesh)

  return { shadowSpots, reflector }
}
