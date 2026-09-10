import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import panelsUrl from '../assets/Panels.glb?url';
import {
  STEP,
  panelCenter,
  panelKey,
  parsePointKey,
  type Connector,
  type PanelType,
  type Placement,
  type World,
} from './model';
export interface GhostSpec {
  placement: Placement;
  type: PanelType;
  connectors: Map<string, Connector>;
  invalid?: boolean;
}

// Blender-exported panel models (assets/Panels.glb), one per panel kind.
// Geometries are normalized at load: rotated so thickness runs along local z,
interface PanelAsset {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}
let panelAssets: Record<'grid' | 'outline' | 'plain', PanelAsset> | null = null;
// The Connector mesh from the GLB, canonical orientation: plate in XY,
// cross-side structure protruding toward -z, tangential (B*) side toward +z.
let connectorAsset: PanelAsset | null = null;

// Resolves with each kind's primary material hex color (for sidebar swatches),
// or null if the model could not be loaded.
export function loadPanelAssets(): Promise<Record<'grid' | 'outline' | 'plain', string> | null> {
  const { promise, resolve } = Promise.withResolvers<Record<'grid' | 'outline' | 'plain', string> | null>();
  const fail = (err: unknown) => {
    console.error('failed to load Panels.glb, falling back to procedural panels', String(err));
    resolve(null);
  };
  new GLTFLoader().load(
    panelsUrl,
    (gltf) => {
      try {
        const out = {} as Record<'grid' | 'outline' | 'plain', PanelAsset>;
        const colors = {} as Record<'grid' | 'outline' | 'plain', string>;
        for (const kind of ['grid', 'outline', 'plain'] as const) {
          // glTF node names are capitalized; app kind ids are lowercase.
          const node = gltf.scene.getObjectByName(kind[0].toUpperCase() + kind.slice(1));
          if (!node) throw new Error(`Panels.glb: missing mesh "${kind}"`);
          node.updateMatrixWorld(true);
          const rootInv = new THREE.Matrix4().copy(node.matrixWorld).invert();
          // Variant detail lives in child meshes (grid wires, plain bars):
          // merge the whole subtree, keeping per-mesh materials as groups.
          const geos: THREE.BufferGeometry[] = [];
          const mats: THREE.Material[] = [];
          node.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const g = m.geometry.clone();
            g.applyMatrix4(new THREE.Matrix4().copy(m.matrixWorld).premultiply(rootInv));
            geos.push(g);
            mats.push(Array.isArray(m.material) ? m.material[0] : m.material);
          });
          let geo = mergeGeometries(geos, true);
          if (!geo) {
            // Attribute/index mismatch: de-index everything and retry, else
            // settle for the body mesh alone so one odd child can't kill the kind.
            geo = mergeGeometries(geos.map((g) => (g.getIndex() ? g.toNonIndexed() : g)), true)
              ?? mergeGeometries(geos.slice(0, 1).map((g) => (g.getIndex() ? g.toNonIndexed() : g)), true)
              ?? geos[0];
            console.warn(`Panels.glb: degraded merge for "${kind}"`);
          }
          geo.rotateX(Math.PI / 2); // model thickness along Y -> app-canonical Z
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          bb.getSize(size);
          bb.getCenter(center);
          const scale = STEP / Math.max(size.x, size.z);
          geo.translate(-center.x, -center.y, -center.z);
          geo.scale(scale, scale, scale);
          out[kind] = { geometry: geo, materials: mats };
          colors[kind] = '#' + (mats[0] as THREE.MeshStandardMaterial).color.getHexString();
        }
        // Connector hub mesh (no children). Canonicalize like the panels
        // (thickness axis -> app Z is wrong for the hub: keep its own frame):
        // recenter on the hub, scale model units (panel edge = 30) to inches.
        const connNode = gltf.scene.getObjectByName('Connector') as THREE.Mesh | undefined;
        if (connNode) {
          connNode.updateMatrixWorld(true);
          const cgeo = connNode.geometry.clone();
          const cmat = Array.isArray(connNode.material) ? connNode.material[0] : connNode.material;
          cgeo.computeBoundingBox();
          const cbb = cgeo.boundingBox!;
          const ccenter = new THREE.Vector3();
          cbb.getCenter(ccenter);
          cgeo.translate(-ccenter.x, -ccenter.y, -ccenter.z);
          const cscale = STEP / 30;
          connectorAsset = { geometry: cgeo.scale(cscale, cscale, cscale), materials: [cmat] };
        }
        panelAssets = out;
        resolve(colors);
      } catch (err) {
        fail(err);
      }
    },
    undefined,
    fail,
  );
  return promise;
}
const THICK = 0.5;
const GHOST = 0x3b82f6;
const GHOST_BAD = 0xef4444;
const TABLE_DEPTH = 24;
const TABLE_TOP_T = 1.5;
const FLOOR_Y = -30;

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

