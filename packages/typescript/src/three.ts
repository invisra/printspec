import type {PreviewObject, PreviewScene} from './preview/types.js';

export type ThreeLike = {
  Group: new () => any;
  BoxGeometry: new (width: number, height: number, depth: number) => any;
  CylinderGeometry: new (radiusTop: number, radiusBottom: number, height: number, radialSegments?: number) => any;
  MeshBasicMaterial: new (parameters?: Record<string, unknown>) => any;
  Mesh: new (geometry: any, material: any) => any;
};

function materialFor(object: PreviewObject, THREE: ThreeLike): any {
  const params = object.material === 'body' ? {color: 0x8ab4f8} : object.material === 'hole' ? {color: 0x202124, transparent: true, opacity: 0.45} : object.material === 'warning' ? {color: 0xfbbc04} : {color: 0x9aa0a6, transparent: true, opacity: 0.6};
  return new THREE.MeshBasicMaterial(params);
}

function orientCylinder(mesh: any, axis: 'x' | 'y' | 'z' = 'z'): void {
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
}

function applyTransform(mesh: any, object: PreviewObject): void {
  mesh.position.set(object.positionMm.x, object.positionMm.y, object.positionMm.z);
  if (object.rotationDeg) {
    mesh.rotation.x += ((object.rotationDeg.x ?? 0) * Math.PI) / 180;
    mesh.rotation.y += ((object.rotationDeg.y ?? 0) * Math.PI) / 180;
    mesh.rotation.z += ((object.rotationDeg.z ?? 0) * Math.PI) / 180;
  }
}

export function createThreePreviewObject(scene: PreviewScene, THREE: ThreeLike): any {
  const group = new THREE.Group();
  group.name = scene.label;
  for (const object of scene.objects) {
    let geometry: any;
    if (object.kind === 'box' || object.kind === 'rounded_box' || object.kind === 'slot_marker') geometry = new THREE.BoxGeometry(object.dimensionsMm.x, object.dimensionsMm.y, object.dimensionsMm.z);
    else if (object.kind === 'cylinder' || object.kind === 'hole_marker') geometry = new THREE.CylinderGeometry(object.radiusMm, object.radiusMm, object.depthMm, 48);
    else continue;
    const mesh = new THREE.Mesh(geometry, materialFor(object, THREE));
    if (object.kind === 'cylinder' || object.kind === 'hole_marker') orientCylinder(mesh, object.axis);
    mesh.name = object.id;
    applyTransform(mesh, object);
    group.add(mesh);
  }
  return group;
}
