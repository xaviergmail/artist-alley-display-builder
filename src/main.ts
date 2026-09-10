import './style.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import * as THREE from 'three';
import {
  STEP,
  World,
  panelCenter,
  panelCorners,
  panelKey,
  pointKey,
  type AssemblyState,
  type Placement,
} from './model';
import { SceneCtx, loadPanelAssets, connectorAnchors } from './scene';
import { UI } from './ui';

const viewport = document.getElementById('viewport');
const sidebar = document.getElementById('sidebar');
if (!viewport || !sidebar) throw new Error('missing #viewport/#sidebar');
const viewportEl: HTMLElement = viewport;

const SHARE_PARAM = 'assembly';
const SAVE_KEY = 'artist-alley-display-builder:assembly-v1';
const QUICK_MODE_KEY = 'artist-alley-display-builder:quick-mode';

function restoreFromUrl(target: World): boolean {
  const raw = new URL(window.location.href).searchParams.get(SHARE_PARAM);
  if (!raw) return false;
  try {
    return target.restore(JSON.parse(raw) as AssemblyState);
  } catch {
    return false;
  }
}

function syncUrl(target: World): void {
  const url = new URL(window.location.href);
  url.searchParams.set(SHARE_PARAM, JSON.stringify(target.toJSON()));
  history.replaceState(null, '', url);
}

const world = new World();
world.types.set('plain', { id: 'plain', kind: 'plain', color: '#000000', custom: false });
world.types.set('grid', { id: 'grid', kind: 'grid', color: '#000000', custom: false });
world.types.set('outline', { id: 'outline', kind: 'outline', color: '#000000', custom: false });
restoreFromUrl(world);
const sceneCtx = new SceneCtx(viewport);
const canvas = sceneCtx.renderer.domElement;
sceneCtx.setTableLength(world.tableLength);
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

interface PickResult {
  panelKeyHit: string | null;
  tablePoint: THREE.Vector3 | null;
}

function pick(): PickResult {
  sceneCtx.scene.updateMatrixWorld(true);
  const panelHit = firstHit([sceneCtx.panelGroup]);
  const key = panelHit ? userDataValue(panelHit.object, 'panelKey') : undefined;
  if (typeof key === 'string') return { panelKeyHit: key, tablePoint: null };
  const tableHit = sceneCtx.tableTop ? firstHit([sceneCtx.tableTop]) : null;
  if (tableHit) return { panelKeyHit: null, tablePoint: tableHit.point.clone() };
  return { panelKeyHit: null, tablePoint: null };
}

function pickCandidate(): string | null {
  const hit = firstHit([sceneCtx.markerGroup]);
  const key = hit ? userDataValue(hit.object, 'candidateKey') : undefined;
  return typeof key === 'string' ? key : null;
}

type BuildMode = 'normal' | 'quick';

let buildMode: BuildMode = localStorage.getItem(QUICK_MODE_KEY) === 'true' ? 'quick' : 'normal';
let hoverPanelKey: string | null = null;
// Edge-hover placement is retained only by quick build mode.
let edgeHover: { panelKey: string; edge: number } | null = null;
let ghostPlacement: Placement | null = null;
let ghostInvalid = false;
let camDragging = false;
let rightDown: { panelKey: string | null; x: number; y: number } | null = null;
let lastMouse: { x: number; y: number } = { x: 0, y: 0 };
let touchGesture = false;
const activePointers = new Map<number, { x: number; y: number; moved: boolean; type: string }>();
const normalCandidates = new Map<string, Placement>();

const EDGE_ACTIVATE_PX = 45; // start showing the ghost this close to an edge
const EDGE_EXTINGUISH_PX = 130; // ghost gone beyond this distance
const EDGE_SECTOR_DEG = 75; // mouse must sit roughly in a candidate's sector