function ghostMaterial(invalid = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: invalid ? GHOST_BAD : GHOST, transparent: true, opacity: 0.35, depthWrite: false });
}
function hitMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
}

// Panel content in local coords: x/y span [-6, 6], thickness along local z.
function buildPanelContent(type: PanelType, ghost: boolean, invalid = false): THREE.Group {
  const g = new THREE.Group();
  if (ghost) {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(STEP, STEP, THICK), ghostMaterial(invalid)));
  } else {
    const asset = panelAssets?.[type.kind];
    if (asset) {
      // Default types keep their Blender materials verbatim; custom plain
      // types recolor every material group with the picked color.
      const mats = asset.materials.map((m) => (m as THREE.MeshStandardMaterial).clone());
      if (type.custom && type.kind === 'plain') for (const m of mats) m.color.set(type.color);
      g.add(new THREE.Mesh(asset.geometry.clone(), mats));
    } else {
      // Fallback while the model loads (or if it failed): procedural boxes.
      g.add(new THREE.Mesh(
        new THREE.BoxGeometry(STEP, STEP, THICK),
        new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.55, metalness: 0.05 }),
      ));
    }
  }
  // Uniform clickbox for every panel kind, matching the solid panel footprint.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(STEP + 0.4, STEP + 0.4, THICK + 0.9), hitMaterial());
  g.add(hit);
  return g;
}

function placePanel(obj: THREE.Group, p: Placement): void {
  const c = panelCenter(p);
  obj.position.set(c[0], c[1], c[2]);
  if (p.plane === 'x') obj.rotation.y = Math.PI / 2;
  if (p.plane === 'y') obj.rotation.x = -Math.PI / 2;
}

// The GLB connector, canonical orientation: cross-side structure protrudes
// toward -Z, tangential (B*) side toward +Z. Placed orientation rotates the
// canonical cross axis (0,-1,0) onto the connector's cross-panel direction
// (plate normal * sign). All six targets are 90-degree-multiple rotations,
// so the slot pattern stays aligned with the lattice.
const ORIENT_QUATS: Record<string, THREE.Quaternion> = {
  'y1': new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
  'y-1': new THREE.Quaternion(),
  'z1': new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
  'z-1': new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  'x1': new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  'x-1': new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
};

function buildConnector(conn: Connector, corner: [number, number, number], ghost: boolean, invalid = false): THREE.Group {
  const g = new THREE.Group();
  if (connectorAsset) {
    const mat = ghost
      ? new THREE.MeshBasicMaterial({ color: invalid ? GHOST_BAD : GHOST, transparent: true, opacity: 0.45, depthWrite: false })
      : (connectorAsset.materials[0] as THREE.MeshStandardMaterial).clone();
    const mesh = new THREE.Mesh(connectorAsset.geometry.clone(), mat);
    mesh.quaternion.copy(ORIENT_QUATS[`${conn.plane}${conn.sign}`]);
    g.add(mesh);
  } else {
    // Fallback while the model loads: small dark cube at the hub.
    g.add(new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.5, 1.5),
      ghost
        ? new THREE.MeshBasicMaterial({ color: invalid ? GHOST_BAD : GHOST, transparent: true, opacity: 0.45, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.4 }),
    ));
  }
  g.position.set(corner[0] * STEP, corner[1] * STEP, corner[2] * STEP);
  return g;
}

export interface ScreenPos {
  x: number;
  y: number;
  visible: boolean;
}

