import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { Car, PAINTS, type Controls } from './car'
import { Effects } from './effects'
import { buildGarage } from './garage'
import { Person, type WalkInput } from './person'
import { Sound } from './sound'

const $ = (id: string) => document.getElementById(id)!
const canvas = $('scene') as HTMLCanvasElement

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.7

const scene = new THREE.Scene()
scene.background = new THREE.Color('#101216')
scene.fog = new THREE.Fog('#101216', 30, 64)

// Image-based lighting for believable paint and chrome reflections.
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.45

const { reflector } = buildGarage(scene)
const car = new Car()
scene.add(car.group)
const person = new Person(scene)
const fx = new Effects(scene)
const sound = new Sound()

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)

// ---- Post-processing: ambient occlusion -> bloom -> tone mapping -------------
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight)
gtao.blendIntensity = 0.9
gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12 })
composer.addPass(gtao)
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 3.2)
composer.addPass(bloom)
composer.addPass(new OutputPass())

let quality = true
function setQuality(on: boolean) {
  quality = on
  gtao.enabled = on
  bloom.enabled = on
  reflector.visible = on
  $('fx').textContent = on ? 'FX HIGH' : 'FX LOW'
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  composer.setPixelRatio(Math.min(devicePixelRatio, 2))
  composer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

// ---- Input: keyboard, gamepad, touch ------------------------------------------
const held = new Set<string>()
const CAMS = ['chase', 'cockpit', 'top', 'orbit'] as const
let camMode = 0
let padPrev: boolean[] = []

const orbit = new OrbitControls(camera, canvas)
orbit.enableDamping = true
orbit.minDistance = 3.5
orbit.maxDistance = 13
orbit.maxPolarAngle = Math.PI / 2 - 0.05
orbit.enabled = false

function setCam(i: number) {
  camMode = i % CAMS.length
  orbit.enabled = CAMS[camMode] === 'orbit'
  $('cam').textContent = CAMS[camMode].toUpperCase()
  if (orbit.enabled) {
    const p = car.position
    camera.position.set(p.x + 5, 2.4, p.z + 6)
    orbit.target.set(p.x, 0.8, p.z)
  }
}

function setPaint(i: number) {
  car.setPaint(i)
  document.querySelectorAll('.swatch').forEach((el, n) => el.classList.toggle('on', n === i))
}

function act(k: string) {
  sound.init()
  if (k === 'c') setCam(camMode + 1)
  else if (k === 'l') car.toggleHeadlights()
  else if (k === 'u') car.toggleUnderglow()
  else if (k === 'k') {
    $('engine').textContent = car.toggleEngine() ? 'ENGINE ON' : 'ENGINE OFF'
    $('engine').classList.toggle('off', !car.engineOn)
  }
  else if (k === 't') $('mode').textContent = (car.toggleMode(), car.mode.toUpperCase())
  else if (k === 'q') setQuality(!quality)
  else if (k === 'm') $('mute').textContent = sound.toggleMute() ? 'MUTED' : 'SOUND'
  else if (k === 'h') sound.horn()
  else if (k === 'e') {
    if (person.state === 'inside') {
      if (car.speed < 1.2) person.exit(car)
    } else person.tryEnter(car)
  }
  else if (k === 'r') {
    car.reset()
    fx.clearSkids()
  } else if (/^[1-6]$/.test(k)) setPaint(Number(k) - 1)
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const k = e.key.toLowerCase()
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
  if (!e.repeat) act(k)
  held.add(k)
})
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()))
addEventListener('blur', () => held.clear())

// On-screen buttons (touch devices) and paint swatches.
document.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
  const k = el.dataset.key!
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    sound.init()
    held.add(k)
  })
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => held.delete(k))
})
$('swatches').innerHTML = PAINTS.map((c, i) => `<button class="swatch${i === 0 ? ' on' : ''}" style="--c:${c}" data-paint="${i}" aria-label="Paint ${i + 1}"></button>`).join('')
document.querySelectorAll<HTMLElement>('[data-paint]').forEach((el) => el.addEventListener('click', () => setPaint(Number(el.dataset.paint))))

