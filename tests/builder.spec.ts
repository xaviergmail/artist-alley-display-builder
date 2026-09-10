import { expect, test, type Page } from '@playwright/test';

// State seam exposed by the app (read-only): panels, connectors, camera, debug pick.
interface Builder {
  world: {
    panels: Map<string, { plane: string; i: number; j: number; k: number; typeId: string }>;
    connectors: Map<string, { plane: string; sign: number }>;
    types: Map<string, { id: string; custom: boolean }>;
    activeTypeId: string;
    selectedKey: string | null;
    tableLength: number;
    candidates(): Array<{ plane: string; i: number; j: number; k: number }>;
  };
  sceneCtx: {
    camera: { position: { toArray(): number[] } };
    controls: { target: { toArray(): number[] } };
    ghostGroup: { children: unknown[] };
    markerGroup: { children: unknown[] };
    panelGroup: { children: unknown[] };
  };
  debug: {
    info(): { hover: unknown; hoverPanelKey: string | null };
  };
}

async function builder(page: Page): Promise<Builder> {
  return await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder);
}

async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('#viewport canvas').boundingBox();
  if (!box) throw new Error('canvas not found');
  return box;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#viewport canvas');
});

test('sidebar shows the 3 default panel types without remove buttons', async ({ page }) => {
  const ids = await page.locator('.type-btn').evaluateAll((els) => els.map((el) => el.getAttribute('data-type-id')));
  expect(ids).toEqual(['plain', 'grid', 'outline']);
  const trashCount = await page.locator('.type-btn .icon-trash').count();
  expect(trashCount).toBe(0);
});

test('bug export button copies a complete assembly JSON snapshot', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.assemblyJson = text;
        },
      },
    });
  });

  await page.locator('.dump-state-btn').click();
  await expect.poll(() => page.locator('html').getAttribute('data-assembly-json')).not.toBeNull();
  const copied = JSON.parse(await page.locator('html').getAttribute('data-assembly-json')!);

  expect(copied).toMatchObject({
    version: 1,
    tableLength: 72,
    activeTypeId: 'plain',
    selectedKey: null,
  });
  expect(copied.types.map((type: { id: string }) => type.id)).toEqual(['plain', 'grid', 'outline']);
  expect(copied.panels).toEqual([]);
  expect(copied.connectors).toEqual([]);
});

test('hovering the table shows a standing-panel ghost with connectors', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.ghostGroup.children.length)
    )
    .toBeGreaterThan(0);
});

test('clicking the table places the active panel and updates candidates', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(150);

  const panels = await page.evaluate(() => [...(window as unknown as { __builder: Builder }).__builder.world.panels.values()]);
  expect(panels).toHaveLength(1);
  expect(panels[0].plane).toBe('z');
  expect(panels[0].j).toBe(0);
  expect((await builder(page)).world.candidates().length).toBeGreaterThan(0);
});

test('edge-adjacent placement shares corner connectors between panels', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(150);

  const target = await page.evaluate(() => {
    const b = (window as unknown as { __builder: Builder }).__builder;
    return b.world.candidates().find((c) => c.plane === 'z' && c.i === 2 && c.j === 0 && c.k === 0) ?? null;
  });
  expect(target).not.toBeNull();

  const connectors = await page.evaluate(() => [...(window as unknown as { __builder: Builder }).__builder.world.connectors.keys()]);
  // shared corners (2,0,0) and (2,1,0) each host one connector
  expect(connectors).toContain('2,0,0');
  expect(connectors).toContain('2,1,0');
});

test('left click selects a placed panel and shows the center trash', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(150);
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(200);

  expect((await builder(page)).world.selectedKey).toBe('z:1,0,0');
  await expect(page.locator('.overlay-btn.visible')).toHaveCount(1);
});

test('trash overlay removes the selected panel and its connectors', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(150);
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' }); // select
  await page.waitForTimeout(150);

  await page.locator('.overlay-btn.visible').click();
  await page.waitForTimeout(150);
  const b = await builder(page);
  expect(b.world.panels.size).toBe(0);
  expect(b.world.connectors.size).toBe(0);
});

test('clicking a sidebar type re-types the selected panel', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(150);
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' }); // select
  await page.waitForTimeout(100);

  await page.locator('[data-type-id="grid"]').click();
  const panels = await page.evaluate(() => [...(window as unknown as { __builder: Builder }).__builder.world.panels.values()]);
  expect(panels[0].typeId).toBe('grid');
});

test('adding a custom panel type creates a removable sidebar entry', async ({ page }) => {
  await page.locator('#sidebar .add-btn').click();
  await page.locator('.custom-add input[type=color]').fill('#e74c3c');
  await page.locator('.custom-add button').click();

  expect((await builder(page)).world.activeTypeId).toBe('custom-1');
  const customs = await page.locator('.type-btn.custom').count();
  expect(customs).toBe(1);
  // custom type carries a remove button, defaults still do not
  expect(await page.locator('.type-btn.custom .icon-trash').count()).toBe(1);
  expect(await page.locator('.type-btn:not(.custom) .icon-trash').count()).toBe(0);

  await page.locator('.type-btn.custom .icon-trash').click();
  const types = await page.evaluate(() => [...(window as unknown as { __builder: Builder }).__builder.world.types.keys()]);
  expect(types).toEqual(['plain', 'grid', 'outline']);
  expect((await builder(page)).world.activeTypeId).toBe('plain');
});

