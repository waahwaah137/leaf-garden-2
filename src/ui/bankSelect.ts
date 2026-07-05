import { BANKS, bankById } from '../audio/banks';

export interface BankSelectOptions {
  currentId: string;
  onSelect: (id: string) => void;
}

export interface BankSelectHandle {
  el: HTMLElement;
  /** Reflect a selection in the UI without firing onSelect (used by Randomize). */
  setValue(id: string): void;
}

/**
 * Custom DAW-style bank picker: a themed trigger pill that opens a frosted panel of
 * grouped presets, each with a glowing LED on the active one. Replaces the native <select>
 * so it matches the controller aesthetic instead of the OS dropdown.
 */
export function createBankSelect(opts: BankSelectOptions): BankSelectHandle {
  let currentId = opts.currentId;
  let open = false;

  const root = document.createElement('div');
  root.id = 'bank-select';
  root.className = 'bank-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'bank-trigger';
  const label = document.createElement('span');
  label.className = 'bank-trigger-label';
  const chevron = document.createElement('span');
  chevron.className = 'bank-chevron';
  chevron.textContent = '▾';
  trigger.append(label, chevron);

  const panel = document.createElement('div');
  panel.className = 'bank-panel';
  panel.setAttribute('role', 'listbox');

  // Build grouped rows once; keep a map id -> row for cheap active toggling.
  const rows = new Map<string, HTMLElement>();
  const groups = new Map<string, typeof BANKS>();
  for (const b of BANKS) {
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group)!.push(b);
  }
  for (const [group, banks] of groups) {
    const header = document.createElement('div');
    header.className = 'bank-group';
    header.textContent = group;
    panel.appendChild(header);
    for (const b of banks) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'bank-item';
      item.setAttribute('role', 'option');
      item.dataset.id = b.id;
      const name = document.createElement('span');
      name.textContent = b.name;
      const led = document.createElement('span');
      led.className = 'bank-led';
      item.append(name, led);
      item.addEventListener('click', () => {
        select(b.id, true);
        close();
      });
      panel.appendChild(item);
      rows.set(b.id, item);
    }
  }

  root.append(trigger, panel);

  function reflect(): void {
    label.textContent = bankById(currentId).name;
    for (const [id, row] of rows) row.classList.toggle('active', id === currentId);
  }

  function select(id: string, fire: boolean): void {
    currentId = id;
    reflect();
    if (fire) opts.onSelect(id);
  }

  function openPanel(): void {
    open = true;
    root.classList.add('open');
    // Bring the active row into view.
    rows.get(currentId)?.scrollIntoView({ block: 'nearest' });
  }
  function close(): void {
    open = false;
    root.classList.remove('open');
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open) close();
    else openPanel();
  });

  // Close on outside interaction / Escape.
  document.addEventListener('pointerdown', (e) => {
    if (open && !root.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') close();
  });

  reflect();
  return {
    el: root,
    setValue: (id: string) => select(id, false),
  };
}