function cornerWorld(p: Placement, ci: 0 | 1 | 2 | 3): [number, number, number] {
  const { i, j, k, plane } = p;
  const far = ci === 2 || ci === 3;
  const dx = ci === 1 || ci === 3 ? (plane !== 'x' ? 1 : 0) : 0;
  const dy = (plane === 'z' || plane === 'x') && (plane === 'x' ? ci === 1 || ci === 3 : far) ? 1 : 0;
  const dz = far && plane !== 'z' ? 1 : 0;
  return [(i + dx) * STEP, (j + dy) * STEP, (k + dz) * STEP];
}

// The panel's 4 edges as lattice corner pairs.
function panelEdges(p: Placement): Array<[[number, number, number], [number, number, number]]> {
  const c = [0, 1, 2, 3].map((n) => cornerWorld(p, n as 0 | 1 | 2 | 3));
  return [
    [c[0], c[1]],
    [c[0], c[2]],
    [c[1], c[3]],
    [c[2], c[3]],
  ];
}

function projectPx(v: [number, number, number]): { x: number; y: number; visible: boolean } {
  const out = { x: 0, y: 0, visible: false };
  sceneCtx.projectToScreen(v, out, viewportEl);
  return out;
}

// Nearest panel edge to the mouse in screen space.
function nearestEdge(p: Placement, mx: number, my: number): { edge: number; dist: number } | null {
  let best: { edge: number; dist: number } | null = null;
  const edges = panelEdges(p);
  for (let n = 0; n < 4; n++) {
    const a = projectPx(edges[n][0]);
    const b = projectPx(edges[n][1]);
    if (!a.visible || !b.visible) continue;
    const ax = b.x - a.x, ay = b.y - a.y;
    const len2 = ax * ax + ay * ay;
    let t = len2 > 0 ? ((mx - a.x) * ax + (my - a.y) * ay) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = mx - (a.x + t * ax), dy = my - (a.y + t * ay);
    const dist = Math.hypot(dx, dy);
    if (!best || dist < best.dist) best = { edge: n, dist };
  }
  return best;
}

// Squares adjacent to one of the panel's edges: the coplanar continuation
// plus the two perpendicular squares sharing the edge (one per face side).
function edgeNeighbors(p: Placement, edge: number): Placement[] {
  const { plane, i, j, k } = p;
  if (plane === 'z') {
    // edges: 0 bottom (x, y=j), 1 left (y, x=i), 2 right (y, x=i+1), 3 top (x, y=j+1)
    if (edge === 0) return [{ plane: 'z', i, j: j - 1, k }, { plane: 'y', i, j, k: k - 1 }, { plane: 'y', i, j, k }];
    if (edge === 1) return [{ plane: 'z', i: i - 1, j, k }, { plane: 'x', i, j, k: k - 1 }, { plane: 'x', i, j, k }];
    if (edge === 2) return [{ plane: 'z', i: i + 1, j, k }, { plane: 'x', i: i + 1, j, k: k - 1 }, { plane: 'x', i: i + 1, j, k }];
    return [{ plane: 'z', i, j: j + 1, k }, { plane: 'y', i, j: j + 1, k: k - 1 }, { plane: 'y', i, j: j + 1, k }];
  }
  if (plane === 'y') {
    // 0 (x, z=k), 1 (z, x=i), 2 (z, x=i+1), 3 (x, z=k+1)
    if (edge === 0) return [{ plane: 'y', i, j, k: k - 1 }, { plane: 'z', i, j: j - 1, k }, { plane: 'z', i, j, k }];
    if (edge === 1) return [{ plane: 'y', i: i - 1, j, k }, { plane: 'x', i, j: j - 1, k }, { plane: 'x', i, j, k }];
    if (edge === 2) return [{ plane: 'y', i: i + 1, j, k }, { plane: 'x', i: i + 1, j: j - 1, k }, { plane: 'x', i: i + 1, j, k }];
    return [{ plane: 'y', i, j, k: k + 1 }, { plane: 'z', i, j: j - 1, k: k + 1 }, { plane: 'z', i, j, k: k + 1 }];
  }
  // plane 'x': 0 (y, z=k), 1 (z, y=j), 2 (z, y=j+1), 3 (y, z=k+1)
  if (edge === 0) return [{ plane: 'x', i, j, k: k - 1 }, { plane: 'z', i: i - 1, j, k }, { plane: 'z', i, j, k }];
  if (edge === 1) return [{ plane: 'x', i, j: j - 1, k }, { plane: 'y', i: i - 1, j, k }, { plane: 'y', i, j, k }];
  if (edge === 2) return [{ plane: 'x', i, j: j + 1, k }, { plane: 'y', i: i - 1, j: j + 1, k }, { plane: 'y', i, j: j + 1, k }];
  return [{ plane: 'x', i, j, k: k + 1 }, { plane: 'z', i: i - 1, j, k: k + 1 }, { plane: 'z', i, j, k: k + 1 }];
}