test('hovering a placed custom panel shows its top-right trash', async ({ page }) => {
  await page.locator('#sidebar .add-btn').click();
  await page.locator('.custom-add button').click();

  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' }); // place custom panel
  await page.waitForTimeout(150);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.waitForTimeout(200);

  const info = await page.evaluate(() => {
    const b = (window as unknown as { __builder: Builder }).__builder;
    const trash = document.querySelector('.overlay-btn.visible');
    return { selected: b.world.selectedKey, hoverTrash: !!trash };
  });
  expect(info.hoverTrash).toBe(true);
});

test('right-drag orbits the camera', async ({ page }) => {
  const before = await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.camera.position.toArray());
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 700, box.y + 400, { steps: 2 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + 820, box.y + 360, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const after = await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.camera.position.toArray());
  expect(after[0]).not.toBeCloseTo(before[0], 3);
  expect(after[2]).not.toBeCloseTo(before[2], 3);
});

test('middle-drag pans the camera target', async ({ page }) => {
  const before = await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.controls.target.toArray());
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 640, box.y + 400, { steps: 2 });
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + 720, box.y + 440, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const after = await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.controls.target.toArray());
  expect(after[0]).not.toBeCloseTo(before[0], 3);
});

test('mouse wheel zooms', async ({ page }) => {
  const before = await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.camera.position.toArray());
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 640, box.y + 400, { steps: 2 });
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  const after = await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.camera.position.toArray());
  const dist = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  expect(dist(after)).toBeLessThan(dist(before));
});

test('ghost is hidden while the camera is being dragged', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.7, { steps: 3 });
  await page.waitForTimeout(150);
  const ghostCount = await page.evaluate(
    () => (window as unknown as { __builder: Builder }).__builder.sceneCtx.ghostGroup.children.length
  );
  expect(ghostCount).toBeGreaterThan(0);

  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 0.55 + 80, box.y + box.height * 0.7 - 30, { steps: 4 });
  expect(
    await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.ghostGroup.children.length)
  ).toBe(0);
  await page.mouse.up({ button: 'right' });
});

test('table size selector changes table length and camera target', async ({ page }) => {
  await page.locator('#table-selector button[data-len="96"]').click();
  const b = await builder(page);
  expect(b.world.tableLength).toBe(96);
  const target = await page.evaluate(() => (window as unknown as { __builder: Builder }).__builder.sceneCtx.controls.target.toArray());
  expect(target[0]).toBe(48); // center of the 8 ft table
  await expect(page.locator('#table-selector button[data-len="96"]')).toHaveClass(/active/);
});

test('perpendicular placement shares a corner and serves both panel planes', async ({ page }) => {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55, { steps: 3 });
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' }); // base panel
  await page.waitForTimeout(150);

  const target = await page.evaluate(() => {
    const b = (window as unknown as { __builder: Builder }).__builder;
    const cand = b.world.candidates().find((c) => c.plane === 'x' && c.i === 2 && c.j === 0 && c.k === 0);
    return cand ?? null;
  });
  expect(target).not.toBeNull();

  const connectors = await page.evaluate(() => [...(window as unknown as { __builder: Builder }).__builder.world.connectors.entries()]);
  expect(connectors.length).toBe(4);
});

test('invalid edge candidate shows a red ghost, rejects its click, and reports diagnostics', async ({ page }) => {
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') diagnostics.push(message.text());
  });

  const result = await page.evaluate(() => {
    const b = (window as unknown as { __builder: any }).__builder;
    const viewport = document.getElementById('viewport')!;
    const canvas = b.sceneCtx.renderer.domElement as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const drive = (wx: number, wy: number, wz: number, click: boolean) => {
      const out = { x: 0, y: 0, visible: false };
      b.sceneCtx.projectToScreen([wx, wy, wz], out, viewport);
      if (!out.visible) return null;
      const opts = { bubbles: true, cancelable: true, clientX: Math.round(out.x + rect.left), clientY: Math.round(out.y + rect.top), button: 0, pointerId: 1 };
      canvas.dispatchEvent(new PointerEvent('pointermove', opts));
      if (click) {
        canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
        canvas.dispatchEvent(new PointerEvent('pointerup', opts));
      }
      return b.debug.info();
    };

    drive(42, 0, 0, true); // table-standing panel
    const preview = drive(42, 0, 0, false); // its bottom edge: j = -1 is illegal
    const materials: string[] = [];
    b.sceneCtx.ghostGroup.traverse((o: { material?: { color: { getHexString(): string } } }) => {
      if (o.material) materials.push(o.material.color.getHexString());
    });
    const before = b.world.panels.size;
    drive(42, 0, 0, true);
    return {
      ghostInvalid: preview?.ghostInvalid,
      materials,
      rejected: b.world.panels.size === before,
      panels: b.world.panels.size,
    };
  });

  expect(result.ghostInvalid).toBe(true);
  expect(result.materials).toContain('ef4444');
  expect(result.rejected).toBe(true);
  await expect.poll(() => diagnostics.length).toBeGreaterThan(0);
  const diagnostic = JSON.parse(diagnostics.find((entry) => entry.includes('rejected-red-ghost-placement'))!);
  expect(diagnostic).toMatchObject({
    event: 'rejected-red-ghost-placement',
    attempted: {
      action: 'place-panel',
      placement: { plane: 'z', i: 3, j: -1, k: 0 },
      panelTypeId: 'plain',
    },
    assembly: { panels: expect.any(Array), connectors: expect.any(Array) },
  });
  expect(diagnostic.assembly.panels).toHaveLength(result.panels);
});

