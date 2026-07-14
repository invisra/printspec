import type {
  PreviewObject,
  PreviewRoundedBox,
  PreviewScene,
} from "./preview/types.js";

export type ThreeLike = {
  Group: new () => any;
  BoxGeometry: new (width: number, height: number, depth: number) => any;
  CylinderGeometry: new (
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments?: number,
  ) => any;
  Shape: new () => any;
  ExtrudeGeometry: new (shape: any, options?: Record<string, unknown>) => any;
  MeshBasicMaterial: new (parameters?: Record<string, unknown>) => any;
  Mesh: new (geometry: any, material: any) => any;
};

function materialFor(object: PreviewObject, THREE: ThreeLike): any {
  const params =
    object.material === "body"
      ? { color: 0x8ab4f8 }
      : object.material === "hole"
        ? { color: 0x202124, transparent: true, opacity: 0.45 }
        : object.material === "warning"
          ? { color: 0xfbbc04 }
          : { color: 0x9aa0a6, transparent: true, opacity: 0.6 };
  return new THREE.MeshBasicMaterial(params);
}

function orientCylinder(mesh: any, axis: "x" | "y" | "z" = "z"): void {
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
}

function clampRoundedBoxRadius(
  size: { x: number; y: number },
  radius: number,
): number {
  return Math.max(0, Math.min(radius, Math.min(size.x, size.y) / 2));
}

function roundedBoxGeometry(object: PreviewRoundedBox, THREE: ThreeLike): any {
  const { x: width, y: height, z: depth } = object.dimensionsMm;
  const radius = clampRoundedBoxRadius(object.dimensionsMm, object.radiusMm);
  if (radius === 0) return new THREE.BoxGeometry(width, height, depth);

  const x0 = -width / 2;
  const x1 = width / 2;
  const y0 = -height / 2;
  const y1 = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x0 + radius, y0);
  shape.lineTo(x1 - radius, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + radius);
  shape.lineTo(x1, y1 - radius);
  shape.quadraticCurveTo(x1, y1, x1 - radius, y1);
  shape.lineTo(x0 + radius, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - radius);
  shape.lineTo(x0, y0 + radius);
  shape.quadraticCurveTo(x0, y0, x0 + radius, y0);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geometry.translate?.(0, 0, -depth / 2);
  return geometry;
}

function applyTransform(mesh: any, object: PreviewObject): void {
  mesh.position.set(
    object.positionMm.x,
    object.positionMm.y,
    object.positionMm.z,
  );
  if (object.rotationDeg) {
    mesh.rotation.x += ((object.rotationDeg.x ?? 0) * Math.PI) / 180;
    mesh.rotation.y += ((object.rotationDeg.y ?? 0) * Math.PI) / 180;
    mesh.rotation.z += ((object.rotationDeg.z ?? 0) * Math.PI) / 180;
  }
}

export function createThreePreviewObject(
  scene: PreviewScene,
  THREE: ThreeLike,
): any {
  const group = new THREE.Group();
  group.name = scene.label;
  for (const object of scene.objects) {
    let geometry: any;
    if (object.kind === "box" || object.kind === "slot_marker")
      geometry = new THREE.BoxGeometry(
        object.dimensionsMm.x,
        object.dimensionsMm.y,
        object.dimensionsMm.z,
      );
    else if (object.kind === "roundedBox")
      geometry = roundedBoxGeometry(object, THREE);
    else if (object.kind === "cylinder" || object.kind === "hole_marker")
      geometry = new THREE.CylinderGeometry(
        object.radiusMm,
        object.radiusMm,
        object.depthMm,
        48,
      );
    else continue;
    const mesh = new THREE.Mesh(geometry, materialFor(object, THREE));
    if (object.kind === "cylinder" || object.kind === "hole_marker")
      orientCylinder(mesh, object.axis);
    mesh.name = object.id;
    applyTransform(mesh, object);
    group.add(mesh);
  }
  return group;
}
