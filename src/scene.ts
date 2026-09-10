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
}

// Blender-exported panel models (assets/Panels.glb), one per panel kind.
// Geometries are normalized at load: rotated so thickness runs along local z,
interface PanelAsset {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}
let panelAssets: Record<'grid' | 'outline' | 'plain', PanelAsset> | null = null;

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
          const geo = mergeGeometries(geos, true);
          if (!geo) throw new Error(`Panels.glb: could not merge meshes for "${kind}"`);
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

function ghostMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.35, depthWrite: false });
}

function hitMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
}

// Panel content in local coords: x/y span [-6, 6], thickness along local z.
function buildPanelContent(type: PanelType, ghost: boolean): THREE.Group {
  const g = new THREE.Group();
  if (ghost) {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(STEP, STEP, THICK), ghostMaterial()));
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

// Real-world scale: panels are 30 cm squares; the connector is ~32 mm across.
// The whole assembly (plate + ribs) stays inside that envelope.
const CONN = 1.26; // inches
const CONN_T = 0.16;
const RIB_L = 1.1;
const RIB_W = 0.3;
const RIB_T = 0.1;
function buildConnector(conn: Connector, corner: [number, number, number], ghost: boolean): THREE.Group {
  const g = new THREE.Group();
  const mat = ghost ? ghostMaterial() : new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.4 });
  const dims: Record<Connector['plane'], [number, number, number]> = {
    x: [CONN_T, CONN, CONN],
    y: [CONN, CONN_T, CONN],
    z: [CONN, CONN, CONN_T],
  };
  const plate = new THREE.Mesh(new THREE.BoxGeometry(...dims[conn.plane]), mat);
  g.add(plate);
  // Crossed ribs on the perpendicular face (the side perpendicular panels slot into).
  const off = conn.sign * (CONN_T / 2 + RIB_T / 2);
  const make = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  if (conn.plane === 'z') {
    make(RIB_L, RIB_W, RIB_T, 0, 0, off);
    make(RIB_W, RIB_L, RIB_T, 0, 0, off);
  } else if (conn.plane === 'y') {
    make(RIB_L, RIB_T, RIB_W, 0, off, 0);
    make(RIB_W, RIB_T, RIB_L, 0, off, 0);
  } else {
    make(RIB_T, RIB_L, RIB_W, off, 0, 0);
    make(RIB_T, RIB_W, RIB_L, off, 0, 0);
  }
  g.position.set(corner[0] * STEP, corner[1] * STEP, corner[2] * STEP);
  return g;
}

function buildMarker(placement: Placement): THREE.Group {
  const g = new THREE.Group();
  const visual = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 10),
    new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.45, depthWrite: false })
  );
  const hit = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), hitMaterial());
  const c = panelCenter(placement);
  const data = { markerPlacement: placement };
  visual.userData = { ...data };
  hit.userData = { ...data };
  g.add(visual, hit);
  g.position.set(c[0], c[1], c[2]);
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
  readonly markerGroup = new THREE.Group();
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
    this.scene.add(ground, this.tableGroup, this.panelGroup, this.connectorGroup, this.markerGroup, this.ghostGroup);

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

  rebuild(world: World, candidates: Placement[]): void {
    clearGroup(this.panelGroup);
    clearGroup(this.connectorGroup);
    clearGroup(this.markerGroup);
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
    for (const s of candidates) this.markerGroup.add(buildMarker(s));
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
    const obj = buildPanelContent(ghost.type, true);
    placePanel(obj, ghost.placement);
    this.ghostGroup.add(obj);
    for (const [key, conn] of ghost.connectors) {
      this.ghostGroup.add(buildConnector(conn, parsePointKey(key), true));
    }
  }

  projectToScreen(v: [number, number, number], out: ScreenPos, container: HTMLElement): void {
    const vec = new THREE.Vector3(v[0], v[1], v[2]).project(this.camera);
    out.x = (vec.x * 0.5 + 0.5) * container.clientWidth;
    out.y = (-vec.y * 0.5 + 0.5) * container.clientHeight;
    out.visible = vec.z < 1;
  }
}

