// Lattice model. Units: 1 = 12 inches (one panel). y is up; table top at y = 0.
// A panel is a unit square on an axis-aligned plane named by its normal axis:
//   plane 'x' -> x = i*STEP fixed, varies y (j..j+1) and z (k..k+1)
//   plane 'y' -> horizontal, y = j*STEP fixed, varies x and z
//   plane 'z' -> z = k*STEP fixed, varies x and y
// Connectors live at lattice points. A connector has a plate plane (same naming)
// and a sign along the plate normal: it serves the 4 in-plane squares around the
// point, plus the 4 perpendicular squares that extend along `sign` of the normal.

export type Plane = 'x' | 'y' | 'z';
export const STEP = 12;

export interface PanelType {
  id: string;
  kind: 'plain' | 'grid' | 'outline';
  color: string;
  custom: boolean;
}

export interface Panel {
  id: number;
  plane: Plane;
  i: number;
  j: number;
  k: number;
  typeId: string;
}

export type Placement = Pick<Panel, 'plane' | 'i' | 'j' | 'k'>;
export type Corner = [number, number, number];

export interface Connector {
  plane: Plane;
  sign: 1 | -1;
  // Quarter turns around the connector plate normal. A free, horizontal hub
  // faces the artist chair; attached side panels may pin its authored turn.
  turn?: 0 | 1 | 2 | 3;
}

export interface AssemblyState {
  version: 1;
  tableLength: number;
  activeTypeId: string;
  selectedKey: string | null;
  metalColor?: string;
  connectorColor?: string;
  types: PanelType[];
  panels: Panel[];
  connectors: Array<{ point: Corner; plane: Plane; sign: 1 | -1; turn?: 0 | 1 | 2 | 3 }>;
}

export const panelKey = (p: Placement) => `${p.plane}:${p.i},${p.j},${p.k}`;
export const pointKey = (c: Corner) => `${c[0]},${c[1]},${c[2]}`;

export function parsePointKey(key: string): Corner {
  const [i, j, k] = key.split(',').map(Number);
  return [i, j, k];
}

export function panelCorners(p: Placement): Corner[] {
  const { i, j, k } = p;
  if (p.plane === 'x') return [[i, j, k], [i, j + 1, k], [i, j, k + 1], [i, j + 1, k + 1]];
  if (p.plane === 'y') return [[i, j, k], [i + 1, j, k], [i, j, k + 1], [i + 1, j, k + 1]];
  return [[i, j, k], [i + 1, j, k], [i, j + 1, k], [i + 1, j + 1, k]];
}
// Returns the common boundary segment when two lattice squares share an edge.
// One shared corner is merely a diagonal connection; four means the same square.
export function sharedPanelEdge(a: Placement, b: Placement): [Corner, Corner] | null {
  const bCorners = new Set(panelCorners(b).map(pointKey));
  const shared = panelCorners(a).filter((corner) => bCorners.has(pointKey(corner)));
  return shared.length === 2 ? [shared[0], shared[1]] : null;
}

export function panelCenter(p: Placement): Corner {
  const h = STEP / 2;
  if (p.plane === 'x') return [p.i * STEP, p.j * STEP + h, p.k * STEP + h];
  if (p.plane === 'y') return [p.i * STEP + h, p.j * STEP, p.k * STEP + h];
  return [p.i * STEP + h, p.j * STEP + h, p.k * STEP];
}

// Top-right corner used to anchor the hover-delete button for custom panels.
export function panelMaxCorner(p: Placement): Corner {
  const { i, j, k } = p;
  if (p.plane === 'x') return [i * STEP, (j + 1) * STEP, (k + 1) * STEP];
  if (p.plane === 'y') return [(i + 1) * STEP, j * STEP, (k + 1) * STEP];
  return [(i + 1) * STEP, (j + 1) * STEP, k * STEP];
}

function touchesCorner(p: Placement, c: Corner): boolean {
  const near = (min: number, cv: number) => min === cv || min + 1 === cv;
  if (p.plane === 'x') return p.i === c[0] && near(p.j, c[1]) && near(p.k, c[2]);
  if (p.plane === 'y') return p.j === c[1] && near(p.i, c[0]) && near(p.k, c[2]);
  return p.k === c[2] && near(p.i, c[0]) && near(p.j, c[1]);
}

