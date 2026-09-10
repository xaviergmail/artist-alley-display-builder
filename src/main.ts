import './style.css';
import * as THREE from 'three';
import {
  STEP,
  World,
  panelCenter,
  panelKey,
  panelMaxCorner,
  type Placement,
} from './model';
import { SceneCtx } from './scene';
import { UI } from './ui';

const viewport = document.getElementById('viewport');
const sidebar = document.getElementById('sidebar');
if (!viewport || !sidebar) throw new Error('missing #viewport/#sidebar');
const viewportEl: HTMLElement = viewport;

const world = new World();
world.types.set('plain', { id: 'plain', kind: 'plain', color: '#111318', custom: false });
world.types.set('grid', { id: 'grid', kind: 'grid', color: '#b9bec4', custom: false });
world.types.set('outline', { id: 'outline', kind: 'outline', color: '#b9bec4', custom: false });

const sceneCtx = new SceneCtx(viewport);
const canvas = sceneCtx.renderer.domElement;
canvas.style.touchAction = 'none';

// ---------------------------------------------------------------- picking

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function setNdc(clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function firstHit(objects: THREE.Object3D[]): THREE.Intersection | null {
  const hits = raycaster.intersectObjects(objects, true);
  return hits.length > 0 ? hits[0] : null;
}

function userDataValue(o: THREE.Object3D, field: string): unknown {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    const v: unknown = cur.userData[field];
    if (v !== undefined) return v;
    cur = cur.parent;
  }
  return undefined;
}

function readPlacement(v: unknown): Placement | null {
  if (typeof v === 'object' && v !== null && 'plane' in v) return v as Placement;
  return null;
}

interface PickResult {
  marker: Placement | null;
  panelKeyHit: string | null;
  tablePoint: THREE.Vector3 | null;
}

function pick(): PickResult {
  const panelHit = firstHit([sceneCtx.panelGroup]);
  const key = panelHit ? userDataValue(panelHit.object, 'panelKey') : undefined;
  const markerHit = firstHit([sceneCtx.markerGroup]);
  const marker = markerHit ? readPlacement(userDataValue(markerHit.object, 'markerPlacement')) : null;
  // Whatever the camera sees on top wins: a candidate marker in front of a
  // panel is clickable; an occluded one defers to the panel (selection).
  if (marker && (!key || !markerHit || !panelHit || markerHit.distance < panelHit.distance)) {
    return { marker, panelKeyHit: null, tablePoint: null };
  }
  if (typeof key === 'string') return { marker: null, panelKeyHit: key, tablePoint: null };
  const tableHit = sceneCtx.tableTop ? firstHit([sceneCtx.tableTop]) : null;
  if (tableHit) return { marker: null, panelKeyHit: null, tablePoint: tableHit.point.clone() };
  return { marker: null, panelKeyHit: null, tablePoint: null };
}
let hover: { kind: 'candidate' | 'standing'; placement: Placement } | null = null;
let hoverPanelKey: string | null = null;
let camDragging = false;
let downPos: { x: number; y: number } | null = null;
let lastMouse: { x: number; y: number } = { x: 0, y: 0 };

function standingCandidates(point: THREE.Vector3): Placement[] {
  const options: Placement[] = [
    { plane: 'z', i: Math.round(point.x / STEP - 0.5), j: 0, k: Math.round(point.z / STEP) },
    { plane: 'x', i: Math.round(point.x / STEP), j: 0, k: Math.round(point.z / STEP - 0.5) },
  ];
  return options.filter((p) => world.canPlace(p));
}

