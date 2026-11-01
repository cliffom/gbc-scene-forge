# Create your first level blockout

Build a forest level plan without importing artwork. You will lay out ground and
a pool, add a climb and an encounter, place progression markers, and review the
route from a player's camera. Finish by saving, reopening and exporting the plan.

Allow about 20–30 minutes for a first pass. The coordinates below are examples you
can follow exactly or change to suit your level. The 960px forest is a starting
section; it does not prescribe the final length of a complete stage.

## Before you begin

Install Scene Forge 0.11.0 or newer with Python 3.10+ and start it:

```sh
python -m pip install --upgrade gbc-scene-forge==0.11.0
gbc-scene-forge
```

Forge opens your browser. Keep the terminal running while you edit. If a server
is already using the default port, start this session with
`gbc-scene-forge --port 0` to choose an available port.

From a checkout configured with the [development setup](../../README.md#development),
use `make run PORT=0` instead. See the [launch guide](../../README.md#start-editing)
for project locations and manual browser opening.

No atlas, artwork, Tiled installation or game project is needed for this tutorial.

## 1. Create the project and scene

1. On the project selector, choose **Create a new project** if other projects are
   already listed.
2. Enter **Forest blockout** as the project name.
3. Under **Start with**, choose **Blockout — no artwork needed** and select
   **Create project**.
4. In the blockout scene dialog, enter **Opening forest** and use these settings:

   | Setting | Value |
   | --- | --- |
   | Dimensions in | Pixels |
   | Width / Height | 960 / 272 |
   | Grid | 8 px |
   | Gameplay camera width / height | 160 / 136 px |
   | Scroll horizontally | Checked |
   | Scroll vertically | Unchecked |

5. Check that the summary shows **120×34 cells**, **6 horizontal screens** and
   **2 vertical screens**, then choose **Create blockout**.

The **Blockout** library opens. You should see an empty scene and a labeled camera
rectangle. The inspector's Layers section contains Artwork, Blockout geometry,
Gameplay markers, Design notes and Camera guides.

In an existing project, **Scene actions → Create blockout scene…** opens the same
workflow without creating another project.

## 2. Learn the placement and editing loop

Use this loop for the recipes that follow:

1. Choose a preset in the Blockout library. Forge chooses a matching visible
   object layer automatically.
2. **Drag** on the canvas to draw a rectangle, or **click** to place a point marker.
   A click with a rectangle preset uses its default size.
3. The new object is selected. In the inspector, choose **Edit selected object**.
4. Enter the object's **Name**, **X**, **Y** and, for a rectangle, **Width** and
   **Height**. Choose **Apply object changes**.

All coordinates and object dimensions in this tutorial are in **pixels**, even
when the scene dimensions are displayed in cells. Positions start at the top left:
X increases to the right and Y increases downward.

You can place a rough shape anywhere with enough space, then enter the exact
recipe values in the object editor. That also lets you position an object beyond
the currently visible part of a long scene.

To edit an object later, choose **Select**, activate its layer in the inspector,
and click its body or choose it from the object list. Then use **Edit selected
object**. Clicking the canvas with a placement preset still active places another
object, so switch to Select before picking existing objects.

Use **Fit scene** to see the whole route. For closer editing, choose 1× or 2× zoom;
hold Space and drag to pan. Keep **Snap to grid** enabled for this exercise. Hold
Alt for a placement or resize that needs to bypass snapping.

## 3. Build the ground and pool

Create these four rectangles using the placement/editing loop:

| Preset | Name | X | Y | Width | Height |
| --- | --- | ---: | ---: | ---: | ---: |
| Solid ground | Forest floor west | 0 | 240 | 320 | 32 |
| Water | Red pool | 320 | 240 | 64 | 32 |
| Solid ground | Forest floor east | 384 | 240 | 576 | 32 |
| One-way platform | Vine landing | 176 | 192 | 64 | 8 |

Choose **Fit scene**. You should see two stretches of ground with a 64px pool
between them, plus a short raised platform on the west side.

To make only this pool red:

1. Select **Red pool** on the Blockout geometry layer and open **Edit selected
   object**.
2. Find the typed field **blockout_color**.
3. Check **Override shared value** for that field and enter `#cf7777`.
4. Choose **Apply object changes**.

The pool keeps its water label and wave pattern. Changing this override affects
only this object; it does not recolor every Water instance.

## 4. Add a climb and an encounter

Add these objects:

| Preset | Name | X | Y | Width | Height |
| --- | --- | ---: | ---: | ---: | ---: |
| Climb region | Short vine | 208 | 192 | 16 | 48 |
| Enemy | Forest patrol | 96 | 232 | — | — |
| Patrol range | Patrol activity | 64 | 208 | 96 | 32 |
| Visible reward | Vine reward | 224 | 184 | — | — |

The vine connects the floor height to the raised landing. Its **ENTRY** marker
starts at the bottom edge and its **EXIT** marker at the top. In its object
editor, you can override `entry_edge`, `exit_edge` and their offsets from 0 to 1
along the chosen edge. Those positions follow the region when it resizes.

For **Patrol activity**, optionally override the `actor` field with
`Forest patrol`. This records which encounter the area is intended for; it does
not create an executable patrol behavior or a validated object link.

Choose **Save scene**, or press Ctrl/⌘ S, and wait for **Saved** beside the scene
selector.

## 5. Mark progression and pacing

Place the remaining progression points and an arena proposal:

| Preset | Name | X | Y | Width | Height |
| --- | --- | ---: | ---: | ---: | ---: |
| Player spawn | Forest entrance | 16 | 232 | — | — |
| Checkpoint | Midpoint checkpoint | 480 | 232 | — | — |
| Boss entrance | Arena approach | 736 | 232 | — | — |
| Boss arena | Arena proposal | 768 | 136 | 192 | 136 |
| Stage exit | Exit proposal | 944 | 232 | — | — |
| Named section | Opening forest | 0 | 104 | 320 | 168 |
| Design note | Stage pacing | 32 | 64 | — | — |

In the **Stage pacing** object's editor, override `design_note` with:

> 960px is the starting forest; full stage length remains undecided.

The first line appears in the planning label; the complete note stays in the
object's properties. The named section and note use the Design notes layer.

You can expand the plan with Hidden discoverable, Optional detour, Flying
approach, Pit and Damaging terrain presets. Their labels, symbols and patterns
help you distinguish intentions without relying on color alone.

The screenshot below shows an expanded version of this forest example, including
an upper detour and a possible flying encounter. Your simpler plan need not match
it exactly.

![An expanded forest plan with geometry, encounters, progression markers and a camera frame](../screenshots/blockout/forest.png)

## 6. Review the player's camera

The initial camera is at the top left, so move it down to include the ground:

1. Scroll within the Blockout library to **Camera framing**.
2. Choose the camera and select **Settings…**.
3. Set **X = 0**, **Y = 136**, **Width = 160**, **Height = 136**.
4. Keep `scroll_x` true and `scroll_y` false. These fields are under the camera's
   typed properties. Choose **Apply object changes**.
5. Select **Camera & overview…**.

The review shows the full route and a larger view through the selected camera.
The first frame should include the spawn, west ground and patrol activity. The
summary identifies the camera position, screen measurements and intended axes.

Close the review, use **Select / move** under Camera framing, and drag the camera
to inspect another area. For an exact comparison, set its X position to **224**
and keep Y at **136**, then open the review again. The pool and the right edge of the vine landing
should now be visible in that frame.

As you review, consider:

- Is the edge of a hazard visible before the player reaches it?
- Can the player see the intended landing and the top of a climb?
- Are rewards, encounters and checkpoints placed with a readable rhythm?
- Does an arena entrance communicate that a different section is beginning?

The SVG review includes current **unsaved** edits but does not save them. It shows
visible planning layers; inspect artwork alongside the plan on the main canvas.
Use **Download overview SVG** or **Download camera SVG** to share a snapshot.
Reopen the review after further edits to generate a current snapshot.

![Read-only full-route and player-camera review](../screenshots/blockout/review.png)

Camera framing expresses design intent. This review does not simulate jumping,
climbing, one-way collision, enemy behavior or game physics.

## 7. Make a change and undo it

Try widening the vine landing:

1. Activate **Blockout geometry**, choose **Select**, and select **Vine landing**.
2. Drag its bottom-right square to widen the rectangle. Keep the pointer near its
   original bottom edge to preserve the height. You can also enter an exact width
   in **Edit selected object**.
3. Choose **Undo** or press Ctrl/⌘ Z. The previous rectangle should return.
4. Choose **Redo** to keep the wider version, or leave it undone.

A continuous draw or resize drag is one undo step. Moving an existing rectangle
keeps its identity; it does not replace it with a newly placed object.

For another iteration, move the checkpoint or adjust the climb's height, then
recheck the nearby camera view. Decide which version you prefer and save it.

## 8. Save, reopen and export

1. Choose **Save scene** and wait for **Saved**.
2. Reload the browser. Select **Opening forest** in the Scene dropdown.
3. Confirm that your named objects, pool color, note and camera position survived.
4. Choose **Export…**, select **Whole project**, and choose **Download ZIP**.
5. Extract the ZIP. The scene uses native Tiled objects and custom properties;
   its camera is a rectangle with saved dimensions and scrolling properties.

Keep the original Forge project folder to continue editing. Downloading an SVG
or a ZIP does not replace saving your working scene. Scene-only exports are also
available; use Whole project for this exercise to include the reusable definition
library and portable project data.

## 9. Add artwork when the plan is ready

You can continue this step later, once you have an atlas:

1. Save the plan, open the **Artwork** tab, and choose **Import atlas…**.
2. Select a supported gbc-atlas manifest/PNG folder and import it. Ordinary PNG
   tilesheet import is a separate planned feature.
3. Select the **Artwork** tile layer before painting. Put sprite artwork on an
   object layer, keeping planning objects on their existing layers.
4. Toggle planning-layer visibility to compare the plan with the artwork. Keep a
   camera guide visible when generating camera review.
5. Save again. The geometry, markers, notes and their identities remain in the
   project alongside the art.

There is no need to redraw the plan as artwork arrives.

## If something is not working

| What you see | What to check |
| --- | --- |
| No Blockout project option or scene command | Install 0.11.0 or newer and restart Forge. Refreshing an older running server does not load the upgraded package. |
| Pixel dimensions are rejected | Each pixel dimension must divide evenly by the selected grid. For example, 960×272 works with an 8px grid. Scenes support at most 65,536 cells and 8,192 pixels per axis. |
| Clicking creates another object | Switch from the placement tool to Select before picking an existing object. |
| An object cannot be selected | Activate its object layer and make sure that layer is visible. Use the object list, or the camera's Select / move button for a camera frame. |
| A typed field is disabled | Check Override shared value for that field. Uncheck it to inherit the shared default again. |
| Camera review asks for a camera | Show the Camera guides layer and choose a visible camera frame. |
| The camera looks empty | Move the frame over the planned route. For this example, X=0, Y=136 includes the west ground. Review renders plan geometry, not artwork. |
| A long scene is hard to see | Choose Fit scene for the overview, then zoom in or use camera review for detail. |
| A review limit is reported | Hide some planning layers and review a subset; see the reference for the preview bounds. |

You have completed the tutorial when your plan survives reopening, a deliberate
change can be undone, the camera shows the intended part of the route, and a
whole-project ZIP downloads successfully.

For preset customization, storage details, preview limits and the shared service
boundary, see the [blockout reference](../BLOCKOUT.md).

## Reading labels in a dense plan

Canvas labels stay at 13 display pixels as you zoom, independently of the pixel
artwork. Captions use an opaque dark background and a colored edge matching the
object. The selected object's caption gets first placement, followed by cameras,
gameplay markers, design notes/sections, geometry, and climb entry/exit captions.
Labels try nearby positions and are omitted when those positions are occupied.
At most 160 captions are displayed in the visible part of the scene.

Long captions are shortened with an ellipsis. Select an object on the canvas or
through its layer's object list to prioritize its caption and read its complete
name and design note in the Selection inspector. **Edit selected object** exposes
all typed properties, including camera scrolling and climb endpoints. Notes stay
in the inspector instead of expanding across the plan.

Panning and resizing recalculate captions for the visible scene. Labels do not
intercept canvas clicks or change selection, geometry, saved files, or Undo.
Zooming in gives nearby labels more room; hiding a layer also hides its labels.

Downloaded and MCP SVG reviews use vector text with the same role hierarchy,
nearby placement, shortening, collision suppression, and a 160-caption limit.
Their captions use a fixed 11 scene-pixel font and scale with the SVG, unlike the
browser's display-size text. SVG object titles retain names and notes even when
captions are omitted; native scene data and the browser inspector remain the
complete reference. The camera review lays out captions inside its own frame.

See the [before](../screenshots/blockout-labels/before.png),
[after](../screenshots/blockout-labels/after.png), and
[4× Retina view](../screenshots/blockout-labels/4x-retina.png).
