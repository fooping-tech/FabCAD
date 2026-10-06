import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SoftwareRenderer } from "../src/viewport/softwareRenderer";

/** A canvas with just the part of the 2D context the renderer uses. */
function fakeCanvas(): { canvas: HTMLCanvasElement; pixel: (x: number, y: number) => number[] } {
  let image: ImageData | null = null;
  const context = {
    createImageData: (width: number, height: number) =>
      ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as unknown as ImageData,
    putImageData: (data: ImageData) => {
      image = data;
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const pixel = (x: number, y: number): number[] => {
    const i = (y * image!.width + x) * 4;
    return [...image!.data.slice(i, i + 3)];
  };
  return { canvas, pixel };
}

/** A 20 mm cube at the origin seen from +Z, orthographic, 100 × 100 px for 100 mm. */
function setUp(): { scene: THREE.Scene; camera: THREE.OrthographicCamera } {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0xff0000 })));
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { scene, camera };
}

describe("software renderer", () => {
  it("fills faces with their colour and leaves the rest in the clear colour", () => {
    const { canvas, pixel } = fakeCanvas();
    const renderer = new SoftwareRenderer(canvas);
    renderer.setSize(100, 100);
    renderer.setClearColor(0xffffff);
    const { scene, camera } = setUp();
    renderer.render(scene, camera);
    expect(pixel(50, 50)).toEqual([255, 0, 0]);
    expect(pixel(5, 5)).toEqual([255, 255, 255]);
  });

  it("hides lines behind faces and draws lines on them", () => {
    const { canvas, pixel } = fakeCanvas();
    const renderer = new SoftwareRenderer(canvas);
    renderer.setSize(100, 100);
    const { scene, camera } = setUp();
    const line = (z: number, color: number): THREE.Line =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-30, -0.5 + z / 100, z), new THREE.Vector3(30, -0.5 + z / 100, z)]),
        new THREE.LineBasicMaterial({ color }),
      );
    // Behind the cube: only outside it. On its top face (z = 10): drawn over it.
    scene.add(line(-20, 0x0000ff));
    renderer.render(scene, camera);
    expect(pixel(50, 50)).toEqual([255, 0, 0]);
    expect(pixel(25, 50)).toEqual([0, 0, 255]);
    scene.add(line(10, 0x00ff00));
    renderer.render(scene, camera);
    expect(pixel(50, 50)).toEqual([0, 255, 0]);
  });

  it("blends transparent faces over what is behind them", () => {
    const { canvas, pixel } = fakeCanvas();
    const renderer = new SoftwareRenderer(canvas);
    renderer.setSize(100, 100);
    renderer.setClearColor(0x000000);
    const { scene, camera } = setUp();
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    glass.position.z = 50;
    scene.add(glass);
    renderer.render(scene, camera);
    expect(pixel(50, 50)).toEqual([255, 128, 128]);
    expect(pixel(5, 5)).toEqual([128, 128, 128]);
  });
});