const any = (...keys: string[]) => keys.some((k) => held.has(k))

function readControls(): Controls {
  let throttle = any('w', 'arrowup') ? 1 : 0
  let brake = any('s', 'arrowdown') ? 1 : 0
  let steer = (any('a', 'arrowleft') ? 1 : 0) - (any('d', 'arrowright') ? 1 : 0)
  let handbrake = held.has(' ')

  const pad = navigator.getGamepads?.()[0]
  if (pad) {
    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : v)
    throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0)
    brake = Math.max(brake, pad.buttons[6]?.value ?? 0)
    steer = steer || -dead(pad.axes[0] ?? 0)
    handbrake = handbrake || !!pad.buttons[0]?.pressed || !!pad.buttons[2]?.pressed
    const now = pad.buttons.map((b) => b.pressed)
    const edge = (i: number) => now[i] && !padPrev[i]
    if (edge(3)) act('c')
    if (edge(1)) act('l')
    if (edge(4) || edge(5)) act('t')
    if (edge(9)) act('r')
    if (edge(8)) act('e')
    padPrev = now
  }
  // The car sits still with the handbrake on whenever the driver is outside.
  if (person.state !== 'inside') return { throttle: 0, brake: 0, steer: 0, handbrake: true }
  return { throttle, brake, steer, handbrake }
}

function readWalk(): WalkInput {
  let fwd = (any('w', 'arrowup') ? 1 : 0) - (any('s', 'arrowdown') ? 1 : 0)
  let turn = (any('a', 'arrowleft') ? 1 : 0) - (any('d', 'arrowright') ? 1 : 0)
  const pad = navigator.getGamepads?.()[0]
  if (pad) {
    const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v)
    fwd = fwd || -dead(pad.axes[1] ?? 0)
    turn = turn || -dead(pad.axes[0] ?? 0)
  }
  return { fwd, turn, run: held.has('shift') }
}

// ---- Camera -----------------------------------------------------------------
const camPos = new THREE.Vector3()
const camLook = new THREE.Vector3(0, 1, 6)
camPos.set(0, 4, 14)
const fwdV = new THREE.Vector3()

function updateCamera(dt: number) {
  const onFoot = person.active
  const p = onFoot ? person.position : car.position
  const heading = onFoot ? person.heading : car.heading
  const speed = onFoot ? 0 : car.speed
  let mode = CAMS[camMode]
  if (onFoot && mode === 'cockpit') mode = 'chase'
  if (mode === 'orbit') {
    orbit.target.lerp(new THREE.Vector3(p.x, 0.8, p.z), 1 - Math.pow(0.001, dt))
    orbit.update()
    return
  }
  fwdV.set(Math.sin(heading), 0, Math.cos(heading))
  let wantPos: THREE.Vector3
  let wantLook: THREE.Vector3
  let ease = 1 - Math.pow(0.0015, dt)
  const transition = person.state === 'exiting' || person.state === 'entering' || person.state === 'approach'
  if (transition && mode !== 'top') {
    // Swing to the driver's side so the person is visible stepping out.
    const s = Math.sin(car.heading)
    const k = Math.cos(car.heading)
    const at = (lx: number, lz: number, y: number) => new THREE.Vector3(car.position.x + lx * k + lz * s, y, car.position.z - lx * s + lz * k)
    wantPos = at(6.2, -4.2, 2.3)
    wantLook = at(1.3, 0.3, 1.1)
  } else if (mode === 'chase') {
    // Pull back a little at speed and lag behind sideways slides.
    const back = onFoot ? 3.6 : 7.6 + Math.min(speed * 0.12, 1.8)
    wantPos = new THREE.Vector3(p.x - fwdV.x * back, onFoot ? 2.1 : 3.4 + speed * 0.03, p.z - fwdV.z * back)
    wantPos.x = THREE.MathUtils.clamp(wantPos.x, -12.4, 12.4)
    wantPos.z = THREE.MathUtils.clamp(wantPos.z, -15.4, 15.4)
    wantLook = new THREE.Vector3(p.x + fwdV.x * 3, onFoot ? 1.3 : 1.0, p.z + fwdV.z * 3)
  } else if (mode === 'cockpit') {
    wantPos = new THREE.Vector3(p.x + fwdV.x * 0.15 + fwdV.z * 0.36, 1.3, p.z + fwdV.z * 0.15 - fwdV.x * 0.36)
    wantLook = new THREE.Vector3(p.x + fwdV.x * 10, 1.15, p.z + fwdV.z * 10)
    ease = 1
  } else {
    wantPos = new THREE.Vector3(p.x * 0.4, 15, p.z * 0.4 + 6)
    wantLook = new THREE.Vector3(p.x, 0, p.z)
  }
  camPos.lerp(wantPos, ease)
  camLook.lerp(wantLook, ease)
  camera.position.copy(camPos)
  camera.lookAt(camLook)
  const fov = mode === 'cockpit' ? 78 : 58 + Math.min(speed * 0.4, 8)
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * 0.1
    camera.updateProjectionMatrix()
  }
}

