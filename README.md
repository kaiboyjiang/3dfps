# 3dfps
vibecoded 3d fps by devin

A wave-based first-person shooter that runs in the browser, built with [Three.js](https://threejs.org/) (loaded from a CDN, no build step).

Play: https://kaiboyjiang.github.io/3dfps/

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| Left click | Shoot (hold for auto) |
| Space | Jump (crates can be climbed) |
| Shift | Sprint |
| R | Reload |
| Esc | Pause |

Headshots deal extra damage. Enemies path around cover, drop health/ammo pickups, and each wave brings more of them.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/.