function tableCandidate(point: THREE.Vector3): Placement | null {
  const candidate: Placement = {
    plane: 'y',
    i: Math.round(point.x / STEP - 0.5),
    j: 0,
    k: Math.round(point.z / STEP - 0.5),
  };
  return world.canPlace(candidate) ? candidate : null;
}

function clearHover(): void {
  edgeHover = null;
  hoverPanelKey = null;
  ghostPlacement = null;
  ghostInvalid = false;
  sceneCtx.setGhost(null);
}

function clearNormalCandidates(): void {
  normalCandidates.clear();
  sceneCtx.setCandidateGhosts([]);
}

function showNormalCandidates(candidates: Placement[]): void {
  const type = world.types.get(world.activeTypeId);
  clearNormalCandidates();
  if (!type) return;
  for (const candidate of candidates) normalCandidates.set(panelKey(candidate), candidate);
  sceneCtx.setCandidateGhosts([...normalCandidates.values()].map((placement) => ({ placement, type })));
  renderFrame();
}

function candidatesForPanel(panel: Placement): Placement[] {
  const corners = new Set(panelCorners(panel).map(pointKey));
  return world.candidates().filter((candidate) => panelCorners(candidate).some((corner) => corners.has(pointKey(corner))));
}

// Recompute the ghost for the remembered edge: pick the candidate square
// whose screen direction from the edge midpoint best matches the mouse.
function updateEdgeGhost(mx: number, my: number): void {
  ghostPlacement = null;
  ghostInvalid = false;
  sceneCtx.setGhost(null);
  if (!edgeHover) return;
  const panel = world.panel(edgeHover.panelKey);
  if (!panel) {
    edgeHover = null;
    return;
  }
  const edges = panelEdges(panel);
  const e = edges[edgeHover.edge];
  const mid = projectPx([(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2, (e[0][2] + e[1][2]) / 2]);
  if (!mid.visible) return;
  const dist = distanceToSegmentPx(mx, my, e);
  if (dist > EDGE_EXTINGUISH_PX) {
    edgeHover = null;
    return;
  }
  const mdx = mx - mid.x, mdy = my - mid.y;
  const mlen = Math.hypot(mdx, mdy);
  let best: { p: Placement; angle: number } | null = null;
  if (mlen >= 1) {
    for (const cand of edgeNeighbors(panel, edgeHover.edge)) {
      if (world.panel(panelKey(cand))) continue; // occupied: not a candidate
      const c = panelCenter(cand);
      const s = projectPx(c);
      if (!s.visible) continue;
      const cdx = s.x - mid.x, cdy = s.y - mid.y;
      const clen = Math.hypot(cdx, cdy);
      if (clen < 1) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, (mdx * cdx + mdy * cdy) / (mlen * clen))));
      if (!best || angle < best.angle) best = { p: cand, angle };
    }
  }
  if (best && (best.angle * 180) / Math.PI < EDGE_SECTOR_DEG) {
    ghostPlacement = best.p;
  } else if (dist <= EDGE_ACTIVATE_PX) {
    // Right at the edge (or on the panel beside it): the tangential
    // (coplanar continuation) square is the default candidate.
    const coplanar = edgeNeighbors(panel, edgeHover.edge)[0];
    if (!world.panel(panelKey(coplanar))) ghostPlacement = coplanar;
  }
  if (ghostPlacement) {
    ghostInvalid = !world.canPlace(ghostPlacement);
    const type = world.types.get(world.activeTypeId);
    if (type) {
      sceneCtx.setGhost({
        placement: ghostPlacement,
        type,
        connectors: world.orientationsFor(ghostPlacement),
        invalid: ghostInvalid,
      });
    }
  }
}

