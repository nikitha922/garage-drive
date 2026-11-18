# Garage Drive

A small 3D driving sandbox built with [Three.js](https://threejs.org), TypeScript and Vite. You drive a red coupe around a closed garage with the keyboard.

## Run

```bash
npm install
npm run dev
```

## Features

- Sleek extruded car body, alloy wheels with brake discs and calipers, LED headlights, full-width tail bar, underglow
- Post-processing: ambient occlusion (GTAO), bloom, ACES tone mapping
- Mirror-reflective polished concrete floor
- Drift physics (velocity-based grip, handbrake slides), tyre skid marks, tyre smoke, drift score
- Synthesised engine, tyre squeal and horn (WebAudio)
- Sport / Eco drive modes, 6 paint colours, 4 cameras including a free orbit photo mode
- A driver who steps out of the car (door swings open), walks around the garage and can get back in
- Physical props: shove barrels, tyres and crates with the car or on foot; crash into a shelf and its boxes tumble off; pick up, carry and throw boxes
- Keyboard, gamepad and touch controls

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A / ← and D / → | Steer |
| Space | Handbrake (drift) |
| C | Camera: chase, cockpit, top, orbit |
| T | Sport / Eco mode |
| L / U | Headlights / underglow |
| 1-6 | Paint colour |
| H | Horn |
| K | Engine on / off (off = no drive, car coasts to a stop, engine sound stops) |
| F | On foot: pick up the nearest box, press again to drop (hold Shift to throw) |
| E | Get out of / back into the car (on foot: W/S walk, A/D turn, Shift run) |
| Q | Toggle effects (use if it runs slowly) |
| M | Mute |
| R | Reset the car |

Gamepad: right trigger gas, left trigger brake, left stick steer, A handbrake, Y camera, B lights, bumpers mode, Start reset.

## Layout

- `src/garage.ts`: room, lighting, reflective floor, props and collision footprints
- `src/car.ts`: car model and driving physics
- `src/props.ts`: physics for boxes, barrels and tyres (shoving, shelf knock-off, carry/throw)
- `src/person.ts`: the driver model, exit/enter animation and on-foot walking
- `src/effects.ts`: skid marks and smoke
- `src/sound.ts`: engine and tyre audio
- `src/main.ts`: renderer, post-processing, input, camera, HUD

## Deploy

`npm run deploy` builds the project and publishes `dist/` to the `gh-pages` branch. In the repo settings, set Pages to serve from that branch.