// Prefer the standing orientation whose face points most toward the camera.
function chooseStanding(options: Placement[]): Placement | null {
  let best: Placement | null = null;
  let bestScore = -Infinity;
  for (const p of options) {
    const c = panelCenter(p);
    const toCam = new THREE.Vector3(
      sceneCtx.camera.position.x - c[0],
      sceneCtx.camera.position.y - c[1],
      sceneCtx.camera.position.z - c[2]
    ).normalize();
    const n = p.plane === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const score = Math.abs(n.dot(toCam));
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function clearHover(): void {
  hover = null;
  hoverPanelKey = null;
  sceneCtx.setGhost(null);
}

function updateGhost(): void {
  if (!hover) {
    sceneCtx.setGhost(null);
    return;
  }
  const type = world.types.get(world.activeTypeId);
  if (!type) return;
  sceneCtx.setGhost({
    placement: hover.placement,
    type,
    connectors: world.orientationsFor(hover.placement),
  });
}

function updateHover(clientX: number, clientY: number): void {
  setNdc(clientX, clientY);
  raycaster.setFromCamera(ndc, sceneCtx.camera);
  const picked = pick();
  hoverPanelKey = null;
  hover = null;
  if (picked.marker) hover = { kind: 'candidate', placement: picked.marker };
  else if (picked.panelKeyHit) hoverPanelKey = picked.panelKeyHit;
  else if (picked.tablePoint) {
    const s = chooseStanding(standingCandidates(picked.tablePoint));
    if (s) hover = { kind: 'standing', placement: s };
  }
  updateGhost();
  canvas.style.cursor = hover || hoverPanelKey ? 'pointer' : 'default';
  renderFrame();
}

// ---------------------------------------------------------------- actions

function refresh(): void {
  sceneCtx.rebuild(world, world.candidates());
  ui.updateTypes(world.types, world.activeTypeId);
  ui.setTableActive(world.tableLength);
  renderFrame();
}

function placePanelAt(p: Placement): void {
  if (!world.canPlace(p)) return;
  world.place(p, world.activeTypeId);
  world.selectedKey = null;
  refresh();
  updateHover(lastMouse.x, lastMouse.y);
}
function handleClick(): void {
  if (hover) {
    placePanelAt(hover.placement);
    return;
  }
  if (hoverPanelKey) {
    world.selectedKey = world.selectedKey === hoverPanelKey ? null : hoverPanelKey;
    refresh();
    return;
  }
  if (world.selectedKey) {
    world.selectedKey = null;
    refresh();
  }
}

const ui = new UI(sidebar, viewport, {
  onTypeClick: (id) => {
    world.activeTypeId = id;
    if (world.selectedKey) world.retype(world.selectedKey, id);
    refresh();
    updateGhost();
  },
  onAddCustom: (color) => {
    world.addCustomType(color);
    refresh();
  },
  onRemoveType: (id) => {
    world.removeType(id);
    refresh();
  },
  onRemoveSelected: () => {
    if (!world.selectedKey) return;
    world.removePanel(world.selectedKey);
    refresh();
  },
  onRemoveHovered: () => {
    if (!hoverPanelKey) return;
    world.removePanel(hoverPanelKey);
    hoverPanelKey = null;
    refresh();
  },
  onTableSelect: (len) => {
    if (world.tableLength === len) return;
    world.tableLength = len;
    sceneCtx.setTableLength(len);
    refresh();
  },
});

// ---------------------------------------------------------------- events

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1 || e.button === 2) {
    camDragging = true;
    clearHover();
    canvas.style.cursor = 'move';
  } else if (e.button === 0) {
    downPos = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener('pointermove', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  if (camDragging) return;
  updateHover(e.clientX, e.clientY);
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button === 1 || e.button === 2) {
    camDragging = false;
    canvas.style.cursor = 'default';
    updateHover(e.clientX, e.clientY);
    return;
  }
  if (e.button === 0 && downPos) {
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved < 5) handleClick();
  }
});

// Wheel zoom is camera interaction too: drop the hover ghost while zooming.
canvas.addEventListener('wheel', () => clearHover(), { passive: true });

window.addEventListener('resize', () => {
  sceneCtx.camera.aspect = viewport.clientWidth / viewport.clientHeight;
  sceneCtx.camera.updateProjectionMatrix();
  sceneCtx.renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderFrame();
});

// ---------------------------------------------------------------- rendering

const screenPos = { x: 0, y: 0, visible: false };

function updateOverlays(): void {
  if (world.selectedKey) {
    const mesh = sceneCtx.panelMesh(world.selectedKey);
    if (mesh) {
      sceneCtx.projectToScreen([mesh.position.x, mesh.position.y, mesh.position.z], screenPos, viewportEl);
      ui.setSelectedTrash(screenPos);
    } else {
      ui.setSelectedTrash({ ...screenPos, visible: false });
    }
  } else {
    ui.setSelectedTrash({ x: 0, y: 0, visible: false });
  }

  const hovered = hoverPanelKey ? world.panel(hoverPanelKey) : undefined;
  const hoveredType = hovered ? world.types.get(hovered.typeId) : undefined;
  if (hovered && hoveredType?.custom && world.selectedKey !== panelKey(hovered)) {
    const c = panelMaxCorner(hovered);
    sceneCtx.projectToScreen(c, screenPos, viewportEl);
    ui.setHoveredTrash(screenPos);
  } else {
    ui.setHoveredTrash({ x: 0, y: 0, visible: false });
  }
}

// Headless/hidden pages never tick requestAnimationFrame, so render on demand:
// camera moves, hover changes, and state edits each trigger an explicit render.
// The guard stops the controls 'change' -> render -> controls.update loop.
let rendering = false;
function renderFrame(): void {
  if (rendering) return;
  rendering = true;
  sceneCtx.controls.update();
  sceneCtx.renderer.render(sceneCtx.scene, sceneCtx.camera);
  updateOverlays();
  rendering = false;
}
sceneCtx.controls.addEventListener('change', renderFrame);

refresh();


function debugInfo(): {
  hover: unknown;
  hoverPanelKey: string | null;
  pickedMarker: unknown;
  pickedPanel: string | null;
  hasTablePoint: boolean;
} {
  setNdc(lastMouse.x, lastMouse.y);
  raycaster.setFromCamera(ndc, sceneCtx.camera);
  const picked = pick();
  return {
    hover,
    hoverPanelKey,
    pickedMarker: picked.marker,
    pickedPanel: picked.panelKeyHit,
    hasTablePoint: picked.tablePoint !== null,
  };
}

 (window as unknown as Record<string, unknown>).__builder = { world, sceneCtx, debug: { info: debugInfo, raycaster, ndc, setNdc } };