function distanceToSegmentPx(mx: number, my: number, e: [[number, number, number], [number, number, number]]): number {
  const a = projectPx(e[0]);
  const b = projectPx(e[1]);
  if (!a.visible || !b.visible) return Infinity;
  const ax = b.x - a.x, ay = b.y - a.y;
  const len2 = ax * ax + ay * ay;
  let t = len2 > 0 ? ((mx - a.x) * ax + (my - a.y) * ay) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(mx - (a.x + t * ax), my - (a.y + t * ay));
}

function updateHover(clientX: number, clientY: number): void {
  setNdc(clientX, clientY);
  raycaster.setFromCamera(ndc, sceneCtx.camera);
  const picked = pick();
  // Edge math works in container-relative pixels (same frame as
  // projectToScreen), so convert the page-space mouse once here.
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  hoverPanelKey = picked.panelKeyHit;
  if (picked.panelKeyHit) {
    const panel = world.panel(picked.panelKeyHit);
    const near = panel ? nearestEdge(panel, mx, my) : null;
    if (near && near.dist < EDGE_ACTIVATE_PX) edgeHover = { panelKey: picked.panelKeyHit, edge: near.edge };
    else edgeHover = null;
  } else if (edgeHover) {
    const panel = world.panel(edgeHover.panelKey);
    if (panel) {
      const d = distanceToSegmentPx(mx, my, panelEdges(panel)[edgeHover.edge]);
      if (d > EDGE_EXTINGUISH_PX) edgeHover = null;
    } else edgeHover = null;
  }
  updateEdgeGhost(mx, my);
  if (!ghostPlacement && !edgeHover && picked.tablePoint) {
    const s = tableCandidate(picked.tablePoint);
    if (s) {
      ghostPlacement = s;
      ghostInvalid = false;
      const type = world.types.get(world.activeTypeId);
      if (type) {
        sceneCtx.setGhost({ placement: s, type, connectors: world.orientationsFor(s), invalid: false });
      }
    }
  }
  canvas.style.cursor = ghostPlacement || hoverPanelKey ? 'pointer' : 'default';
  renderFrame();
}

function refresh(): void {
  sceneCtx.rebuild(world);
  ui.updateTypes(world.types, world.activeTypeId);
  ui.updateMaterials(world.metalColor, world.connectorColor);
  ui.setTableActive(world.tableLength);
  ui.setAssemblyCounts(world.types, world.panels, world.connectors.size);
  syncUrl(world);
  renderFrame();
}

function placePanelAt(p: Placement): void {
  if (!world.canPlace(p)) return;
  world.place(p, world.activeTypeId);
  world.selectedKey = null;
  clearNormalCandidates();
  refresh();
  if (buildMode === 'quick') updateHover(lastMouse.x, lastMouse.y);
}

function assemblyJson(): string {
  return JSON.stringify(world.toJSON(), null, 2);
}

function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

async function copyText(text: string, label: string): Promise<boolean> {
  let clipboardError: unknown;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      clipboardError = error;
    }
  }
  if (fallbackCopy(text)) return true;
  console.error(`Could not copy ${label}`, clipboardError);
  return false;
}

function saveAssembly(): boolean {
  try {
    localStorage.setItem(SAVE_KEY, assemblyJson());
    return true;
  } catch (error) {
    console.error('Could not save assembly', error);
    return false;
  }
}

function loadAssembly(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw || !world.restore(JSON.parse(raw) as AssemblyState)) return false;
    sceneCtx.setTableLength(world.tableLength);
    clearHover();
    clearNormalCandidates();
    refresh();
    return true;
  } catch (error) {
    console.error('Could not load saved assembly', error);
    return false;
  }
}

async function copyAssemblyJson(): Promise<boolean> {
  return copyText(assemblyJson(), 'assembly JSON');
}

async function copyShareUrl(): Promise<boolean> {
  syncUrl(world);
  return copyText(window.location.href, 'share URL');
}

