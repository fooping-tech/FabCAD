import { HELP_JA } from "./content.ja";
import type { HelpEntry, HelpFallback } from "./types";

/**
 * The help registry. Keys are help ids:
 *
 * - `sketch.<id>`: Create tools of the sketch (`CREATE_TOOLS`) and its other commands
 * - `sketch.modify.<id>`: Modify tools of the sketch (`SKETCH_MODIFY_TOOLS`)
 * - `constraint.<type>`: sketch constraints (`CONSTRAINT_TOOLS`)
 * - `solid.<dialog type>`: features of the solid environment (`DIALOG_COMMANDS`)
 * - `component.<id>`: components and their instances (the Assemble group of the ribbon)
 * - `fabrication.<process>`, `select`, `measure`, `selection.multi`
 *
 * The help is shown in two languages: English from here, Japanese from `content.ja.ts`, which
 * has an entry of the same shape for every id.
 *
 * Adding a tool, or changing what a tool does, takes or needs, means editing its entry here
 * and in `content.ja.ts` in the same change (see CLAUDE.md). `apps/fabcad/test/help.test.ts` fails when a tool of one of
 * the registries above has no entry.
 */

const SNAP_NOTE =
  "Positions snap to existing points, midpoints, centres and curves, line up horizontally and " +
  "vertically with other points, and otherwise fall on whole millimetres while Snap 1 mm is on. " +
  "Hold Ctrl / Cmd to place a point freely.";

const WINDOW_NOTE = "The window holds every input: click a selection field (it turns blue), then click in the sketch; type the numbers. The result is previewed in the sketch and OK (Enter) applies it as one step; Cancel (Esc) leaves the sketch as it was.";

const DIMENSIONS_NOTE =
  "When the shape is drawn, a window beside it shows the sizes that define it. Type a value " +
  "(typing a number in the view starts the first one) and press Enter: it becomes a dimension.";

const OPERATION = {
  name: "Operation",
  text:
    "New Body makes a body of its own. Join adds to the target bodies, Cut removes from them " +
    "and Intersect keeps what they have in common with the new solid.",
};

const EXPRESSIONS =
  "Every value is an expression: a number, a parameter name or a formula such as width / 2 + 3.";

