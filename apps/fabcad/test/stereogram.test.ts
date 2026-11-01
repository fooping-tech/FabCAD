import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EYE_ANGLE_DEG, panelAt, panelEyes, placeEye } from "../src/viewport/stereogram";
import { renderPanels, SoftwareRenderer } from "../src/viewport/softwareRenderer";

const base = (): THREE.PerspectiveCamera => {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
};

describe("stereogram", () => {
  it("shows each eye on its own side for parallel viewing and swaps them for cross-eyed viewing", () => {
    expect(panelEyes("parallel")).toEqual(["left", "right"]);
    expect(panelEyes("cross")).toEqual(["right", "left"]);
  });

  it("finds the panel under a pixel", () => {
    expect(panelAt(99, 200)).toBe(0);
    expect(panelAt(100, 200)).toBe(1);
  });

  it("turns the eyes about the target, keeping the distance and the point looked at", () => {
    const target = new THREE.Vector3();
    const camera = base();
    const left = camera.clone();
    const right = camera.clone();
    placeEye(left, camera, target, "left");
    placeEye(right, camera, target, "right");
    expect(left.position.x).toBeLessThan(0);
    expect(right.position.x).toBeCloseTo(-left.position.x);
    expect(left.position.length()).toBeCloseTo(100);
    expect(left.position.angleTo(right.position)).toBeCloseTo(THREE.MathUtils.degToRad(EYE_ANGLE_DEG));
    const center = target.clone().project(left);
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);
  });

  it("shows a point nearer than the target further right to the left eye", () => {
    const camera = base();
    const left = camera.clone();
    const right = camera.clone();
    placeEye(left, camera, new THREE.Vector3(), "left");
    placeEye(right, camera, new THREE.Vector3(), "right");
    const near = new THREE.Vector3(0, 0, 20);
    expect(near.clone().project(left).x).toBeGreaterThan(near.clone().project(right).x);
  });

  it("draws one image per panel in the software renderer", () => {
    const placed: number[] = [];
    const context = {
      createImageData: (width: number, height: number) =>
        ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as unknown as ImageData,
      putImageData: (image: ImageData, x: number) => {
        placed.push(x, image.width);
      },
    };
    const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    const renderer = new SoftwareRenderer(canvas);
    renderer.setSize(100, 40);
    renderPanels(renderer, new THREE.Scene(), [base(), base()]);
    expect(placed).toEqual([0, 50, 50, 50]);
    placed.length = 0;
    renderer.render(new THREE.Scene(), base());
    expect(placed).toEqual([0, 100]);
  });
});