// ---- HUD ----------------------------------------------------------------------
const speedEl = $('speed')
const gearEl = $('gear')
const rpmEl = $('rpm')
const driftEl = $('drift')
const promptEl = $('prompt')
let driftScore = 0
let driftHold = 0
let best = 0

// ---- Loop -------------------------------------------------------------------
const clock = new THREE.Clock()
let shake = 0

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05)
  const c = readControls()
  const hit = car.update(dt, c)
  person.update(dt, car, readWalk())
  if (hit && car.speed > 2) shake = Math.min(0.2, car.speed * 0.02)

  // Skid marks, smoke and drift scoring.
  const sliding = car.slip > 2.2 && car.speed > 3
  const wheelSlip = sliding || (c.handbrake && car.speed > 3)
  for (const [i, side] of [1, -1].entries()) {
    if (wheelSlip) {
      const w = car.rearWheel(side)
      fx.skid(i, w.x, w.z, Math.atan2(car.vx, car.vz))
      if (Math.random() < 0.55) fx.smoke(w.x, w.z, Math.min(car.speed / 8, 2))
    } else fx.lift(i)
  }
  fx.update(dt)
  if (sliding) {
    driftScore += car.slip * car.speed * dt * 6
    driftHold = 1.4
  } else if (driftHold > 0) {
    driftHold -= dt
    if (driftHold <= 0) {
      best = Math.max(best, Math.round(driftScore))
      driftScore = 0
    }
  }
  driftEl.textContent = driftScore > 5 ? `DRIFT ${Math.round(driftScore)}` : best ? `BEST ${best}` : ''
  driftEl.classList.toggle('live', driftScore > 5)

  let prompt = ''
  if (person.state === 'inside') prompt = !car.engineOn ? 'Engine off — press K to start' : car.speed < 1.2 ? 'Press E to get out · K to turn the engine off' : ''
  else if (person.state === 'onfoot') prompt = person.distanceToDoor(car) < 4 ? 'Press E to get in' : 'W / S walk · A / D turn · Shift run — go back to the door and press E'
  promptEl.textContent = prompt
  promptEl.classList.toggle('show', prompt !== '')

  sound.update(car.rpm, c.throttle, car.slip, car.engineOn)
  updateCamera(dt)
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake
    camera.position.y += (Math.random() - 0.5) * shake
    shake = Math.max(0, shake - dt * 0.6)
  }

  speedEl.textContent = String(Math.round(car.speed * 3.6))
  gearEl.textContent = car.gear
  rpmEl.style.setProperty('--v', String(Math.min(1, car.rpm)))
  composer.render()
})