function logRejectedGhostClick(placement: Placement): void {
  console.warn(JSON.stringify({
    event: 'rejected-red-ghost-placement',
    attempted: {
      action: 'place-panel',
      placement,
      panelTypeId: world.activeTypeId,
      sourceEdge: edgeHover,
      hoveredPanelKey: hoverPanelKey,
      pointer: lastMouse,
    },
    assembly: world.toJSON(),
  }, null, 2));
}

function handleClick(): void {
  if (ghostPlacement) {
    if (ghostInvalid) logRejectedGhostClick(ghostPlacement);
    else placePanelAt(ghostPlacement);
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

function handleNormalTap(clientX: number, clientY: number): void {
  setNdc(clientX, clientY);
  raycaster.setFromCamera(ndc, sceneCtx.camera);
  const candidate = normalCandidates.get(pickCandidate() ?? '');
  if (candidate) {
    placePanelAt(candidate);
    return;
  }
  const picked = pick();
  if (picked.panelKeyHit) {
    const panel = world.panel(picked.panelKeyHit);
    if (!panel) return;
    world.selectedKey = picked.panelKeyHit;
    refresh();
    showNormalCandidates(candidatesForPanel(panel));
    return;
  }
  if (picked.tablePoint) {
    const candidateOnTable = tableCandidate(picked.tablePoint);
    if (candidateOnTable) {
      world.selectedKey = null;
      refresh();
      showNormalCandidates([candidateOnTable]);
      return;
    }
  }
  if (world.selectedKey) world.selectedKey = null;
  clearNormalCandidates();
  refresh();
}


const ui = new UI(sidebar, viewport, {
  onTypeClick: (id) => {
    world.activeTypeId = id;
    if (world.selectedKey) world.retype(world.selectedKey, id);
    refresh();
    if (buildMode === 'quick') updateHover(lastMouse.x, lastMouse.y);
    else if (normalCandidates.size > 0) showNormalCandidates([...normalCandidates.values()]);
  },
  onAddCustom: (color) => {
    const type = world.addCustomType(color);
    world.activeTypeId = type.id;
    refresh();
  },
  onSetTypeColor: (id, color) => {
    world.setTypeColor(id, color);
    refresh();
  },
  onSetMaterialColor: (target, color) => {
    world.setMaterialColor(target, color);
    refresh();
  },
  onRemoveType: (id, replacementId) => {
    world.removeType(id, replacementId);
    clearNormalCandidates();
    refresh();
  },
  onRemoveSelected: () => {
    if (!world.selectedKey) return;
    world.removePanel(world.selectedKey);
    clearNormalCandidates();
    refresh();
  },
  onTableSelect: (len) => {
    if (world.tableLength === len) return;
    world.tableLength = len;
    sceneCtx.setTableLength(len);
    clearNormalCandidates();
    refresh();
  },
  onQuickModeChange: (enabled) => {
    buildMode = enabled ? 'quick' : 'normal';
    localStorage.setItem(QUICK_MODE_KEY, String(enabled));
    sceneCtx.setPlacementMode(buildMode);
    clearHover();
    clearNormalCandidates();
    renderFrame();
  },
  onSave: () => saveAssembly(),
  onLoad: () => loadAssembly(),
  onShare: () => copyShareUrl(),
  onDumpState: () => copyAssemblyJson(),
});
sceneCtx.setPlacementMode(buildMode);
ui.setQuickMode(buildMode === 'quick', false);

window.addEventListener('popstate', () => {
  if (!restoreFromUrl(world)) return;
  sceneCtx.setTableLength(world.tableLength);
  clearHover();
  clearNormalCandidates();
  refresh();
});

// ---------------------------------------------------------------- events

canvas.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false, type: e.pointerType });
  if (e.pointerType === 'touch' && [...activePointers.values()].filter((pointer) => pointer.type === 'touch').length > 1) touchGesture = true;
  if (e.button === 2) {
    setNdc(e.clientX, e.clientY);
    raycaster.setFromCamera(ndc, sceneCtx.camera);
    rightDown = { panelKey: pick().panelKeyHit, x: e.clientX, y: e.clientY };
    camDragging = true;
    clearHover();
    canvas.style.cursor = 'move';
  } else if (e.button === 1) {
    camDragging = true;
    clearHover();
    canvas.style.cursor = 'move';
  }
});