// Extent direction of a panel from a shared corner along an axis (0=i,1=j,2=k).
function quad(p: Placement, c: Corner, axis: 0 | 1 | 2): 1 | -1 {
  const min = axis === 0 ? p.i : axis === 1 ? p.j : p.k;
  return min === c[axis] ? 1 : -1;
}

export function connectorServes(conn: Connector, p: Placement, c: Corner): boolean {
  if (p.plane === conn.plane) return true; // in-plane: any quadrant
  const axis: 0 | 1 | 2 = conn.plane === 'x' ? 0 : conn.plane === 'y' ? 1 : 2;
  return quad(p, c, axis) === conn.sign;
}

export function validOrientations(panels: Placement[], c: Corner): Connector[] {
  const out: Connector[] = [];
  for (const plane of ['y', 'z', 'x'] as const) {
    for (const sign of [1, -1] as const) {
      const conn: Connector = { plane, sign };
      if (panels.every((p) => connectorServes(conn, p, c))) out.push(conn);
    }
  }
  return out;
}

function sameConn(a: Connector, b: Connector): boolean {
  return a.plane === b.plane && a.sign === b.sign;
}

// The 12 lattice squares that share a corner point.
export function squaresAtCorner(c: Corner): Placement[] {
  const out: Placement[] = [];
  for (const plane of ['x', 'y', 'z'] as const) {
    for (const a of [-1, 0] as const) {
      for (const b of [-1, 0] as const) {
        if (plane === 'x') out.push({ plane, i: c[0], j: c[1] + a, k: c[2] + b });
        else if (plane === 'y') out.push({ plane, i: c[0] + a, j: c[1], k: c[2] + b });
        else out.push({ plane, i: c[0] + a, j: c[1] + b, k: c[2] });
      }
    }
  }
  return out;
}

// A connector is warranted at a corner when panels actually meet there
// (>= 2 panels sharing the point), or when any panel at the corner lies flat
// on the table (y-plane deck): those always carry connectors on all 4 corners.
export function cornerNeedsConnector(panels: Placement[]): boolean {
  if (panels.length >= 2) return true;
  return panels.some((p) => p.plane === 'y' && p.j === 0);
}

// Pick the orientation most likely to work: keep the existing one when it still
// serves everything; else, when any panel at the corner lies face down
// (y-plane), give it a horizontal plate so the connector's flat side faces
// down; otherwise put the plate in the anchor panel's plane (the earliest
// panel at that corner). Prefer ribs pointing up (+) when both signs are valid.
// A loose horizontal connector's distinct face should look toward the chair
// behind the table (-z). The current asset faces +z at turn 0, so turn 2
// reverses it. Side panels take precedence because their mounting direction
// is structural rather than decorative.
function connectorTurn(panels: Placement[], conn: Pick<Connector, 'plane'>): 0 | 1 | 2 | 3 {
  return conn.plane === 'y' && panels.every((panel) => panel.plane === 'y') ? 2 : 0;
}

export function chooseOrientation(panels: Placement[], c: Corner, existing?: Connector): Connector {
  const valid = validOrientations(panels, c);
  if (valid.length === 0) {
    // Invalid placement (ghost preview of an illegal move): pick the orientation
    // serving the most panels so a red preview can still be rendered.
    let best: Pick<Connector, 'plane' | 'sign'> = { plane: panels[0].plane, sign: 1 };
    let bestScore = -1;
    for (const plane of ['x', 'y', 'z'] as const) {
      for (const sign of [1, -1] as const) {
        const conn = { plane, sign };
        const score = panels.filter((p) => connectorServes(conn, p, c)).length;
        if (score > bestScore) {
          bestScore = score;
          best = conn;
        }
      }
    }
    return { ...best, turn: connectorTurn(panels, best) };
  }
  const anchorPlane = panels[0].plane;
  const hasFaceDown = panels.some((p) => p.plane === 'y');
  const chosen =
    // A panel lying face down on the table always gets the connector's flat
    // side facing down, even if that re-orients an existing connector.
    (hasFaceDown ? valid.find((v) => v.plane === 'y' && v.sign === 1) : undefined) ??
    (existing && valid.some((v) => sameConn(v, existing)) ? existing : undefined) ??
    valid.find((v) => v.plane === anchorPlane && v.sign === 1) ??
    valid.find((v) => v.plane === anchorPlane) ??
    valid[0];
  return { ...chosen, turn: connectorTurn(panels, chosen) };
}

