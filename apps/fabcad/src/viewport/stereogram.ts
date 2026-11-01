import * as THREE from "three";
import type { Stereogram } from "../app/appState";

/**
 * Stereogram view: two images side by side, seen from two eyes, that merge into one image in
 * depth. `parallel`: each eye looks at its own side, as if looking far away. `cross`: the eyes
 * cross, so the images change sides.
 */
export type Eye = "left" | "right";

/**
 * The angle between the eyes, seen from the point they look at. What is at that point sits on
 * the screen; a model that fills a panel gets a parallax of about 7 % of the panel, which is
 * comfortable to merge.
 */
export const EYE_ANGLE_DEG = 4;

/** The eye shown in the left and the right panel. */
export const panelEyes = (mode: Stereogram): [Eye, Eye] =>
  mode === "cross" ? ["right", "left"] : ["left", "right"];

/** The panel under the pixel column `x` of a view `width` wide. */
export const panelAt = (x: number, width: number): 0 | 1 => (x < width / 2 ? 0 : 1);

/**
 * Put `eye` where `side` sees `target` from: `base` turned about the target, around its own up
 * direction. Turning works for perspective and orthographic cameras alike.
 */
export const placeEye = (eye: THREE.Camera, base: THREE.Camera, target: THREE.Vector3, side: Eye): void => {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(base.quaternion);
  const half = THREE.MathUtils.degToRad(EYE_ANGLE_DEG / 2);
  const offset = base.position.clone().sub(target).applyAxisAngle(up, side === "left" ? -half : half);
  eye.position.copy(target).add(offset);
  eye.up.copy(up);
  eye.lookAt(target);
  eye.updateMatrixWorld();
};
