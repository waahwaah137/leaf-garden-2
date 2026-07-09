// A tiny, transient confirmation toast (e.g. "pinned ✓ · 3"). Non-interactive, auto-fades.

let el: HTMLElement | null = null;
let hideTimer: number | undefined;

function ensure(): HTMLElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  return el;
}

export function showToast(text: string, ms = 1600): void {
  const node = ensure();
  node.textContent = text;
  node.classList.add('show');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => node.classList.remove('show'), ms);
}