export class World {
  panels = new Map<string, Panel>();
  connectors = new Map<string, Connector>();
  types = new Map<string, PanelType>();
  activeTypeId = 'plain';
  selectedKey: string | null = null;
  tableLength = 72; // inches; 6 ft default
  metalColor = '#2f3945';
  connectorColor = '#2b2f33';
  private nextPanelId = 1;
  private nextCustomType = 1;

  panel(key: string): Panel | undefined {
    return this.panels.get(key);
  }

  panelsAt(c: Corner): Placement[] {
    const out: Placement[] = [];
    for (const p of this.panels.values()) {
      if (touchesCorner(p, c)) out.push(p);
    }
    return out;
  }

  canPlace(s: Placement): boolean {
    if (s.j < 0) return false;
    if (this.panels.has(panelKey(s))) return false;
    for (const c of panelCorners(s)) {
      const existing = this.panelsAt(c);
      if (existing.length > 0 && validOrientations([...existing, s], c).length === 0) return false;
    }
    return true;
  }

  // Connector orientation this placement would get at each of its corners.
  orientationsFor(s: Placement): Map<string, Connector> {
    const out = new Map<string, Connector>();
    for (const c of panelCorners(s)) {
      const panels = [...this.panelsAt(c), s];
      out.set(pointKey(c), chooseOrientation(panels, c, this.connectors.get(pointKey(c))));
    }
    return out;
  }

  place(s: Placement, typeId: string): Panel {
    const panel: Panel = { ...s, id: this.nextPanelId++, typeId };
    this.panels.set(panelKey(panel), panel);
    for (const c of panelCorners(panel)) {
      const pk = pointKey(c);
      const here = this.panelsAt(c);
      if (cornerNeedsConnector(here)) {
        this.connectors.set(pk, chooseOrientation(here, c, this.connectors.get(pk)));
      } else {
        this.connectors.delete(pk);
      }
    }
    return panel;
  }

  removePanel(key: string): void {
    const panel = this.panels.get(key);
    if (!panel) return;
    this.panels.delete(key);
    for (const c of panelCorners(panel)) {
      const pk = pointKey(c);
      const remaining = this.panelsAt(c);
      if (remaining.length === 0 || !cornerNeedsConnector(remaining)) this.connectors.delete(pk);
      else this.connectors.set(pk, chooseOrientation(remaining, c, this.connectors.get(pk)));
    }
    if (this.selectedKey === key) this.selectedKey = null;
  }
  retype(key: string, typeId: string): void {
    const panel = this.panels.get(key);
    if (panel) panel.typeId = typeId;
  }

  setTypeColor(id: string, color: string): void {
    const type = this.types.get(id);
    if (type?.kind === 'plain') type.color = color;
  }

  setMaterialColor(target: 'metal' | 'connector', color: string): void {
    if (target === 'metal') this.metalColor = color;
    else this.connectorColor = color;
  }

  addCustomType(color: string): PanelType {
    const t: PanelType = { id: `custom-${this.nextCustomType++}`, kind: 'plain', color, custom: true };
    this.types.set(t.id, t);
    this.activeTypeId = t.id;
    return t;
  }

  removeType(id: string, replacementId: string | null): void {
    if (!this.types.get(id)?.custom) return; // the 3 default types cannot be removed
    if (replacementId && replacementId !== id && this.types.has(replacementId)) {
      for (const panel of this.panels.values()) {
        if (panel.typeId === id) panel.typeId = replacementId;
      }
    } else {
      for (const key of [...this.panels.keys()]) {
        if (this.panels.get(key)!.typeId === id) this.removePanel(key);
      }
    }
    this.types.delete(id);
    if (this.activeTypeId === id) this.activeTypeId = replacementId && this.types.has(replacementId) ? replacementId : 'plain';
  }

