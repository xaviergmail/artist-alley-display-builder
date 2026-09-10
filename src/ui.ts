import type { Panel, PanelType } from './model';

export type MaterialTarget = 'metal' | 'connector';

export interface UICallbacks {
  onTypeClick(id: string): void;
  onAddCustom(color: string): void;
  onSetTypeColor(id: string, color: string): void;
  onSetMaterialColor(target: MaterialTarget, color: string): void;
  onRemoveType(id: string, replacementId: string | null): void;
  onRemoveSelected(): void;
  onTableSelect(len: number): void;
  onQuickModeChange(enabled: boolean): void;
  onSave(): boolean;
  onLoad(): boolean;
  onShare(): Promise<boolean>;
  onDumpState(): Promise<boolean>;
}

const TRASH_ICON = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
const BUG_ICON = '<i class="fa-solid fa-bug" aria-hidden="true"></i>';
const CLOSE_ICON = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
const ICON = (name: string) => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;

const TABLE_OPTIONS: Array<[number, string]> = [[36, '3 ft'], [48, '4 ft'], [72, '6 ft'], [96, '8 ft']];
const PALETTE = [
  '#111827', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef',
  '#f43f5e', '#a16207', '#78716c', '#f8fafc',
];
const GITHUB_URL = 'https://github.com/xaviergmail/artist-alley-display-builder';

type ColorTarget =
  | { kind: 'new' }
  | { kind: 'type'; id: string }
  | { kind: 'material'; target: MaterialTarget };

interface CountType extends PanelType { count: number; }

export class UI {
  private typeList: HTMLDivElement;
  private addBtn: HTMLButtonElement;
  private selectedTrash: HTMLButtonElement;
  private dumpBtn: HTMLButtonElement;
  private quickBtn: HTMLButtonElement;
  private materialButtons = new Map<MaterialTarget, HTMLButtonElement>();
  private status: HTMLDivElement;
  private statusTimer: number | undefined;
  private tableButtons: Array<{ el: HTMLButtonElement; len: number }> = [];
  private types = new Map<string, PanelType>();
  private colorDialog: HTMLDialogElement;
  private colorDialogTitle: HTMLHeadingElement;
  private colorHex: HTMLInputElement;
  private colorPreview: HTMLSpanElement;
  private colorTarget: ColorTarget | undefined;
  private replacementDialog: HTMLDialogElement;
  private tutorialDialog: HTMLDialogElement;
  private countBar: HTMLDivElement;

  constructor(sidebar: HTMLElement, viewport: HTMLElement, private cbs: UICallbacks) {
    this.typeList = document.createElement('div');
    this.typeList.className = 'type-list';
    sidebar.appendChild(this.typeList);

    this.addBtn = document.createElement('button');
    this.addBtn.className = 'add-btn';
    this.addBtn.innerHTML = `${ICON('plus')}<span>Add color</span>`;
    this.addBtn.setAttribute('aria-haspopup', 'dialog');
    this.addBtn.addEventListener('click', () => this.openColorPicker({ kind: 'new' }, '#e74c3c', 'Add colored panel'));
    sidebar.appendChild(this.addBtn);

    this.quickBtn = document.createElement('button');
    this.quickBtn.className = 'quick-mode-btn';
    this.quickBtn.type = 'button';
    this.quickBtn.addEventListener('click', () => this.setQuickMode(this.quickBtn.getAttribute('aria-pressed') !== 'true'));
    sidebar.appendChild(this.quickBtn);
    this.setQuickMode(false, false);

    const materials = document.createElement('section');
    materials.className = 'material-controls';
    materials.setAttribute('aria-label', 'Global materials');
    materials.append(
      this.makeMaterialButton('metal', 'Metal'),
      this.makeMaterialButton('connector', 'Connector'),
    );
    sidebar.appendChild(materials);

    ({ dialog: this.colorDialog, title: this.colorDialogTitle, hex: this.colorHex, preview: this.colorPreview } = this.makeColorDialog());
    this.replacementDialog = this.makeReplacementDialog();
    this.tutorialDialog = this.makeTutorialDialog();

    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    const actions = document.createElement('div');
    actions.className = 'assembly-actions';
    actions.append(
      this.makeActionButton('Save', 'floppy-disk', 'Save this assembly in this browser', () => {
        const saved = this.cbs.onSave();
        this.showStatus(saved ? 'Saved in this browser' : 'Could not save assembly', saved ? 'success' : 'error');
      }),
      this.makeActionButton('Load', 'folder-open', 'Load the browser-saved assembly', () => {
        const loaded = this.cbs.onLoad();
        this.showStatus(loaded ? 'Saved assembly restored' : 'No saved assembly found', loaded ? 'success' : 'error');
      }),
      this.makeActionButton('Share', 'share-nodes', 'Copy a shareable assembly URL', async () => {
        const shared = await this.cbs.onShare();
        this.showStatus(shared ? 'Share URL copied' : 'Could not copy share URL', shared ? 'success' : 'error');
      }),
    );
    const github = document.createElement('a');
    github.className = 'sidebar-action github-action';
    github.href = GITHUB_URL;
    github.target = '_blank';
    github.rel = 'noreferrer';
    github.innerHTML = '<i class="fa-brands fa-github" aria-hidden="true"></i>';
    github.setAttribute('aria-label', 'Open the project on GitHub');
    github.title = 'Open the project on GitHub';
    actions.appendChild(github);
    footer.appendChild(actions);

    this.dumpBtn = document.createElement('button');
    this.dumpBtn.className = 'dump-state-btn';
    this.dumpBtn.type = 'button';
    this.dumpBtn.title = 'Copy assembly JSON';
    this.dumpBtn.setAttribute('aria-label', 'Copy assembly JSON');
    this.dumpBtn.innerHTML = BUG_ICON;
    this.dumpBtn.addEventListener('click', async () => this.setDumpStatus(await this.cbs.onDumpState()));
    footer.appendChild(this.dumpBtn);
    sidebar.appendChild(footer);

    this.status = document.createElement('div');
    this.status.className = 'action-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    viewport.appendChild(this.status);

    this.selectedTrash = this.makeOverlayTrash(viewport, () => this.cbs.onRemoveSelected());

    const help = document.createElement('button');
    help.className = 'help-btn';
    help.type = 'button';
    help.innerHTML = '<i class="fa-regular fa-circle-question" aria-hidden="true"></i>';
    help.title = 'Show builder tutorial';
    help.setAttribute('aria-label', 'Show builder tutorial');
    help.addEventListener('click', () => this.tutorialDialog.showModal());
    viewport.appendChild(help);

    const selector = document.createElement('div');
    selector.id = 'table-selector';
    for (const [len, label] of TABLE_OPTIONS) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.dataset.len = String(len);
      btn.addEventListener('click', () => this.cbs.onTableSelect(len));
      selector.appendChild(btn);
      this.tableButtons.push({ el: btn, len });
    }
    viewport.appendChild(selector);

