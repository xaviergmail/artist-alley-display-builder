import type { Panel, PanelType } from './model';

export interface UICallbacks {
  onTypeClick(id: string): void;
  onAddCustom(color: string): void;
  onSetTypeColor(id: string, color: string): void;
  onRemoveType(id: string, replacementId: string | null): void;
  onRemoveSelected(): void;
  onTableSelect(len: number): void;
  onDumpState(): Promise<boolean>;
}

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1.2 12H7.2L6 9z"/></svg>';
const BUG_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.1 13.5 22 12l-2.9-1.5.4-2.1-2.2.3L16 6.8l.6-2.5-2.2 1.2L12 3l-2.4 2.5-2.2-1.2.6 2.5-1.3 1.9-2.2-.3.4 2.1L2 12l2.9 1.5-.4 2.1 2.2-.3L8 17.2l-.6 2.5 2.2-1.2L12 21l2.4-2.5 2.2 1.2-.6-2.5 1.3-1.9 2.2.3-.4-2.1ZM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm-2-5a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/></svg>';
const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m6.7 5.3 12 12-1.4 1.4-12-12zM18.7 6.7l-12 12-1.4-1.4 12-12z"/></svg>';

const TABLE_OPTIONS: Array<[number, string]> = [
  [36, '3 ft'],
  [48, '4 ft'],
  [72, '6 ft'],
  [96, '8 ft'],
];
const PALETTE = [
  '#111827', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef',
  '#f43f5e', '#a16207', '#78716c', '#f8fafc',
];

interface CountType extends PanelType {
  count: number;
}

export class UI {
  private typeList: HTMLDivElement;
  private addBtn: HTMLButtonElement;
  private selectedTrash: HTMLButtonElement;
  private dumpBtn: HTMLButtonElement;
  private dumpStatusTimer: number | undefined;
  private tableButtons: Array<{ el: HTMLButtonElement; len: number }> = [];
  private types = new Map<string, PanelType>();
  private colorDialog: HTMLDialogElement;
  private colorDialogTitle: HTMLHeadingElement;
  private colorHex: HTMLInputElement;
  private colorPreview: HTMLSpanElement;
  private colorTarget: string | null | undefined;
  private replacementDialog: HTMLDialogElement;
  private countBar: HTMLDivElement;

  constructor(sidebar: HTMLElement, viewport: HTMLElement, private cbs: UICallbacks) {
    this.typeList = document.createElement('div');
    this.typeList.className = 'type-list';
    sidebar.appendChild(this.typeList);

    this.addBtn = document.createElement('button');
    this.addBtn.className = 'add-btn';
    this.addBtn.textContent = '+ Add color';
    this.addBtn.setAttribute('aria-haspopup', 'dialog');
    this.addBtn.addEventListener('click', () => this.openColorPicker(null, '#e74c3c'));
    sidebar.appendChild(this.addBtn);

    ({ dialog: this.colorDialog, title: this.colorDialogTitle, hex: this.colorHex, preview: this.colorPreview } = this.makeColorDialog());
    this.replacementDialog = this.makeReplacementDialog();

    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    this.dumpBtn = document.createElement('button');
    this.dumpBtn.className = 'dump-state-btn';
    this.dumpBtn.type = 'button';
    this.dumpBtn.title = 'Copy assembly JSON';
    this.dumpBtn.setAttribute('aria-label', 'Copy assembly JSON');
    this.dumpBtn.innerHTML = BUG_SVG;
    this.dumpBtn.addEventListener('click', async () => this.setDumpStatus(await this.cbs.onDumpState()));
    footer.appendChild(this.dumpBtn);
    sidebar.appendChild(footer);

    this.selectedTrash = this.makeOverlayTrash(viewport, () => this.cbs.onRemoveSelected());

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

  private makeColorDialog(): {
    dialog: HTMLDialogElement;
    title: HTMLHeadingElement;
    hex: HTMLInputElement;
    preview: HTMLSpanElement;
  } {
    const dialog = document.createElement('dialog');
    dialog.className = 'picker-dialog';
    const header = document.createElement('header');
    const title = document.createElement('h2');
    const close = document.createElement('button');
    close.className = 'dialog-close';
    close.type = 'button';
    close.title = 'Close color picker';
    close.setAttribute('aria-label', 'Close color picker');
    close.innerHTML = CLOSE_SVG;
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
    hex.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.commitColor(hex.value);
    });
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

  private openColorPicker(typeId: string | null, color: string): void {
    this.colorTarget = typeId;
    this.colorDialogTitle.textContent = typeId === null ? 'Add colored panel' : 'Change panel color';
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
    if (this.colorTarget === null) this.cbs.onAddCustom(color);
    else if (this.colorTarget) this.cbs.onSetTypeColor(this.colorTarget, color);
    this.colorDialog.close();
  }

  private makeOverlayTrash(viewport: HTMLElement, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'overlay-btn';
    btn.innerHTML = TRASH_SVG;
    btn.addEventListener('click', onClick);
    viewport.appendChild(btn);
    return btn;
  }

  private setDumpStatus(copied: boolean): void {
    window.clearTimeout(this.dumpStatusTimer);
    this.dumpBtn.classList.toggle('copied', copied);
    this.dumpBtn.classList.toggle('failed', !copied);
    this.dumpBtn.title = copied ? 'Assembly JSON copied' : 'Could not copy assembly JSON';
    this.dumpStatusTimer = window.setTimeout(() => {
      this.dumpBtn.classList.remove('copied', 'failed');
      this.dumpBtn.title = 'Copy assembly JSON';
    }, 1600);
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
      color.addEventListener('click', () => this.openColorPicker(type.id, type.color));
      entry.appendChild(color);
    }
    if (type.custom) {
      const trash = document.createElement('button');
      trash.className = 'icon-trash';
      trash.type = 'button';
      trash.innerHTML = TRASH_SVG;
      trash.title = 'Remove custom panel type';
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

  updateTypes(types: Map<string, PanelType>, activeId: string): void {
    this.types = new Map(types);
    this.typeList.replaceChildren();
    for (const type of types.values()) this.typeList.appendChild(this.makeTypeEntry(type, type.id === activeId));
  }

  setAssemblyCounts(types: Map<string, PanelType>, panels: Map<string, Panel>, connectorCount: number): void {
    const counts: CountType[] = [...types.values()].map((type) => ({
      ...type,
      count: [...panels.values()].filter((panel) => panel.typeId === type.id).length,
    }));
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
    connectors.innerHTML = `<span class="connector-count-icon">✣</span><strong>${connectorCount}</strong>`;
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
