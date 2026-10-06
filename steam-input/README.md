# Steam Input layout for Couch Launcher

Couch Launcher treats **keyboard keys as its primary input** in Gaming Mode. Steam Input recreates its virtual gamepad whenever an app launches (steam-for-linux#13665), and a Flatpak browser that is already running then loses gamepad input. A layout that turns the controller into key presses is the first mitigation.

## Bindings

| Controller | Key | Action in Couch Launcher |
| --- | --- | --- |
| D-pad up / down / left / right | Up / Down / Left / Right arrow | Move focus |
| Left stick (as a D-pad) | Arrow keys | Move focus |
| A | Enter | Select |
| B | Escape | Back |
| X | X | Open Tonight |
| Y | Y | Item options (favourite, hide, session length) |
| LB | Q | Previous section (Home, Play, Watch) |
| RB | E | Next section |
| Start (Menu) | S | Settings |
| Steam / Guide | (unbound) | Reserved by Steam |

Holding a direction repeats after 400 ms at 8 steps per second. Couch Launcher handles the timing itself, so Steam's own key repeat settings do not matter.

## Applying it

Steam does not import layout files from outside its own folders, and the installer never writes into Steam's files. Set the layout by hand once:

1. In Gaming Mode, select the **Couch Launcher** shortcut, then **Controller settings** (the controller icon) and **Edit layout**.
2. Start from the template **Keyboard (WASD) and Mouse**, or from a blank layout.
3. Bind each control as in the table above. Under **Buttons**, set A, B, X and Y to *Keyboard key*. Under **D-pad**, set the four directions to the arrow keys. Under **Joysticks > Left**, set the style to *Directional pad* with arrow keys. Under **Bumpers** and **Menu buttons**, set LB, RB and Start.
4. Save it as a personal layout named "Couch Launcher (keyboard)".

`couch_launcher_keyboard.vdf` in this folder is the same layout in Steam's controller-configuration format. It is provided as a reference for anyone who manages layouts by hand. Steam would normally store it as `controller_neptune.vdf` / `controller_*.vdf` under its own userdata folder. It has not been loaded on a real Steam client (see `docs/ON_DEVICE.md`).

On Windows (Big Picture), the Edge window reads the controller directly through the Gamepad API, and no layout is needed. If Steam Input is enabled for the shortcut, use the same bindings.