    this.countBar = document.createElement('div');
    this.countBar.id = 'count-bar';
    this.countBar.setAttribute('role', 'status');
    this.countBar.setAttribute('aria-live', 'polite');
    viewport.appendChild(this.countBar);
  }

  private makeActionButton(label: string, icon: string, title: string, action: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'sidebar-action';
    button.type = 'button';
    button.innerHTML = ICON(icon);
    button.setAttribute('aria-label', label);
    button.title = title;
    button.addEventListener('click', () => { void action(); });
    return button;
  }

  private makeMaterialButton(target: MaterialTarget, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'material-color-btn';
    button.type = 'button';
    button.innerHTML = `${ICON(target === 'metal' ? 'screwdriver-wrench' : 'puzzle-piece')}<span>${label}</span>`;
    button.title = `Change global ${label.toLowerCase()} color`;
    button.setAttribute('aria-label', `Change global ${label.toLowerCase()} color`);
    button.addEventListener('click', () => this.openColorPicker({ kind: 'material', target }, button.style.getPropertyValue('--swatch') || '#2f3945', `Change ${label.toLowerCase()} color`));
    this.materialButtons.set(target, button);
    return button;
  }

  private makeColorDialog(): { dialog: HTMLDialogElement; title: HTMLHeadingElement; hex: HTMLInputElement; preview: HTMLSpanElement } {
    const dialog = document.createElement('dialog');
    dialog.className = 'picker-dialog';
    const header = document.createElement('header');
    const title = document.createElement('h2');
    const close = document.createElement('button');
    close.className = 'dialog-close';
    close.type = 'button';
    close.title = 'Close color picker';
    close.setAttribute('aria-label', 'Close color picker');
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);

    const preview = document.createElement('span');
    preview.className = 'color-preview';
    const palette = document.createElement('div');
    palette.className = 'color-palette';
    palette.setAttribute('aria-label', 'Color palette');
    for (const color of PALETTE) {
      const swatch = document.createElement('button');
      swatch.className = 'palette-swatch';
      swatch.type = 'button';
      swatch.style.setProperty('--swatch', color);
      swatch.title = color;
      swatch.setAttribute('aria-label', `Use ${color}`);
      swatch.addEventListener('click', () => this.commitColor(color));
      palette.appendChild(swatch);
    }

    const hexLabel = document.createElement('label');
    hexLabel.className = 'hex-field';
    hexLabel.textContent = 'Hex';
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.maxLength = 7;
    hex.autocomplete = 'off';
    hex.spellcheck = false;
    hex.setAttribute('aria-label', 'Hex color');
    hex.addEventListener('keydown', (event) => { if (event.key === 'Enter') this.commitColor(hex.value); });
    hex.addEventListener('change', () => this.commitColor(hex.value));
    hexLabel.appendChild(hex);
    dialog.append(header, preview, palette, hexLabel);
    dialog.addEventListener('close', () => { this.colorTarget = undefined; });
    document.body.appendChild(dialog);
    return { dialog, title, hex, preview };
  }

  private makeReplacementDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.className = 'replacement-dialog';
    document.body.appendChild(dialog);
    return dialog;
  }

  private makeTutorialDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.className = 'tutorial-dialog';
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'Build your artist alley display';
    const close = document.createElement('button');
    close.className = 'dialog-close';
    close.type = 'button';
    close.title = 'Close tutorial';
    close.setAttribute('aria-label', 'Close tutorial');
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);
    const steps = [
      ['Navigate', 'Drag with one finger or the left mouse button to orbit. Two fingers pan or pinch to zoom; the mouse wheel also zooms.'],
      ['Place panels', 'Normal mode: tap a panel or the table, then tap one of the blue possible-panel previews. Impossible placements are never shown.'],
      ['Quick build', 'Turn on Quick build in the sidebar for the original hover-a-preview, click-to-place workflow.'],
      ['Connectors', 'Connectors are placed and aligned automatically. Free table-edge connectors face inward toward the chair.'],
      ['Panel types', 'Choose a panel type at left, or add any colored plain panel. The Metal and Connector controls set global finishes.'],
      ['Counts', 'The bar at the bottom lists each panel type and the total number of connectors.'],
      ['Save and share', 'Save and Load stay in this browser only. Share copies a URL with the entire assembly state for someone else.'],
      ['Table size', 'Choose 3, 4, 6, or 8 feet from the controls above the table.'],
    ];
    const list = document.createElement('ol');
    for (const [label, text] of steps) {
      const item = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      item.append(strong, text);
      list.appendChild(item);
    }
    dialog.append(header, list);
    document.body.appendChild(dialog);
    return dialog;
  }

  private openColorPicker(target: ColorTarget, color: string, title: string): void {
    this.colorTarget = target;
    this.colorDialogTitle.textContent = title;
    this.colorHex.value = color;
    this.colorHex.removeAttribute('aria-invalid');
    this.colorPreview.style.setProperty('--swatch', color);
    this.colorDialog.showModal();
  }

  private commitColor(raw: string): void {
    const color = raw.trim().replace(/^([^#])/, '#$1').toLowerCase();
    if (!/^#[\da-f]{6}$/.test(color)) {
      this.colorHex.setAttribute('aria-invalid', 'true');
      return;
    }
    if (this.colorTarget?.kind === 'new') this.cbs.onAddCustom(color);
    else if (this.colorTarget?.kind === 'type') this.cbs.onSetTypeColor(this.colorTarget.id, color);
    else if (this.colorTarget?.kind === 'material') this.cbs.onSetMaterialColor(this.colorTarget.target, color);
    this.colorDialog.close();
  }

  private makeOverlayTrash(viewport: HTMLElement, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'overlay-btn';
    btn.innerHTML = TRASH_ICON;
    btn.addEventListener('click', onClick);
    viewport.appendChild(btn);
    return btn;
  }

  private setDumpStatus(copied: boolean): void {
    this.dumpBtn.classList.toggle('copied', copied);
    this.dumpBtn.classList.toggle('failed', !copied);
    this.dumpBtn.title = copied ? 'Assembly JSON copied' : 'Could not copy assembly JSON';
    window.setTimeout(() => {
      this.dumpBtn.classList.remove('copied', 'failed');
      this.dumpBtn.title = 'Copy assembly JSON';
    }, 1600);
  }

  private showStatus(message: string, kind: 'success' | 'error'): void {
    window.clearTimeout(this.statusTimer);
    this.status.textContent = message;
    this.status.className = `action-status visible ${kind}`;
    this.statusTimer = window.setTimeout(() => { this.status.className = 'action-status'; }, 2200);
  }

  private makeTypeEntry(type: PanelType, active: boolean): HTMLDivElement {
    const entry = document.createElement('div');
    entry.className = `type-entry${type.custom ? ' custom' : ''}`;
    const btn = document.createElement('button');
    btn.className = `type-btn${active ? ' active' : ''}`;
    btn.dataset.typeId = type.id;
    const icon = document.createElement('span');
    icon.className = `icon icon-${type.kind}`;
    icon.style.setProperty('--swatch', type.color);
    btn.appendChild(icon);
    btn.addEventListener('click', () => this.cbs.onTypeClick(type.id));
    entry.appendChild(btn);

    if (type.kind === 'plain') {
      const color = document.createElement('button');
      color.className = 'type-color-btn';
      color.type = 'button';
      color.style.setProperty('--swatch', type.color);
      color.title = 'Change panel color';
      color.setAttribute('aria-label', `Change ${type.id} panel color`);
      color.addEventListener('click', () => this.openColorPicker({ kind: 'type', id: type.id }, type.color, 'Change panel color'));
      entry.appendChild(color);
    }
    if (type.custom) {
      const trash = document.createElement('button');
      trash.className = 'icon-trash';
      trash.type = 'button';
      trash.innerHTML = TRASH_ICON;
      trash.title = 'Remove custom panel type';
      trash.setAttribute('aria-label', `Remove ${type.id} panel type`);
      trash.addEventListener('click', () => this.openReplacementDialog(type));
      entry.appendChild(trash);
    }
    return entry;
  }

  private openReplacementDialog(type: PanelType): void {
    const title = document.createElement('h2');
    title.textContent = `Replace ${type.id} panels`;
    const body = document.createElement('p');
    body.textContent = 'Choose a replacement type for panels already in the assembly.';
    const choices = document.createElement('div');
    choices.className = 'replacement-choices';
    for (const replacement of this.types.values()) {
      if (replacement.id === type.id) continue;
      const choice = document.createElement('button');
      choice.className = 'replacement-choice';
      choice.type = 'button';
      const swatch = document.createElement('span');
      swatch.className = `icon icon-${replacement.kind}`;
      swatch.style.setProperty('--swatch', replacement.color);
      const label = document.createElement('span');
      label.textContent = replacement.id;
      choice.append(swatch, label);
      choice.addEventListener('click', () => {
        this.cbs.onRemoveType(type.id, replacement.id);
        this.replacementDialog.close();
      });
      choices.appendChild(choice);
    }
    const discard = document.createElement('button');
    discard.className = 'replacement-discard';
    discard.type = 'button';
    discard.textContent = '× Remove custom panels';
    discard.addEventListener('click', () => {
      this.cbs.onRemoveType(type.id, null);
      this.replacementDialog.close();
    });
    this.replacementDialog.replaceChildren(title, body, choices, discard);
    this.replacementDialog.showModal();
  }

  setQuickMode(enabled: boolean, notify = true): void {
    this.quickBtn.setAttribute('aria-pressed', String(enabled));
    this.quickBtn.innerHTML = `${ICON('bolt')}<span>Quick build: ${enabled ? 'On' : 'Off'}</span>`;
    this.quickBtn.classList.toggle('active', enabled);
    if (notify) this.cbs.onQuickModeChange(enabled);
  }

  updateMaterials(metalColor: string, connectorColor: string): void {
    this.materialButtons.get('metal')?.style.setProperty('--swatch', metalColor);
    this.materialButtons.get('connector')?.style.setProperty('--swatch', connectorColor);
  }

  updateTypes(types: Map<string, PanelType>, activeId: string): void {
    this.types = new Map(types);
    this.typeList.replaceChildren();
    for (const type of types.values()) this.typeList.appendChild(this.makeTypeEntry(type, type.id === activeId));
  }

  setAssemblyCounts(types: Map<string, PanelType>, panels: Map<string, Panel>, connectorCount: number): void {
    const counts: CountType[] = [...types.values()].map((type) => ({ ...type, count: [...panels.values()].filter((panel) => panel.typeId === type.id).length }));
    this.countBar.replaceChildren();
    for (const type of counts) {
      const item = document.createElement('span');
      item.className = 'count-item';
      item.title = `${type.id}: ${type.count} panels`;
      const icon = document.createElement('span');
      icon.className = `count-icon icon icon-${type.kind}`;
      icon.style.setProperty('--swatch', type.color);
      const count = document.createElement('strong');
      count.textContent = String(type.count);
      item.append(icon, count);
      this.countBar.appendChild(item);
    }
    const divider = document.createElement('span');
    divider.className = 'count-divider';
    const connectors = document.createElement('span');
    connectors.className = 'count-item connector-count';
    connectors.title = `Connectors: ${connectorCount}`;
    connectors.innerHTML = `<i class="connector-count-icon fa-solid fa-puzzle-piece" aria-hidden="true"></i><strong>${connectorCount}</strong>`;
    this.countBar.append(divider, connectors);
    this.countBar.setAttribute('aria-label', `${counts.map((type) => `${type.id}: ${type.count}`).join(', ')}; connectors: ${connectorCount}`);
  }

  setTableActive(len: number): void {
    for (const { el, len: l } of this.tableButtons) el.classList.toggle('active', len === l);
  }

  setSelectedTrash(pos: { x: number; y: number; visible: boolean }): void {
    this.selectedTrash.classList.toggle('visible', pos.visible);
    if (pos.visible) {
      this.selectedTrash.style.left = `${pos.x}px`;
      this.selectedTrash.style.top = `${pos.y}px`;
    }
  }
}
