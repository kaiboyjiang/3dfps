# 3dfps
vibecoded 3d fps by devin

**Boarding Party**: a first-person shooter set inside a starship, running in the browser with [Three.js](https://threejs.org/) (loaded from a CDN, no build step).

Play: https://kaiboyjiang.github.io/3dfps/

## Objective

You and five allied bots board the enemy ship from the hangar. Capture its three sections by standing in their rings:

| Point | Section | Starts |
| --- | --- | --- |
| A | Cargo Bay | Neutral |
| B | Reactor | Neutral |
| C | Bridge | Enemy-held |

A point fills toward whichever team has more people inside; it stalls while contested. Each team has 150 reinforcement tickets: a death costs one, and every section a team holds over the other drains the opposing team's tickets. Bots and the player redeploy 5 seconds after dying (allies at the hangar, enemies behind the bridge).

You win by holding all three sections or emptying the enemy's tickets, and lose if allied tickets run out. Allies path to and defend points, fight hostiles, and can't be hit by your shots. Hostiles contest points and target both you and your allies.

## Controls

All key layouts are always active, so you can play with the mouse in either hand. Mouse buttons are the same for everyone: left click shoots, right click aims.

| Action | Controls |
| --- | --- |
| Move | WASD / IJKL / arrows / numpad 8-4-5-6 |
| Shoot (hold for automatic weapons) | Left click |
| Aim down sights / scope | Right click |
| Switch weapon | 1-5 / 6-0 / mouse wheel / Y, O |
| Jump | Space / Right Ctrl / numpad 0 |
| Sprint | Shift / H |
| Reload | R / U / Enter / middle click |
| Pause | Esc / P |

Five procedurally modelled energy weapons, each with its own damage, fire rate, recoil, cell capacity and recharge:

| Slot | Weapon | Ammo | Notes |
| --- | --- | --- | --- |
| 1 | VX-9 Ion Pistol | Ion cell | Accurate semi-auto sidearm |
| 2 | P-40 Pulse SMG | Pulse cell | Fast, low-recoil automatic |
| 3 | LR-7 Plasma Rifle | Plasma core | Hard-hitting automatic rifle |
| 4 | SC-12 Scatter Blaster | Arc charge | 9-bolt spread, pump action, cell-by-cell reload |
| 5 | RG-2 Rail Gun | Mag slug | Bolt-action precision rifle with a scope |

Headshots deal extra damage. Hostiles sometimes drop health and plasma-cell pickups.

## Graphics

The ship has a hangar with a docked shuttle and a force field open to space, a cargo bay, a reactor room, engineering and a bridge with a view of a planet. It is detailed with bulkhead doors, consoles, screens, conduits, vents and light strips. Rendering uses physically based materials with CC0 texture sets from [Poly Haven](https://polyhaven.com) (`assets/textures`), a procedural nebula and starfield, image-based lighting, soft shadows, ACES tone mapping, MSAA, bloom and impact decals.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/.