  // Stable, plain-data representation for clipboard export and diagnostics.
  // Maps and counters are intentionally omitted: they are implementation state,
  // not part of the assembly someone needs to reproduce.
  toJSON(): AssemblyState {
    return {
      version: 1,
      tableLength: this.tableLength,
      activeTypeId: this.activeTypeId,
      selectedKey: this.selectedKey,
      metalColor: this.metalColor,
      connectorColor: this.connectorColor,
      types: [...this.types.values()].map((type) => ({ ...type })),
      panels: [...this.panels.values()].map((panel) => ({ ...panel })),
      connectors: [...this.connectors.entries()].map(([key, connector]) => ({
        point: parsePointKey(key),
        plane: connector.plane,
        sign: connector.sign,
        turn: connector.turn,
      })),
    };
  }

  // Restore a shared URL snapshot. Connectors are derived from the panel set
  // so a stale or hand-edited connector list cannot corrupt the assembly.
  restore(state: AssemblyState): boolean {
    if (
      state?.version !== 1
      || !Number.isFinite(state.tableLength) || state.tableLength <= 0
      || !Array.isArray(state.types) || !Array.isArray(state.panels)
    ) return false;

    const types = new Map<string, PanelType>();
    for (const type of state.types) {
      if (
        !type || typeof type.id !== 'string' || !['plain', 'grid', 'outline'].includes(type.kind)
        || typeof type.color !== 'string' || typeof type.custom !== 'boolean' || types.has(type.id)
      ) return false;
      types.set(type.id, { ...type });
    }
    if (!types.has('plain') || !types.has('grid') || !types.has('outline')) return false;

    const panels = new Map<string, Panel>();
    let maxPanelId = 0;
    for (const panel of state.panels) {
      if (
        !panel || !['x', 'y', 'z'].includes(panel.plane)
        || !Number.isInteger(panel.i) || !Number.isInteger(panel.j) || !Number.isInteger(panel.k)
        || !Number.isInteger(panel.id) || !types.has(panel.typeId)
      ) return false;
      const key = panelKey(panel);
      if (panels.has(key)) return false;
      panels.set(key, { ...panel });
      maxPanelId = Math.max(maxPanelId, panel.id);
    }

    this.types = types;
    this.panels = panels;
    this.connectors = new Map();
    this.tableLength = state.tableLength;
    this.metalColor = typeof state.metalColor === 'string' ? state.metalColor : '#2f3945';
    this.connectorColor = typeof state.connectorColor === 'string' ? state.connectorColor : '#2b2f33';
    this.activeTypeId = types.has(state.activeTypeId) ? state.activeTypeId : 'plain';
    this.nextPanelId = maxPanelId + 1;
    this.nextCustomType = Math.max(
      1,
      ...[...types.keys()].flatMap((id) => {
        const match = /^custom-(\d+)$/.exec(id);
        return match ? [Number(match[1]) + 1] : [];
      }),
    );

    const corners = new Map<string, Corner>();
    for (const panel of panels.values()) {
      for (const corner of panelCorners(panel)) corners.set(pointKey(corner), corner);
    }
    for (const [key, corner] of corners) {
      const here = this.panelsAt(corner);
      if (cornerNeedsConnector(here)) this.connectors.set(key, chooseOrientation(here, corner));
    }
    return true;
  }

  // All empty squares connectable to some placed panel corner.
  candidates(): Placement[] {
    const seen = new Set<string>();
    const out: Placement[] = [];
    for (const panel of this.panels.values()) {
      for (const c of panelCorners(panel)) {
        for (const s of squaresAtCorner(c)) {
          if (s.j < 0) continue;
          const key = panelKey(s);
          if (seen.has(key) || this.panels.has(key)) continue;
          seen.add(key);
          if (this.canPlace(s)) out.push(s);
        }
      }
    }
    return out;
  }
}
