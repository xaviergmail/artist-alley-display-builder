import type { PanelType } from './model';

export interface UICallbacks {
  onTypeClick(id: string): void;
  onAddCustom(color: string): void;
  onRemoveType(id: string): void;
  onRemoveSelected(): void;
  onRemoveHovered(): void;
  onTableSelect(len: number): void;
  onDumpState(): Promise<boolean>;
}

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1.2 12H7.2L6 9z"/></svg>';

const BUG_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.1 13.5 22 12l-2.9-1.5.4-2.1-2.2.3L16 6.8l.6-2.5-2.2 1.2L12 3l-2.4 2.5-2.2-1.2.6 2.5-1.3 1.9-2.2-.3.4 2.1L2 12l2.9 1.5-.4 2.1 2.2-.3L8 17.2l-.6 2.5 2.2-1.2L12 21l2.4-2.5 2.2 1.2-.6-2.5 1.3-1.9 2.2.3-.4-2.1ZM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm-2-5a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/></svg>';

const TABLE_OPTIONS: Array<[number, string]> = [
  [36, '3 ft'],
  [48, '4 ft'],
  [72, '6 ft'],
  [108, '9 ft'],
];

export class UI {
  private typeList: HTMLDivElement;
  private addBtn: HTMLButtonElement;
  private customAdd: HTMLDivElement;
  private colorInput: HTMLInputElement;
  private selectedTrash: HTMLButtonElement;
  private hoveredTrash: HTMLButtonElement;
  private dumpBtn: HTMLButtonElement;
  private dumpStatusTimer: number | undefined;
  private tableButtons: Array<{ el: HTMLButtonElement; len: number }> = [];

  constructor(sidebar: HTMLElement, viewport: HTMLElement, private cbs: UICallbacks) {
    this.typeList = document.createElement('div');
    this.typeList.style.display = 'flex';
    this.typeList.style.flexDirection = 'column';
    this.typeList.style.alignItems = 'center';
    this.typeList.style.gap = '10px';
    sidebar.appendChild(this.typeList);

    this.addBtn = document.createElement('button');
    this.addBtn.className = 'add-btn';
    this.addBtn.textContent = '+ Add panel';
    this.addBtn.addEventListener('click', () => this.customAdd.classList.toggle('hidden'));
    sidebar.appendChild(this.addBtn);

    this.customAdd = document.createElement('div');
    this.customAdd.className = 'custom-add hidden';
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color';
    this.colorInput.value = '#e74c3c';
    const confirm = document.createElement('button');
    confirm.className = 'add-btn';
    confirm.textContent = 'Add';
    confirm.addEventListener('click', () => {
      this.cbs.onAddCustom(this.colorInput.value);
      this.customAdd.classList.add('hidden');
    });
    this.customAdd.append(this.colorInput, confirm);
    sidebar.appendChild(this.customAdd);

    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    this.dumpBtn = document.createElement('button');
    this.dumpBtn.className = 'dump-state-btn';
    this.dumpBtn.type = 'button';
    this.dumpBtn.title = 'Copy assembly JSON';
    this.dumpBtn.setAttribute('aria-label', 'Copy assembly JSON');
    this.dumpBtn.innerHTML = BUG_SVG;
    this.dumpBtn.addEventListener('click', async () => {
      const copied = await this.cbs.onDumpState();
      this.setDumpStatus(copied);
    });
    footer.appendChild(this.dumpBtn);
    sidebar.appendChild(footer);

    this.selectedTrash = this.makeOverlayTrash(viewport, () => this.cbs.onRemoveSelected());
    this.hoveredTrash = this.makeOverlayTrash(viewport, () => this.cbs.onRemoveHovered());

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

  private makeTypeButton(type: PanelType, active: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `type-btn${type.custom ? ' custom' : ''}${active ? ' active' : ''}`;
    btn.dataset.typeId = type.id;
    const icon = document.createElement('span');
    icon.className = `icon icon-${type.kind}`;
    icon.style.setProperty('--swatch', type.color);
    btn.appendChild(icon);
    if (type.custom) {
      const trash = document.createElement('button');
      trash.className = 'icon-trash';
      trash.innerHTML = TRASH_SVG;
      trash.title = 'Remove custom panel type';
      trash.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cbs.onRemoveType(type.id);
      });
      btn.appendChild(trash);
    }
    btn.addEventListener('click', () => this.cbs.onTypeClick(type.id));
    return btn;
  }

  updateTypes(types: Map<string, PanelType>, activeId: string): void {
    this.typeList.replaceChildren();
    for (const type of types.values()) {
      this.typeList.appendChild(this.makeTypeButton(type, type.id === activeId));
    }
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

  setHoveredTrash(pos: { x: number; y: number; visible: boolean }): void {
    this.hoveredTrash.classList.toggle('visible', pos.visible);
    if (pos.visible) {
      this.hoveredTrash.style.left = `${pos.x}px`;
      this.hoveredTrash.style.top = `${pos.y}px`;
    }
  }
}
