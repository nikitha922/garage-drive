import * as THREE from 'three'
import { Car, type Controls } from './car'
import { buildGarage } from './garage'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const speedEl = document.getElementById('speed')!

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color('#14161a')
scene.fog = new THREE.Fog('#14161a', 28, 60)

// Soft studio reflections so the paint and chrome have something to catch.
const pmrem = new THREE.PMREMGenerator(renderer)
const envScene = new THREE.Scene()
envScene.background = new THREE.Color('#2a2d33')
const envLight = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 20), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
envLight.position.y = 7
envScene.add(envLight)
scene.environment = pmrem.fromScene(envScene, 0.04).texture
scene.environmentIntensity = 0.6

buildGarage(scene)
const car = new Car()
scene.add(car.group)

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

// ---- Input ------------------------------------------------------------------
const held = new Set<string>()
const MODES = ['chase', 'cockpit', 'top'] as const
let mode = 0

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const k = e.key.toLowerCase()
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
  if (!e.repeat) {
    if (k === 'c') mode = (mode + 1) % MODES.length
    if (k === 'l') car.toggleHeadlights()
    if (k === 'r') car.reset()
    if (k === 'h') horn()
  }
  held.add(k)
})
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()))
addEventListener('blur', () => held.clear())

const any = (...keys: string[]) => keys.some((k) => held.has(k))
const controls = (): Controls => ({
  throttle: any('w', 'arrowup'),
  brake: any('s', 'arrowdown'),
  left: any('a', 'arrowleft'),
  right: any('d', 'arrowright'),
  handbrake: held.has(' '),
})

// A tiny two-tone horn built with WebAudio, created on first use (needs a user gesture).
let audio: AudioContext | null = null
function horn() {
  audio ??= new AudioContext()
  const t = audio.currentTime
  const gain = audio.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
  gain.connect(audio.destination)
  for (const f of [392, 494]) {
    const o = audio.createOscillator()
    o.type = 'square'
    o.frequency.value = f
    o.connect(gain)
    o.start(t)
    o.stop(t + 0.5)
  }
}

// ---- Camera -----------------------------------------------------------------
const camPos = new THREE.Vector3()
const camLook = new THREE.Vector3()
const tmp = new THREE.Vector3()

function updateCamera(dt: number) {
  const p = car.position
  const fwd = tmp.set(Math.sin(car.heading), 0, Math.cos(car.heading))
  let wantPos: THREE.Vector3
  let wantLook: THREE.Vector3
  let ease = 1 - Math.pow(0.0015, dt)

  if (MODES[mode] === 'chase') {
    wantPos = new THREE.Vector3(p.x - fwd.x * 8, 3.6, p.z - fwd.z * 8)
    // Keep the camera inside the room.
    wantPos.x = THREE.MathUtils.clamp(wantPos.x, -12.4, 12.4)
    wantPos.z = THREE.MathUtils.clamp(wantPos.z, -15.4, 15.4)
    wantLook = new THREE.Vector3(p.x + fwd.x * 3, 1.0, p.z + fwd.z * 3)
  } else if (MODES[mode] === 'cockpit') {
    wantPos = new THREE.Vector3(p.x + fwd.x * 0.1 + fwd.z * 0.4, 1.35, p.z + fwd.z * 0.1 - fwd.x * 0.4)
    wantLook = new THREE.Vector3(p.x + fwd.x * 10, 1.2, p.z + fwd.z * 10)
    ease = 1
  } else {
    wantPos = new THREE.Vector3(p.x * 0.4, 14.5, p.z * 0.4 + 6)
    wantLook = new THREE.Vector3(p.x, 0, p.z)
  }
  camPos.lerp(wantPos, ease)
  camLook.lerp(wantLook, ease)
  camera.position.copy(camPos)
  camera.lookAt(camLook)
  camera.fov = MODES[mode] === 'cockpit' ? 75 : 60
  camera.updateProjectionMatrix()
}
camPos.set(0, 4, 14)
camLook.set(0, 1, 6)

// ---- Loop -------------------------------------------------------------------
const clock = new THREE.Clock()
let shake = 0

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05)
  const hit = car.update(dt, controls())
  if (hit) shake = 0.12
  updateCamera(dt)
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake
    camera.position.y += (Math.random() - 0.5) * shake
    shake = Math.max(0, shake - dt * 0.6)
  }
  speedEl.textContent = String(Math.round(Math.abs(car.speed) * 3.6))
  renderer.render(scene, camera)
})
