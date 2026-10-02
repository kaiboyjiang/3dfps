# 3dfps
vibecoded 3d fps by devin

A wave-based first-person shooter that runs in the browser, built with [Three.js](https://threejs.org/) (loaded from a CDN, no build step).

Play: https://kaiboyjiang.github.io/3dfps/

## Controls

Both layouts are always active. Tick **Left-handed mouse** on the start screen to swap the mouse buttons (saved in the browser).

| Action | Mouse in right hand | Mouse in left hand |
| --- | --- | --- |
| Move | WASD | IJKL / arrows / numpad 8-4-5-6 |
| Shoot (hold for automatic weapons) | Left click | Right click (with swap enabled) |
| Aim down sights / scope | Right click | Left click (with swap enabled) |
| Switch weapon | 1-5 / mouse wheel | 6-0 / mouse wheel / Y, O |
| Jump (crates can be climbed) | Space | Space / Right Ctrl / numpad 0 |
| Sprint | Shift | Right Shift / H |
| Reload | R / middle click | U / Enter / middle click |
| Pause | Esc | Esc / P |

Weapons are procedurally modelled after real firearms, each with its own damage, fire rate, recoil, magazine and reload:

| Slot | Weapon | Caliber | Notes |
| --- | --- | --- | --- |
| 1 | Glock 17 | 9x19mm | Semi-auto pistol, slide locks back on empty |
| 2 | MP5A2 | 9x19mm | Fast, low-recoil SMG with diopter sight |
| 3 | AK-47 | 7.62x39mm | Hard-hitting automatic rifle |
| 4 | Remington 870 | 12 gauge | Pump shotgun, 9 pellets, shell-by-shell reload |
| 5 | M24 SWS | 7.62x51mm | Bolt-action sniper with 10x scope |

Headshots deal extra damage. Enemies path around cover, drop health/ammo pickups, and each wave brings more of them.

## Graphics

Scenes use physically based materials with CC0 texture sets from [Poly Haven](https://polyhaven.com) (`assets/textures`), image-based lighting from a sky dome, soft sun shadows, ACES tone mapping, MSAA, bloom and bullet-hole decals.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/.
