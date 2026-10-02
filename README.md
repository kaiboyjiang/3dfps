# 3dfps
vibecoded 3d fps by devin

A wave-based first-person shooter that runs in the browser, built with [Three.js](https://threejs.org/) (loaded from a CDN, no build step).

Play: https://kaiboyjiang.github.io/3dfps/

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| Left click | Shoot (hold for automatic weapons) |
| Right click | Aim down sights / scope |
| 1-5 / mouse wheel | Switch weapon |
| Space | Jump (crates can be climbed) |
| Shift | Sprint |
| R | Reload |
| Esc | Pause |

Weapons are procedurally modelled after real firearms, each with its own damage, fire rate, recoil, magazine and reload:

| Slot | Weapon | Caliber | Notes |
| --- | --- | --- | --- |
| 1 | Glock 17 | 9x19mm | Semi-auto pistol, slide locks back on empty |
| 2 | MP5A2 | 9x19mm | Fast, low-recoil SMG with diopter sight |
| 3 | AK-47 | 7.62x39mm | Hard-hitting automatic rifle |
| 4 | Remington 870 | 12 gauge | Pump shotgun, 9 pellets, shell-by-shell reload |
| 5 | M24 SWS | 7.62x51mm | Bolt-action sniper with 10x scope |

Headshots deal extra damage. Enemies path around cover, drop health/ammo pickups, and each wave brings more of them.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/.