export const HELP: Record<string, HelpEntry> = {
  // ------------------------------------------------------------------ general
  select: {
    title: "Select",
    shortcut: "Esc",
    summary: "Select, drag and edit. Esc returns to it from any tool.",
    what: [
      "Click to select what is under the pointer. Shift, Ctrl or Cmd adds to the selection or takes away from it.",
      "In a sketch, drag points and curves to move them as far as their constraints allow, and drag over empty space for a window selection: left to right selects what lies inside, right to left what the window touches.",
      "Double-click a dimension to edit it. Double-click sketch geometry in the solid environment to open its sketch.",
      "In a sketch, double-click a curve to select the whole chain it belongs to (all four sides of a rectangle). Curves whose ends meet count as a chain even when each has points of its own, such as projected edges. With Shift, Ctrl or Cmd the chain is added to the selection.",
    ],
    when: ["Whenever no other command is running: it is the idle state of the editor."],
    examples: [
      "Right-click (double tap on a touch screen) for the commands that fit the selection.",
      "The window of a command (Extrude, Offset, Fillet …) opens beside the click. Drag it by its title bar to move it out of the way; it opens there again for the rest of the session. Double-click the title bar to bring it back beside the click.",
    ],
  },
  "selection.multi": {
    title: "Multi-Select",
    summary:
      "Every click or tap adds to the selection or removes from it, as if Shift were held.",
    what: [
      "While Multi-Select is on, selecting something does not drop what was selected before. Selecting it again takes it out of the selection.",
      "It works for everything that can be selected: edges, faces, bodies, sketch entities, rows of the browser and the timeline.",
    ],
    when: [
      "On a phone or tablet, where there is no Shift key.",
      "With a mouse, when many things are to be picked one after another.",
    ],
    examples: [
      "Switch Multi-Select on, tap four edges, then start Fillet: all four are rounded by one feature.",
      "Clear empties the selection without leaving the mode.",
    ],
    limitations: [
      "Commands that pick several things themselves (Fillet, Chamfer, Shell, the patterns …) collect every click while their dialog is open, with or without Multi-Select.",
    ],
  },
  measure: {
    title: "Measure",
    shortcut: "I",
    summary: "Distances, angles, lengths, areas and volumes of what you pick.",
    what: [
      "Pick one thing to see its own size: the length of an edge, the radius of a circle, the area of a face, the volume of a body.",
      "Pick a second thing to see what lies between the two: distance, the distance along each axis, and the angle where there is one.",
    ],
    requires: ["Nothing. What was selected when the command was started is measured right away."],
    limitations: [
      "A measurement is only shown; nothing is stored in the document. Use a sketch dimension to keep a size.",
      "At most two things are measured at a time: a third pick starts the next measurement.",
    ],
  },

  "command-palette": {
    title: "Command Palette",
    shortcut: "Ctrl/Cmd+K",
    summary: "Run any command by typing its name.",
    what: [
      "Ctrl / Cmd + K, or Commands in the header, opens a box at the top of the window. Type a part of the name of a command (\"ext\" for Extrude, \"view top\", \"export svg\"); the arrow keys choose, Enter runs it, Esc closes.",
      "Only the commands that can run now are listed: the sketch tools and constraints inside a sketch, the features and exports outside, the exports in FABRICATION.",
    ],
    when: ["When a tool is in a menu, its icon is hard to tell apart, or the keyboard is quicker."],
  },
  timeline: {
    title: "Timeline",
    summary: "The history of the design, one step per feature, in the order they are computed.",
    what: [
      "Click a step to select it, double-click it to edit it, Alt-click it to suppress it. Right-click a step for its commands.",
      "The buttons at the left move the history marker to roll the design back: steps right of the marker are not computed, and new steps go in at the marker.",
      "Drag a step to another place to change the order. A blue bar shows where it can go; a step stays after what it is built on (its sketch, its plane, the step that made its body) and before the steps built on it, and a red bar says the place is refused. Two steps that only work on the same body may change places: the later one then works on what the earlier one left.",
    ],
    examples: [
      "A Join refuses because the bodies would touch only along an edge: drag the step that adds the joining piece in front of it.",
    ],
  },
  "timeline.copy-log": {
    title: "History Log",
    summary: "The design history as text: to check a result, or to report a problem.",
    what: [
      "The button at the left end of the timeline opens the history log: every step with its status and error message, the settings of each step, and the size and make-up of each body (volume, faces, separate pieces). It follows the model while it is open.",
      "Its last part, Fabrication (laser), says what would be cut: the material, what each body was recognised as (Flat Part, Rectangular Box, Unfolded Net, Unsupported) and every part with its size.",
      "Copy puts it on the clipboard together with the project itself. Paste it into a bug report: with the project in it, the result can be computed again exactly.",
    ],
    limitations: ["Fonts you loaded yourself are not in it, as in a saved project."],
  },

  // ------------------------------------------------------------ sketch: create
  "solid.pick-sketch-plane": {
    title: "Create Sketch",
    shortcut: "S",
    summary: "Start a sketch on an origin plane, a construction plane or a flat face.",
    what: [
      "Asks for the plane of the sketch and opens the sketch environment, looking straight at the plane.",
      "A sketch on a face starts with the outline of the face projected into it, and follows the face when the body changes. The outline does not cut what you draw across it: a closed shape drawn across it stays one profile. An outline lying inside a drawn shape without touching it does divide it: offset the outline 3 mm outward, and the frame between the two is a profile of its own. A sketch on a construction plane follows that plane.",
    ],
    requires: ["A plane or a flat face. One that is already selected is used directly."],
    limitations: ["Curved faces cannot carry a sketch."],
    examples: ["Select the top face of a body, then Create Sketch, to draw a pocket on it."],
  },
  "sketch.finish": {
    title: "Finish Sketch",
    summary: "Leave the sketch and return to the solid environment.",
    what: [
      "Closes the sketch. It stays in the timeline and can be opened again with a double-click.",
    ],
  },
  "sketch.line": {
    title: "Line",
    shortcut: "L",
    summary: "Straight lines, one after another: each click ends a line and starts the next.",
    what: [
      "Click the start and the end of a line. The next line starts where the last one ended, until you press Esc.",
      "A line drawn almost horizontally or vertically becomes exactly so and gets the constraint.",
      SNAP_NOTE,
      DIMENSIONS_NOTE,
    ],
    when: ["Outlines made of straight pieces, construction lines, mirror lines and axes."],
    examples: ["Click four corners and then the first point again, then Esc: a closed profile to extrude."],
  },
  "sketch.construction-line": {
    title: "Construction Line",
    summary: "A reference line that profiles ignore.",
    what: [
      "Click the start and the end. The line is construction geometry: it helps to place, mirror and constrain, and is left out when profiles are extruded.",
      SNAP_NOTE,
      DIMENSIONS_NOTE,
    ],
    when: ["Centre lines, mirror lines and axes of revolution."],
  },
  "sketch.polyline": {
    title: "Polyline",
    summary: "A chain of lines through any number of points, finished with Enter.",
    what: [
      "Click the points one after another. Enter (Done on a touch screen) or a double-click finishes the chain; clicking the first point again closes it.",
      SNAP_NOTE,
    ],
  },
  "sketch.rectangle-2point": {
    title: "2-Point Rectangle",
    shortcut: "R",
    summary: "A rectangle from two opposite corners, with horizontal and vertical sides.",
    what: [
      "Click one corner, then the opposite one. The sides are constrained horizontal and vertical.",
      SNAP_NOTE,
      DIMENSIONS_NOTE,
    ],
    examples: ["Dimension two sides afterwards (D) to fix the size."],
  },
  "sketch.rectangle-3point": {
    title: "3-Point Rectangle",
    summary: "A rectangle at any angle: two clicks for one side, a third for the width.",
    what: [
      "The first two clicks give one side and with it the angle; the third gives the width.",
      SNAP_NOTE,
      DIMENSIONS_NOTE,
    ],
  },
  "sketch.rectangle-center": {
    title: "Center Rectangle",
    summary: "A rectangle from its centre and one corner.",
    what: ["Click the centre, then a corner. The rectangle stays centred on the first point.", DIMENSIONS_NOTE],
    when: ["Shapes that are symmetric about a point, e.g. about the sketch origin."],
  },
  "sketch.circle": {
    title: "Center Diameter Circle",
    shortcut: "C",
    summary: "A circle from its centre and a point on it.",
    what: ["Click the centre, then a point of the circle.", SNAP_NOTE, DIMENSIONS_NOTE],
    examples: ["Draw circles inside a profile to get holes when the profile is extruded."],
  },
  "sketch.circle-3point": {
    title: "3-Point Circle",
    summary: "The circle through three points.",
    what: ["Click three points of the circle.", DIMENSIONS_NOTE],
    limitations: ["Three points on one straight line have no circle."],
  },
  "sketch.arc-3point": {
    title: "3-Point Arc",
    shortcut: "A",
    summary: "An arc from its two ends and a point in between.",
    what: ["Click the start, the end and then a point the arc passes through.", DIMENSIONS_NOTE],
  },
  "sketch.arc-center": {
    title: "Center Point Arc",
    summary: "An arc from its centre, its start and its end.",
    what: ["Click the centre, the start of the arc and then where it ends.", DIMENSIONS_NOTE],
  },
  "sketch.ellipse": {
    title: "Ellipse",
    summary: "An ellipse from its centre, the end of the major axis and a point for the width.",
    what: ["Click the centre, the end of the long axis, and a point that gives the short axis."],
    limitations: ["An ellipse cannot be the path of a sweep."],
  },
  "sketch.polygon-inscribed": {
    title: "Inscribed Polygon",
    summary: "A regular polygon from its centre and one corner.",
    what: [
      "Click the centre, then a corner. The corners lie on a circle through the second click.",
      "The second click also turns the polygon: move it straight above the centre, where it snaps into line, to get a corner exactly at the top.",
      DIMENSIONS_NOTE,
    ],
    parameters: [{ name: "Sides", text: "Number of sides, 3 or more. Set in the window that opens beside the first click; the preview follows." }],
    examples: ["Sides 6, centre on the origin, second click straight above it: a hexagon standing on a corner."],
  },
  "sketch.polygon-circumscribed": {
    title: "Circumscribed Polygon",
    summary: "A regular polygon from its centre and the middle of one side.",
    what: [
      "Click the centre, then the middle of a side. The sides touch a circle through the second click.",
      DIMENSIONS_NOTE,
    ],
    parameters: [{ name: "Sides", text: "Number of sides, 3 or more. Set in the window that opens beside the first click; the preview follows." }],
    when: ["When the distance across the flats is what is known, as for a hexagon nut."],
  },
  "sketch.slot": {
    title: "Slot",
    summary: "A slot with round ends: two clicks for the centres, a third for the width.",
    what: ["Click the centres of the two round ends, then a point that gives the width.", DIMENSIONS_NOTE],
  },
  "sketch.spline-fit": {
    title: "Fit Point Spline",
    shortcut: "S",
    summary: "A smooth curve through the points you click, finished with Enter.",
    what: [
      "Click the points the curve passes through. Enter (Done on a touch screen) or a double-click finishes it.",
    ],
    limitations: ["At least two points are needed."],
  },
  "sketch.spline-control": {
    title: "Control Point Spline",
    summary: "A smooth curve pulled towards the points you click, finished with Enter.",
    what: [
      "The clicked points form a control polygon; the curve starts and ends on it and follows it in between.",
    ],
  },
  "sketch.point": {
    title: "Point",
    summary: "A single point, e.g. the place of a hole.",
    what: ["Click to place a point.", SNAP_NOTE],
    when: ["To mark where holes are drilled: Hole takes sketch points."],
  },
  "sketch.text": {
    title: "Text",
    summary: "Text set in a font, as outlines that can be extruded or cut.",
    what: [
      "Click where the text starts and write it in the dialog. Font, height, spacing and alignment are set there; the height and the other numbers are expressions.",
      "The text stays editable. Its outlines count as profiles, so text can be extruded or cut like any closed shape. It can follow a line, an arc or a circle.",
    ],
    limitations: [
      "Fonts you load yourself are used on this computer only; they are neither saved in the project nor sent anywhere. A project opened without the font still shows and builds the text.",
      "Explode Text turns a text into plain curves, which can no longer be edited as text.",
    ],
  },
  "sketch.point-entry": {
    title: "Typed Points",
    summary: "Type the points of the shape being drawn instead of clicking them.",
    what: [
      "While a Create tool runs, type a digit (or @, -, .): a Point box opens at the bottom of the view.",
      "x, y places the point there; @dx, dy places it relative to the previous point of the shape (the origin for the first one); length<angle and @length<angle are polar, with the angle in degrees from the X axis.",
      "Enter places the point and the box stays open for the next one. Enter on an empty box finishes a polyline or a spline; Esc closes the box.",
    ],
    parameters: [{ name: "Values", text: EXPRESSIONS }],
    examples: ["Rectangle: 0, 0 Enter, then @60, 40 Enter. Line: 0, 0 Enter, @25<30 Enter."],
  },
  "sketch.project": {
    title: "Project",
    shortcut: "P",
    summary: "Bring edges, faces or vertices of a body into the sketch as reference geometry.",
    what: [
      "Click an edge, a face or a vertex of a body: its projection onto the sketch plane is added to the sketch.",
      "A curved face also gives its silhouette: where it turns away from the sketch plane. A cylinder seen from the side becomes a rectangle, a sphere a circle. Edges that land on the same line (the seams of a cylinder seen from the side) are projected once.",
      "Curved edges made from sketch splines (and ellipses) are projected exactly, as control splines, so that a profile drawn on the projection matches the faces of the body.",
      "Projected geometry follows the body when the body changes.",
      "Projected geometry is a reference for profiles: it does not cut a region that drawn curves enclose where it runs into the drawn curves. A ring drawn across the edge of a face is extruded as the whole ring. A projected outline that lies inside a drawn shape without touching it does divide it, into the frame between the two and the inside. Where nothing is drawn, the projection makes regions of its own: the face itself, the face around a drawn hole, or the parts of the face a drawn line divides.",
    ],
    when: ["To dimension or constrain against what is already there."],
    limitations: ["Projected geometry cannot be dragged: it is where the body puts it."],
  },
  "sketch.dimension": {
    title: "Sketch Dimension",
    shortcut: "D",
    summary: "Give a length, distance, radius, diameter or angle a value.",
    what: [
      "Pick what to dimension, then click where the dimension goes, and type the value.",
      "One line: its length. Two points, or a point and a line: their distance. A circle or arc: diameter or radius. Two lines: the angle between them.",
      EXPRESSIONS,
    ],
    limitations: [
      "A dimension that contradicts the constraints or other dimensions is refused: the sketch would be over-constrained.",
    ],
    examples: ["Double-click a dimension to change it; the sketch follows."],
  },
  "sketch.construction": {
    title: "Normal / Construction",
    shortcut: "X",
    summary: "Turn geometry into construction geometry and back.",
    what: [
      "Construction geometry helps to place and constrain but is not part of profiles: it is not extruded.",
      "With a selection, the selected curves are switched. Without one, the switch says how new geometry is drawn.",
    ],
    when: ["Centre lines, mirror lines, the circle a bolt pattern lies on."],
  },

  // ------------------------------------------------------------ sketch: modify
  "sketch.modify.fillet": {
    title: "Fillet (Sketch)",
    shortcut: "F",
    summary: "Round a corner between two lines with a tangent arc.",
    what: ["Click the two lines that meet at the corner. They are shortened and joined by an arc."],
    parameters: [{ name: "Radius", text: "Radius of the arc in mm, set in the window that opens beside the first line." }],
    limitations: ["Works on corners between two straight lines.", "The radius must leave something of both lines."],
  },
  "sketch.modify.chamfer": {
    title: "Chamfer (Sketch)",
    summary: "Cut a corner between two lines with a straight line.",
    what: ["Click the two lines that meet at the corner. They are shortened and joined by a straight line."],
    parameters: [{ name: "Distance", text: "How far from the corner the cut starts on both lines, set in the window that opens beside the first line." }],
    limitations: ["Works on corners between two straight lines."],
  },
  "sketch.modify.trim": {
    title: "Trim",
    shortcut: "T",
    summary: "Remove the piece of a curve between its nearest intersections.",
    what: ["Click the piece to remove. It is cut at the nearest crossings with other curves on both sides."],
    limitations: [
      "A curve that no other curve crosses is removed as a whole.",
      "Construction geometry does not cut.",
      "Ellipses and splines cannot be trimmed; they can cut other curves.",
    ],
  },
  "sketch.modify.extend": {
    title: "Extend",
    summary: "Lengthen a curve to the next curve it meets.",
    what: ["Click a curve near the end that is to grow. It is extended to the next intersection."],
    limitations: [
      "Lines and arcs only.",
      "Nothing happens when there is nothing in the way to extend to.",
    ],
  },
  "sketch.modify.break": {
    title: "Break",
    summary: "Split a curve in two at a point.",
    what: ["Click the curve where it is to be split."],
  },
  "sketch.modify.offset": {
    title: "Offset",
    shortcut: "O",
    summary: "A copy of a chain of curves at a constant distance.",
    what: [
      "Click a curve: the chain it belongs to is previewed offset to the side of the click, and a window opens beside the click. Curves whose ends meet are one chain even when each has points of its own (projected edges), and the corners of the copy stay joined: a square gives a square.",
      "With several curves selected (a chain double-clicked, or curves picked one by one), clicking one of them offsets all the selected curves together.",
      "Type the distance, or drag the previewed curve to where it should go. Flip moves it to the other side. OK (Enter) adds it; Cancel (Esc) drops it.",
      "Clicking another curve keeps the previewed offset and starts the next one.",
    ],
    parameters: [
      { name: "Distance", text: "Distance of the copy in mm. Dragging steps in whole millimetres with Snap 1 mm on; hold Ctrl / Cmd for finer steps. The next offset starts with the last distance." },
      { name: "Direction", text: "Flip: offset to the other side of the chain (inside or outside of a closed loop)." },
    ],
    limitations: ["A distance larger than an inner radius makes the offset fold over itself."],
  },
  "sketch.modify.move": {
    title: "Move (Sketch)",
    shortcut: "M",
    summary: "Move entities by a distance, picked from one point to another or typed.",
    what: [
      "Objects: the selection when the tool starts; click curves and points to add or leave out.",
      "From point and To point fill X distance and Y distance; the distances can also be typed.",
      WINDOW_NOTE,
    ],
    parameters: [{ name: "X distance / Y distance", text: "How far the objects move, in mm." }],
    limitations: ["Constraints still hold: constrained geometry may not follow all the way."],
  },
  "sketch.modify.copy": {
    title: "Copy (Sketch)",
    summary: "Duplicate entities at a distance, picked from one point to another or typed.",
    what: [
      "Objects: the selection when the tool starts; click curves and points to add or leave out.",
      "From point and To point fill X distance and Y distance; the distances can also be typed.",
      WINDOW_NOTE,
    ],
    parameters: [{ name: "X distance / Y distance", text: "Where the copy goes, in mm from the original." }],
  },
  "sketch.modify.scale": {
    title: "Scale",
    summary: "Scale entities about a fixed point.",
    what: ["Objects, then the Fixed point that stays where it is.", WINDOW_NOTE],
    parameters: [{ name: "Factor", text: "2 doubles the size, 0.5 halves it." }],
    limitations: ["Dimensions on the scaled geometry keep their values and pull it back: remove them first."],
  },
  "sketch.modify.mirror": {
    title: "Mirror (Sketch)",
    summary: "Mirror entities across a line.",
    what: ["Objects, then the Mirror line (a line of the sketch).", WINDOW_NOTE],
    parameters: [
      {
        name: "Symmetry constraints",
        text: "Ties the copy to the original, so that both change together.",
      },
    ],
  },
  "sketch.modify.rectangular-pattern": {
    title: "Rectangular Pattern (Sketch)",
    summary: "Repeat entities in rows and columns.",
    what: ["Objects, then the numbers: no points to pick.", WINDOW_NOTE],
    parameters: [
      { name: "Count", text: "Number of copies along the direction, the original included." },
      { name: "Rows", text: "Number of rows at right angles to it. Spacing and Row spacing are the distances; Direction turns the pattern (degrees from the X axis)." },
    ],
  },
  "sketch.modify.circular-pattern": {
    title: "Circular Pattern (Sketch)",
    summary: "Repeat entities around a centre.",
    what: ["Objects, then the Center point.", WINDOW_NOTE],
    parameters: [{ name: "Count", text: "Number of copies, the original included, spread over Total angle (360 for a full turn)." }],
  },
  "sketch.modify.toggle-construction": {
    title: "Normal / Construction",
    shortcut: "X",
    summary: "Turn geometry into construction geometry and back.",
    what: ["See Normal / Construction in Options: this is the same command."],
  },

  // -------------------------------------------------------------- constraints
  "constraint.coincident": {
    title: "Coincident",
    summary: "Put a point on another point or on a curve.",
    what: ["Pick a point, then a point, a line, a circle or an arc. The point stays on it."],
    examples: ["End of a line on a circle; two end points together."],
  },
  "constraint.collinear": {
    title: "Collinear",
    summary: "Put two lines on one straight line.",
    what: ["Pick two lines."],
  },
  "constraint.concentric": {
    title: "Concentric",
    summary: "Give two circles or arcs the same centre.",
    what: ["Pick two circles or arcs."],
  },
  "constraint.midpoint": {
    title: "Midpoint",
    summary: "Keep a point in the middle of a line.",
    what: ["Pick a point and a line."],
  },
  "constraint.fix": {
    title: "Fix / Unfix",
    summary: "Pin geometry where it is, or release it again.",
    what: ["Pick the geometry to fix. Picking fixed geometry releases it."],
    limitations: ["The sketch origin is always fixed."],
  },
  "constraint.parallel": {
    title: "Parallel",
    summary: "Make two lines parallel.",
    what: ["Pick two lines."],
  },
  "constraint.perpendicular": {
    title: "Perpendicular",
    summary: "Put two lines at a right angle.",
    what: ["Pick two lines."],
  },
  "constraint.horizontal": {
    title: "Horizontal",
    summary: "Make a line horizontal, or put two points at the same height.",
    what: ["Pick a line, or two points."],
    examples: ["Two circle centres picked as points end up side by side."],
  },
  "constraint.vertical": {
    title: "Vertical",
    summary: "Make a line vertical, or put two points above each other.",
    what: ["Pick a line, or two points."],
  },
  "constraint.tangent": {
    title: "Tangent",
    summary: "Let a line or arc touch a circle or arc smoothly.",
    what: ["Pick a line or an arc, then a circle or an arc."],
  },
  "constraint.equal": {
    title: "Equal",
    summary: "Give two lines the same length, or two circles or arcs the same radius.",
    what: ["Pick two lines, or two circles or arcs."],
  },
  "constraint.symmetry": {
    title: "Symmetry",
    summary: "Keep two points or lines mirrored across a line.",
    what: ["Pick the two points or lines, then the mirror line."],
  },

  // ------------------------------------------------------------ solid: create
  "solid.extrude": {
    title: "Extrude",
    shortcut: "E",
    summary: "Give a profile or a flat face thickness: make a body, add to one or cut into one.",
    what: [
      "Moves closed profiles of a sketch along the normal of the sketch plane. The arrow in the view can be dragged to set the distance.",
      "A flat face of a body can be extruded as it is, without drawing a sketch first.",
      "Turning the extrusion to the other side (Flipped, or the arrow dragged through the sketch) changes Join to Cut when it now goes into a body, and cuts exactly the bodies it goes into. Turned back out of every body, Cut becomes Join again.",
    ],
    requires: ["A closed profile of a sketch, a text, or a flat face."],
    parameters: [
      { name: "Extent", text: "Distance: by the value below. To: up to a plane, a flat face or a point." },
      { name: "Distance", text: "How far the profile is moved. A negative value goes the other way." },
      { name: "Direction", text: "One Side, Flipped, or Symmetric (half the distance to either side)." },
      {
        name: "To",
        text: "Click a plane, a flat face (parallel to the sketch) or a vertex or sketch point. The length is measured again whenever the target moves; Length shows what it comes to. Dragging the arrow goes back to a distance.",
      },
      OPERATION,
    ],
    limitations: ["Profiles of one sketch per feature.", "Open curves are not profiles."],
    examples: ["Rectangle 100 × 80, Extrude 5.5: a sheet that laser cutting takes as one flat part."],
  },
  "solid.revolve": {
    title: "Revolve",
    summary: "Turn a profile about an axis.",
    what: [
      "Sweeps closed profiles of a sketch around an axis: a line of the same sketch or an origin axis.",
      "A ring around the axis shows the angle: drag its knob (or the ring) to set it. Alt (Option) gives finer steps.",
    ],
    requires: ["A closed profile and an axis that does not cross it."],
    parameters: [{ name: "Angle", text: "360 for a full turn." }, OPERATION],
    limitations: ["The axis must lie in the plane of the sketch."],
  },
  "solid.sweep": {
    title: "Sweep",
    summary: "Move a profile along a path.",
    what: [
      "Carries closed profiles along a path of sketch curves. The profile keeps the angle to the path that it has at the start.",
    ],
    requires: [
      "A closed profile.",
      "A path in another sketch: lines, arcs, circles or splines that join end to end. Clicking one curve picks its whole chain.",
    ],
    parameters: [OPERATION],
    limitations: [
      "No twist and no guide rails.",
      "The path must not branch, and an ellipse cannot be a path.",
      "A path that bends tighter than the profile is wide makes the body cut into itself.",
    ],
  },
  "solid.loft": {
    title: "Loft",
    summary: "A solid through two or more sections.",
    what: ["Joins profiles and flat faces, in the order of the list, by a smooth or a ruled surface."],
    requires: ["At least two sections: closed profiles of different sketches, or flat faces."],
    parameters: [
      { name: "Sections", text: "Click to add; the arrows change the order." },
      { name: "Ruled", text: "Straight lines between neighbouring sections instead of a smooth surface." },
      OPERATION,
    ],
    limitations: ["No guide rails.", "Sections with holes are joined by their outer boundary."],
  },
  "solid.hole": {
    title: "Hole",
    shortcut: "H",
    summary: "Drill holes at sketch points: simple, counterbored or countersunk.",
    what: [
      "One hole at every picked sketch point, at right angles to the sketch plane, into the body.",
      "With Distance, an arrow from the first point shows the depth in the direction of the hole: drag it to set the depth.",
    ],
    requires: ["Sketch points (tool Point) and a body. A sketch on a face drills into the body of that face."],
    parameters: [
      { name: "Type", text: "Simple, Counterbore (a wider flat-bottomed step) or Countersink (a cone)." },
      { name: "Diameter", text: "Diameter of the hole." },
      { name: "Extent", text: "Distance (with a Depth) or Through All." },
      { name: "Flip", text: "Drill the other way." },
    ],
    limitations: ["No threads and no drill point.", "All points of one feature lie in one sketch."],
  },
  "solid.offset-plane": {
    title: "Offset Plane",
    summary: "A construction plane parallel to a plane or flat face, at a distance from it.",
    what: [
      "Makes a plane that can carry sketches and be used wherever a plane is asked for: Create Sketch, Mirror, Split Body, another Offset Plane.",
      "The plane is a feature of the timeline. It follows the face or plane it is measured from, and its offset can be changed at any time.",
      "The plane is shown in the view before it is created, and moves while the offset is typed.",
      "An arrow from the base shows the offset: drag it to set the distance, through the base to the other side if you like.",
    ],
    requires: ["An origin plane, a construction plane or a flat face. One that is selected is used directly."],
    parameters: [
      {
        name: "From",
        text: "The plane or flat face to measure from. XY / XZ / YZ pick an origin plane.",
      },
      {
        name: "Offset",
        text:
          "Distance along the normal of the base: for a face, out of the body. Negative values go " +
          "the other way; 0 lies in the base. " +
          EXPRESSIONS,
      },
    ],
    limitations: [
      "Parallel planes only: no planes at an angle, through three points or tangent to a face.",
      "Curved faces cannot be the base.",
    ],
    examples: [
      "Select the XY plane, Offset Plane, 40: a plane 40 mm above the ground to sketch the top of a loft on.",
      "Edit: double-click the plane in the browser or the timeline, or change Offset in Properties.",
    ],
  },

  // ------------------------------------------------------------ solid: modify
  "solid.fillet": {
    title: "Fillet",
    shortcut: "F",
    summary: "Round edges of a body.",
    what: [
      "Click the edges to round; clicking one again takes it out. All edges get the same radius.",
      "An arrow on the first edge, pointing into the body, shows the radius: drag it to set it.",
    ],
    requires: ["Edges of one body. Edges that are selected when the command starts are taken over."],
    parameters: [{ name: "Radius", text: "Radius of the rounding." }],
    limitations: [
      "One radius per feature, edges of one body per feature.",
      "Fails when the radius does not fit between neighbouring edges.",
      "Fails, instead of leaving a broken body, when the result would not be a closed, valid solid (a tiny radius on an edge where faces meet tangentially can do this).",
    ],
    examples: ["Multi-Select, pick the four vertical edges of a box, Fillet, 5."],
  },
  "solid.chamfer": {
    title: "Chamfer",
    summary: "Bevel edges of a body.",
    what: [
      "Click the edges to bevel; clicking one again takes it out.",
      "An arrow on the first edge, pointing into the body, shows the distance: drag it to set it.",
    ],
    requires: ["Edges of one body. Edges that are selected when the command starts are taken over."],
    parameters: [{ name: "Distance", text: "Width of the bevel on both faces." }],
    limitations: [
      "Equal distances on both sides only.",
      "Fails, instead of leaving a broken body, when the result would not be a closed, valid solid.",
    ],
  },
  "solid.shell": {
    title: "Shell",
    summary: "Hollow a body, leaving walls of one thickness.",
    what: [
      "Click the faces to remove: they become the openings. The other faces become walls.",
      "A flat face with a pocket in it can be opened too: the pocket stays as a cup with walls of the same thickness.",
      "Rounded edges around an opened face stay: they become a rounded rim that curls in at the top of the walls.",
      "An arrow on the first face, pointing into the body, shows the thickness: drag it to set it.",
    ],
    requires: ["A body and at least one face to open."],
    parameters: [{ name: "Thickness", text: "Thickness of the walls, measured inwards." }],
    limitations: [
      "Fails when the thickness is more than the body can take, e.g. at tight inner radii.",
      "A curved opened face, or many free-form faces, can make the offset fail. Shell before Fillet usually works then.",
    ],
  },
  "solid.combine": {
    title: "Combine",
    summary: "Join bodies, cut one from another, or keep what they share.",
    what: [
      "The tool bodies are joined to, cut from or intersected with the target body.",
      "The tool bodies are used up: the Browser lists only the target body, which holds the result. Moving the history marker before Combine brings them back.",
      "The result is checked: when it is not a closed, valid solid, or has a volume the operation cannot give (a join smaller than one of its bodies), Combine reports an error instead of keeping a broken body.",
    ],
    requires: ["A target body and at least one tool body."],
    parameters: [
      { name: "Operation", text: "Join, Cut or Intersect." },
      { name: "Keep tools", text: "Leave the tool bodies in place instead of using them up." },
    ],
    limitations: [
      "The bodies have to belong to one component. Bodies of different components, and component instances, are refused: Combine never moves a body from one component to another.",
    ],
  },
  "solid.move": {
    title: "Move/Copy",
    shortcut: "M",
    summary: "Move or turn bodies, or make moved copies of them.",
    what: [
      "Free Move moves along X, Y and Z and turns about the X, Y and Z axes through the centre of the bodies. Translate only moves, Rotate turns about a picked axis, Point to Point moves from one point to another.",
      "Where the bodies end up is shown translucent in the view, and follows every value you type.",
      "Free Move and Translate show arrows along X (red), Y (green) and Z (blue): drag one to move along it. Free Move also shows a ring about each axis, and Rotate one ring about its axis: drag a ring to turn. The values in the window follow the drag. Alt (Option) while dragging gives finer steps.",
    ],
    requires: ["One or more bodies."],
    parameters: [
      { name: "Type", text: "Free Move, Translate, Rotate or Point to Point." },
      { name: "X, Y, Z", text: "Distances along the world axes (Free Move, Translate)." },
      { name: "X Angle, Y Angle, Z Angle", text: "Degrees, counter-clockwise about the world X, Y and Z axes through the centre of the bodies, applied in that order before the distances (Free Move)." },
      { name: "Axis, Angle", text: "An origin axis, a straight or circular edge or a sketch line; degrees, counter-clockwise (Rotate)." },
      { name: "From, To", text: "Vertices or sketch points (Point to Point)." },
      { name: "Create copy", text: "Leave the bodies where they are and move a copy of each." },
    ],
  },
  "solid.align": {
    title: "Align",
    summary: "Move a body so that a face or a point of it meets another.",
    what: [
      "Face to Face turns and shifts the body until the two flat faces touch. Point to Point shifts it.",
      "The body that moves is the one the first pick lies on.",
    ],
    requires: ["Two flat faces of different bodies, or a vertex and a point."],
    parameters: [{ name: "Flip", text: "Faces look the same way (flush) instead of at each other." }],
    limitations: ["A body cannot be aligned with itself."],
  },
  "solid.split": {
    title: "Split Body",
    summary: "Cut a body in two with a plane.",
    what: [
      "Cuts the body along an origin plane, a construction plane or the plane of a flat face.",
      "The face may belong to the body itself: the top of a step cuts through the part that stands on it. A face on the outside of the body does not cut it, and the split reports an error.",
    ],
    requires: ["A body and a plane that runs through it."],
    parameters: [
      {
        name: "Keep",
        text: "Both halves, or only the one on the positive (normal) or negative side of the plane.",
      },
    ],
    limitations: ["Planes only: no splitting with curved faces or sketches."],
  },

  // ----------------------------------------------------------- solid: pattern
  "solid.rectangular-pattern": {
    title: "Rectangular Pattern",
    summary: "Repeat features or bodies along one or two directions.",
    what: [
      "Features: what the features did is done again at every place. Bodies: every place gets a body of its own.",
      "An arrow along each direction ends at the last instance: drag it to change the spacing.",
    ],
    requires: [
      "Features (click a face they made, or the timeline) or bodies.",
      "A direction: an origin axis, a straight edge or a sketch line.",
    ],
    parameters: [
      { name: "Count", text: "Number of instances, the original included." },
      { name: "Distance", text: "Spacing between neighbours." },
      { name: "Second direction", text: "A second direction with its own count and distance: a grid." },
      { name: "Flip", text: "Go the other way." },
    ],
    limitations: ["Sketches and construction planes cannot be repeated.", "At most 2000 instances."],
  },
  "solid.circular-pattern": {
    title: "Circular Pattern",
    summary: "Repeat features or bodies around an axis.",
    what: [
      "Spreads the instances around an axis: evenly over a full turn, or up to the given angle.",
      "A ring around the axis shows the angle up to the last instance: drag its knob (or the ring) to set it.",
    ],
    requires: [
      "Features or bodies.",
      "An axis: an origin axis, a straight edge, a circular edge (its centre line) or a sketch line.",
    ],
    parameters: [
      { name: "Count", text: "Number of instances, the original included." },
      { name: "Angle", text: "360 spreads evenly around; otherwise the last instance lies at this angle." },
    ],
    limitations: ["Sketches and construction planes cannot be repeated."],
  },
  "solid.mirror": {
    title: "Mirror",
    summary: "Mirror features or bodies across a plane.",
    what: ["Features are applied again on the other side; bodies get a mirrored copy."],
    requires: ["Features or bodies, and a plane: an origin plane, a construction plane or a flat face."],
    examples: ["Model half of a symmetric part, then mirror its features across the middle plane."],
  },

  // ---------------------------------------------------------- insert / manage
  "solid.import-step": {
    title: "Import STEP",
    summary: "Bring a body from a STEP file (.step, .stp) into the design.",
    what: [
      "The file is stored in the project, so the project stays complete by itself. The body can be modified with the solid features.",
    ],
    limitations: ["An imported body has no history of its own: there is nothing to edit in it."],
  },
  "export.model": {
    title: "Export 3D Model",
    summary: "Write the chosen bodies and components to a STEP or STL file.",
    what: [
      "Export → STEP… or STL… opens a window that lists the bodies of the root and, for each component, its bodies. Tick what goes into the file; a component's box ticks all its bodies.",
      "The bodies of a component are written at each of its visible instances, placed where the instance is (in STEP named Instance/Body), or once at the origin, where the definition lies.",
      "It starts with the selection (bodies, components or instances), or, with nothing selected, with everything that is shown. STL writes all solids into one file.",
      "Export → 3MF / STL (parts on the bed) opens the same window for 3D printing: a component gives one copy per instance, or one. The choice is saved as the one of the 3D Print workspace, and the file holds the parts as that workspace lays them out on the bed.",
    ],
    parameters: [
      { name: "Format", text: "STEP (solids, for other CAD) or STL (triangles, for printing)." },
      { name: "Placement", text: "For each component: At its instances, or Once, at the origin." },
    ],
    limitations: ["The STEP file is a flat list of solids, not an assembly structure."],
  },
  "component.new": {
    title: "New Component",
    summary: "Make a component: a definition of a part that can be placed several times.",
    what: [
      "A component is a definition: the sketches, features and bodies of one part. It is placed through instances; every instance shows the same geometry at its own position, and a change to the definition shows in all of them.",
      "With bodies selected, they move into the new component together with the steps they were made with. They may be bodies of the root or of another component: right-click a body (in the view or in the Browser) and choose Create Component. The steps that change them come along, with the sketches and planes those steps use, and bodies a Combine used up. A sketch drawn on a face of another body, a projection or a plane based on a face only refers to that body and ties nothing. When a step changes a body that is not selected as well (an Extrude that joins into two bodies), nothing moves: the message names the step, and its Show button selects the step and shows it in the timeline (double-click it there to edit it). Edit the step so that it changes one body only, or select that body too.",
      "The model stays where it is. Bodies of the root get one instance at the origin; bodies taken out of a component get an instance at every placement of that component, shown or hidden as it was.",
      "New Component (the ribbon, or right-click the document or a component in the Browser) opens a window, as in Fusion: the name, whether the selected bodies go into it, and whether it is activated. An empty, activated component is ready to model in: the sketches and features you make now belong to it. Create Component in the context menu of a body makes one of the selected bodies at once.",
      "The Browser lists the definitions under Components (with their Sketches, Features and Bodies) and the placed instances under Instances.",
      "To give bodies to a component that already exists, drag them in the Browser onto that component (or its Bodies folder); drop them on the document to give them back to the root. Selected bodies are dragged together. What goes along is decided as for New Component. When the two components are placed differently, a Move step is added at the end of the moved history so that the bodies stay where they are seen; with several instances, the first one counts.",
    ],
    when: [
      "For parts that occur more than once (a spacer, a bracket), or to keep the parts of an assembly apart.",
    ],
    requires: ["Nothing, or bodies and features of one component."],
    parameters: [
      { name: "Name", text: "Name of the component; its instances are called Name:1, Name:2 …" },
      { name: "Parent", text: "Always the root: components are not nested." },
      { name: "From selected bodies", text: "Shown when bodies are selected: they move into the new component with the steps that change them." },
      { name: "Activate", text: "Activate the new component, so that what you make next belongs to it." },
    ],
    limitations: [
      "Components are not nested: every component is made at the root.",
      "Dragging in the Browser needs a mouse (or a pen); on a touch screen, Create Component in the context menu of a body makes a new component.",
      "Instances have no parameters of their own: they all show the definition as it is.",
    ],
    examples: [
      "New Component with nothing selected, then Create Sketch and Extrude: the body belongs to the new component. Activate Root, then Create Instance and move the new instance aside.",
    ],
  },
  "component.instance": {
    title: "Create Instance",
    summary: "Place the selected component once more. The new instance refers to the same definition.",
    what: [
      "Adds an instance of the component selected in the Browser (or of the component of the selected instance, or of the active component) and opens Move / Rotate for it.",
      "Instances refer to their definition and copy nothing of it: editing the definition changes every instance. Duplicate in the context menu of an instance does the same at the place of that instance.",
      "Deleting instances leaves the definition under Components, also when no instance is left; Create Instance places it again.",
    ],
    requires: ["A component or an instance selected, or a component active."],
  },
  "component.activate": {
    title: "Activate Component",
    summary: "Edit a component: its sketches, features and bodies, shown alone in its own coordinates.",
    what: [
      "Double-click a component in the Browser, or choose Activate Component in its context menu (or in that of one of its instances). The view shows that component where its definition lies, and what you make belongs to it. The rest of the model (the root bodies and the instances of the other components) is shown faded around it, where it is relative to the component, as in Fusion.",
      "The faded parts can be built on: Create Sketch on one of their flat faces or construction planes starts a sketch of the active component there, and Project picks their edges, faces and vertices. Both follow: when an instance is moved, the sketch on it and its projected edges move along.",
      "Activate Root (the ribbon button, the context menu, or a double-click on the document in the Browser) returns to the whole model: the root bodies and every instance in its place.",
      "With the root active, an instance is selected as a whole. Its faces and edges cannot be picked for a command: activate the component to change it.",
      "The construction planes of a component are shown at its instances while the root is active. Create Sketch on one activates the component and starts the sketch there: a sketch belongs to the component of its plane.",
    ],
    limitations: [
      "Features work inside one component. Combine, Join / Cut targets, Move/Copy and patterns refuse bodies of different components: the dialog says so and OK stays disabled.",
    ],
  },
  "component.move-instance": {
    title: "Move / Rotate Instance",
    shortcut: "M",
    summary: "Place an instance: where its origin goes and how it is turned.",
    what: [
      "Opens from the context menu of an instance, a double-click on it in the Browser, or M with one instance selected. The instance follows the values as they are typed; OK keeps the placement as one step and Cancel puts it back.",
      "Only the instance moves. The definition and its other instances stay where they are.",
    ],
    requires: ["One instance."],
    parameters: [
      { name: "X, Y, Z", text: "Where the origin of the component goes, in world coordinates." },
      { name: "Rotate X, Rotate Y, Rotate Z", text: "Degrees, counter-clockwise about the world X, then Y, then Z axis through the origin of the component." },
    ],
  },
  "solid.parameters": {
    title: "Parameters",
    summary: "Named values that dimensions and features can use.",
    what: [
      "A parameter has a name, an expression and a unit. Use the name wherever a value is asked for; changing the parameter updates everything that uses it.",
      "Expressions may use other parameters, + - * / and functions such as sqrt, sin and max.",
    ],
    examples: ["thickness = 5.5, then Extrude with distance thickness."],
    limitations: ["Parameters must not refer to each other in a circle."],
  },

  // ------------------------------------------------------------- fabrication
  "fabrication.laser": {
    title: "Laser",
    summary: "Turn bodies into flat parts for laser cutting, laid out on sheets.",
    what: [
      "Every body is classified first, and the result is shown as “Detected: …”.",
      "Flat Part: a body that is a profile with the thickness of the material becomes one part with that profile. Holes are kept; nothing is added.",
      "Rectangular Box: a box becomes six panels with tab-and-slot, finger or butt joints, compensated for material thickness.",
      "Paper and card are unfolded instead, with fold lines. The cut edges are joined by glue tabs, or without glue by Tab & Slit: one side has tabs, the other a flap with slits in its fold line. Flap and tabs are folded inwards, so nothing of the joint is seen from outside. The tabs are on the faces that close the model, such as the caps of a prism: fold the flaps of the faces around it inwards, then press the face on, and its tabs go through the slits into the model.",
      "The parts are nested on sheets and exported as SVG or DXF. What is exported is exactly what the sheet view shows.",
    ],
    requires: ["A body, and a material whose thickness matches what is to be made of it."],
    parameters: [
      { name: "Material", text: "Thickness, kerf (width of the cut) and fit (clearance of joints)." },
      {
        name: "Joints",
        text:
          "Board: joint of the cap panels and of the side panels of a box. Paper: Glue or Tab & Slit, " +
          "with the width, depth and spacing of the tabs, the height of the flap, " +
          "and how far the tab locks behind the slit.",
      },
      {
        name: "Double curvature",
        text:
          "Paper only. Stop: a body with a face curved in two directions is not made. Gores: such " +
          "faces are cut into narrow strips, like the gores of a globe. Gores: how many to a full turn (6 to 72).",
      },
      { name: "Sheet", text: "Size, margin and gap between parts." },
    ],
    limitations: [
      "Board: only flat parts and rectangular boxes. Anything else is Unsupported and produces no cut sheet: prisms that are not boxes, pyramids, frustums, roofs, bodies with slanted or curved walls.",
      "A sheet is only a flat part when its thickness is the thickness of the material (within 0.1 mm).",
      "A box must be larger than twice the material thickness in every direction.",
      "Cases with lids, dividers or cut-outs are not generated.",
      "Paper: flat faces, cylinders, cones and the walls of an extruded outline (text, splines) are unfolded. A curved face stays in one piece: it is rolled out as a whole strip, or starts a net of its own. A net that would not fit on the sheet (with room for its tabs) is split. A body with a face curved in two directions (a sphere, a torus, the rounding of a circular edge) is Unsupported: paper bends but does not stretch. With Double curvature set to Gores, such faces are approximated instead.",
      "Gores are an approximation: every strip is flat across its width, so the model shows facets where the body is round. All round faces of the body, cylinders included, get as many facets to a full turn as there are gores (the number may be off by one or two). Every second gore hangs on the other end of the face, or is a part of its own, to leave room for the tabs.",
      "Cut edges that follow each other on a straight line (the short edges of the facets along a curved wall) share one tab, or one row of Tab & Slit tabs. Where the other side bends away, the tab ends and the next begins, so that the tabs can follow the curve. Tab & Slit needs a straight line on both sides; along a curve, glue tabs are used. Tab & Slit: edges too short for a tab get a glue tab instead. Tabs on one side and a flap on the other make the net larger than glue tabs do, so it may need a larger sheet.",
    ],
    examples: [
      "Hexagon, Extrude 5.5, MDF 5.5 mm: one hexagonal part on one sheet.",
      "Cylinder with a rounded edge, Paper 0.2 mm, Double curvature Gores, 12 gores: the wall with six gores standing on it, and the top with six gores around it.",
      "Box, Paper 0.2 mm, Joint Tab & Slit: fold the net and the flaps inwards, then push every tab through its slit until its shoulders catch.",
    ],
  },
  "fabrication.print": {
    title: "3D Print",
    summary: "Orient bodies on the build plate, check them and export a mesh for a slicer.",
    what: [
      "Shows the bodies on the build plate, checks size and overhangs, and exports STL or 3MF.",
      "A body of a component is printed once for each visible instance of the component (the number of instances is the quantity), or once: choose it at the component in the Bodies list. Export → 3MF / STL (parts on the bed) opens a window with the same choice.",
    ],
    requires: ["At least one body."],
    limitations: [
      "FabCAD does not slice: the file goes to a slicer.",
      "A body that is not a closed solid (its surface has gaps) is not printed. The export window marks it and says why; Export → 3D model → STL… writes it without this check, for a slicer that repairs meshes.",
    ],
  },
};

/** The entry of a tool, or what little is known about it when it has none. */
export function helpFor(id: string, fallback?: HelpFallback): HelpEntry {
  const entry = HELP[id];
  if (entry) return entry;
  return {
    title: fallback?.title ?? id,
    summary: fallback?.summary ?? "There is no description of this tool yet.",
    what: [
      ...(fallback?.summary ? [fallback.summary] : []),
      "Detailed help for this tool has not been written yet.",
    ],
  };
}

/** The Japanese text of an entry, shown next to the English; undefined when there is none. */
export const helpJaFor = (id: string): HelpEntry | undefined => HELP_JA[id];

const FALLBACK_JA = "このツールの詳しいヘルプは、まだ書かれていません。";

/** Japanese for the last line of the fallback entry (see `helpFor`). */
export const fallbackJa = (): string => FALLBACK_JA;

export const hasHelp = (id: string): boolean => HELP[id] !== undefined;
