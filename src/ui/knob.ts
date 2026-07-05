// Minimalist DAW-style rotary dial. Drag vertically (or mouse-wheel) to turn; double-tap
// resets to the default. Renders an SVG arc in a palette colour plus a caption and value.

const SWEEP = 270; // degrees of travel
const START = -135; // starting angle (measured from top, clockwise)
const R = 26; // arc radius
const CENTER = 32; // svg is 64x64

export interface KnobOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  default?: number;
  color?: string; // arc colour (defaults to --teal)
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

function polar(angleDeg: number, radius: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(a), CENTER + radius * Math.sin(a)];
}

function arcPath(fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(fromDeg, R);
  const [x2, y2] = polar(toDeg, R);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
}

const SVGNS = 'http://www.w3.org/2000/svg';

export class Knob {
  readonly el: HTMLElement;
  private value: number;
  private readonly opts: Required<Pick<KnobOptions, 'min' | 'max' | 'step'>> & KnobOptions;
  private readonly valueArc: SVGPathElement;
  private readonly pointer: SVGLineElement;
  private readonly readout: HTMLElement;

  constructor(options: KnobOptions) {
    this.opts = { step: (options.max - options.min) / 100, ...options };
    this.value = options.value;

    this.el = document.createElement('div');
    this.el.className = 'knob';

    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.classList.add('knob-svg');

    const track = document.createElementNS(SVGNS, 'path');
    track.setAttribute('d', arcPath(START, START + SWEEP));
    track.setAttribute('class', 'knob-track');

    this.valueArc = document.createElementNS(SVGNS, 'path');
    this.valueArc.setAttribute('class', 'knob-value');
    this.valueArc.setAttribute('stroke', options.color ?? 'var(--teal)');

    this.pointer = document.createElementNS(SVGNS, 'line');
    this.pointer.setAttribute('class', 'knob-pointer');
    this.pointer.setAttribute('stroke', options.color ?? 'var(--teal)');

    svg.append(track, this.valueArc, this.pointer);

    const label = document.createElement('span');
    label.className = 'knob-label';
    label.textContent = options.label;

    this.readout = document.createElement('span');
    this.readout.className = 'knob-readout';

    this.el.append(svg, label, this.readout);
    this.attachInput(svg);
    this.render();
  }

  private frac(): number {
    return (this.value - this.opts.min) / (this.opts.max - this.opts.min);
  }

  private render(): void {
    const angle = START + this.frac() * SWEEP;
    this.valueArc.setAttribute('d', arcPath(START, angle));
    const [px, py] = polar(angle, R - 9);
    const [cx, cy] = polar(angle, R + 1);
    this.pointer.setAttribute('x1', String(px));
    this.pointer.setAttribute('y1', String(py));
    this.pointer.setAttribute('x2', String(cx));
    this.pointer.setAttribute('y2', String(cy));
    const fmt = this.opts.format ?? ((v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)));
    this.readout.textContent = fmt(this.value);
  }

  private quantize(v: number): number {
    const clamped = Math.min(this.opts.max, Math.max(this.opts.min, v));
    const step = this.opts.step;
    return step ? Math.round(clamped / step) * step : clamped;
  }

  setValue(v: number, emit = true): void {
    const q = this.quantize(v);
    if (q === this.value) {
      this.render();
      return;
    }
    this.value = q;
    this.render();
    if (emit) this.opts.onChange(q);
  }

  getValue(): number {
    return this.value;
  }

  private attachInput(svg: SVGSVGElement): void {
    let startY = 0;
    let startVal = 0;
    let dragging = false;

    const range = this.opts.max - this.opts.min;

    svg.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startVal = this.value;
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // 200px of vertical drag spans the whole range; hold shift for fine control.
      const speed = e.shiftKey ? 0.25 : 1;
      const dv = ((startY - e.clientY) / 200) * range * speed;
      this.setValue(startVal + dv);
    });
    const end = (e: PointerEvent) => {
      dragging = false;
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        this.setValue(this.value + dir * (this.opts.step || range / 100) * 3);
      },
      { passive: false },
    );

    svg.addEventListener('dblclick', () => {
      if (this.opts.default !== undefined) this.setValue(this.opts.default);
    });
  }
}