export class SceneCtx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly tableGroup = new THREE.Group();
  readonly panelGroup = new THREE.Group();
  readonly ghostGroup = new THREE.Group();
  readonly connectorGroup = new THREE.Group();
  tableTop: THREE.Mesh | null = null;
  private tableLength = 72;
  private panelMeshes = new Map<string, THREE.Object3D>();
  private selectionHelper: THREE.Mesh;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xe8edf2);
    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.5, 4000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9);
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(80, 160, 100);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -220;
    dir.shadow.camera.right = 220;
    dir.shadow.camera.top = 220;
    dir.shadow.camera.bottom = -220;
    dir.shadow.camera.far = 600;
    this.scene.add(hemi, dir);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshStandardMaterial({ color: 0xc2ccd4, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = FLOOR_Y;
    ground.receiveShadow = true;
    this.scene.add(ground, this.tableGroup, this.panelGroup, this.connectorGroup, this.ghostGroup);

    this.selectionHelper = new THREE.Mesh(
      new THREE.BoxGeometry(STEP + 1, STEP + 1, THICK + 2),
      new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.selectionHelper.visible = false;
    this.scene.add(this.selectionHelper);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Right button orbits, middle button pans, wheel zooms; left is reserved for editing.
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    } as unknown as typeof this.controls.mouseButtons; // three types omit the null sentinel
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 800;
    this.setTableLength(this.tableLength);
  }

  panelMesh(key: string): THREE.Object3D | undefined {
    return this.panelMeshes.get(key);
  }

  setTableLength(len: number): void {
    this.tableLength = len;
    clearGroup(this.tableGroup);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, TABLE_TOP_T, TABLE_DEPTH), wood);
    top.position.set(len / 2, -TABLE_TOP_T / 2, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    this.tableGroup.add(top);
    this.tableTop = top;
    const legGeom = new THREE.BoxGeometry(2.4, 28.5, 2.4);
    for (const x of [2.5, len - 2.5]) {
      for (const z of [-(TABLE_DEPTH / 2 - 1.6), TABLE_DEPTH / 2 - 1.6]) {
        const leg = new THREE.Mesh(legGeom, wood);
        leg.position.set(x, FLOOR_Y + 28.5 / 2, z);
        leg.castShadow = true;
        this.tableGroup.add(leg);
      }
    }
    this.controls.target.set(len / 2, 12, 0);
    this.camera.position.set(len / 2 + 70, 65, 110);
  }

  rebuild(world: World): void {
    clearGroup(this.panelGroup);
    clearGroup(this.connectorGroup);
    this.panelMeshes.clear();
    for (const panel of world.panels.values()) {
      const type = world.types.get(panel.typeId);
      if (!type) continue;
      const obj = buildPanelContent(type, false);
      placePanel(obj, panel);
      obj.userData.panelKey = panelKey(panel);
      this.panelGroup.add(obj);
      this.panelMeshes.set(panelKey(panel), obj);
    }
    for (const [key, conn] of world.connectors) {
      this.connectorGroup.add(buildConnector(conn, parsePointKey(key), false));
    }
    this.updateSelection(world);
  }

  private updateSelection(world: World): void {
    const mesh = world.selectedKey ? this.panelMeshes.get(world.selectedKey) : undefined;
    if (!mesh) {
      this.selectionHelper.visible = false;
      return;
    }
    this.selectionHelper.visible = true;
    this.selectionHelper.position.copy(mesh.position);
    this.selectionHelper.rotation.copy(mesh.rotation);
  }

  setGhost(ghost: GhostSpec | null): void {
    clearGroup(this.ghostGroup);
    if (!ghost) return;
    const obj = buildPanelContent(ghost.type, true, ghost.invalid === true);
    placePanel(obj, ghost.placement);
    this.ghostGroup.add(obj);
    for (const [key, conn] of ghost.connectors) {
      this.ghostGroup.add(buildConnector(conn, parsePointKey(key), true, ghost.invalid === true));
    }
  }

  projectToScreen(v: [number, number, number], out: ScreenPos, container: HTMLElement): void {
    const vec = new THREE.Vector3(v[0], v[1], v[2]).project(this.camera);
    out.x = (vec.x * 0.5 + 0.5) * container.clientWidth;
    out.y = (-vec.y * 0.5 + 0.5) * container.clientHeight;
    out.visible = vec.z < 1;
  }
}