canvas.addEventListener('pointermove', (e) => {
  lastMouse = { x: e.clientX, y: e.clientY };
  const pointer = activePointers.get(e.pointerId);
  if (pointer) {
    const slop = e.pointerType === 'mouse' ? 5 : 10;
    if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) >= slop) {
      pointer.moved = true;
      clearHover();
    }
    if (pointer.moved) return;
  }
  if (buildMode === 'quick' && e.pointerType === 'mouse' && !camDragging) updateHover(e.clientX, e.clientY);
});

canvas.addEventListener('pointerup', (e) => {
  const pointer = activePointers.get(e.pointerId);
  activePointers.delete(e.pointerId);
  if (e.button === 2) {
    const panelKeyHit = rightDown && Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) < 5 ? rightDown.panelKey : null;
    rightDown = null;
    camDragging = false;
    canvas.style.cursor = 'default';
    if (panelKeyHit) {
      world.removePanel(panelKeyHit);
      clearHover();
      clearNormalCandidates();
      refresh();
    } else if (buildMode === 'quick') {
      updateHover(e.clientX, e.clientY);
    }
  } else if (e.button === 1) {
    camDragging = false;
    canvas.style.cursor = 'default';
    if (buildMode === 'quick') updateHover(e.clientX, e.clientY);
  } else if (e.button === 0 && pointer && !pointer.moved && !camDragging && !touchGesture) {
    if (buildMode === 'quick') handleClick();
    else handleNormalTap(e.clientX, e.clientY);
  }
  if (activePointers.size === 0) {
    camDragging = false;
    touchGesture = false;
  }
});

function cancelPointer(e: PointerEvent): void {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.delete(e.pointerId);
  rightDown = null;
  camDragging = false;
  // A cancellation terminates the current gesture. Only an outstanding
  // companion pointer keeps the multi-touch tap guard alive.
  touchGesture = activePointers.size > 0;
  clearHover();
}
canvas.addEventListener('pointercancel', cancelPointer);
canvas.addEventListener('lostpointercapture', cancelPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Wheel zoom is camera interaction too: drop only the transient quick ghost.
canvas.addEventListener('wheel', () => { clearHover(); renderFrame(); }, { passive: true });

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
sceneCtx.controls.addEventListener('change', () => {
  if (activePointers.size > 0) {
    camDragging = true;
    for (const pointer of activePointers.values()) pointer.moved = true;
    clearHover();
  }
  renderFrame();
});

function debugInfo(): {
  mode: BuildMode;
  hoverPanelKey: string | null;
  edgeHover: unknown;
  ghostPlacement: unknown;
  ghostInvalid: boolean;
  normalCandidateCount: number;
  pickedPanel: string | null;
  hasTablePoint: boolean;
} {
  setNdc(lastMouse.x, lastMouse.y);
  raycaster.setFromCamera(ndc, sceneCtx.camera);
  const picked = pick();
  return {
    mode: buildMode,
    hoverPanelKey,
    edgeHover,
    ghostPlacement,
    ghostInvalid,
    normalCandidateCount: normalCandidates.size,
    pickedPanel: picked.panelKeyHit,
    hasTablePoint: picked.tablePoint !== null,
  };
}


 (window as unknown as Record<string, unknown>).__builder = { world, sceneCtx, debug: { info: debugInfo, raycaster, ndc, setNdc, updateHover, get anchors() { return connectorAnchors; }, get gesture() { return { camDragging, touchGesture, activePointerCount: activePointers.size, normalCandidateCount: normalCandidates.size }; } } };

// Swap procedural fallback panels for the Blender models once loaded. Material
// colors never write back into World: panel-type colors are user state and may
// have been restored from a share URL before this promise settles.
loadPanelAssets().then(() => refresh());
refresh();
