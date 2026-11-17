# Garage Drive

A small 3D driving sandbox built with [Three.js](https://threejs.org), TypeScript and Vite. You drive a red coupe around a closed garage with the keyboard.

## Run

```bash
npm install
npm run dev
```

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A / ← and D / → | Steer |
| Space | Handbrake |
| C | Cycle camera: chase, cockpit, top |
| L | Headlights |
| H | Horn |
| R | Reset the car |

## Layout

- `src/garage.ts`: room, lighting, props and the collision footprints
- `src/car.ts`: car model and driving physics
- `src/main.ts`: renderer, input, camera
