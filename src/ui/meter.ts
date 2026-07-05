export function drawWaveform(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: Float32Array): void {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#e0a458';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const step = Math.max(1, Math.floor(data.length / width));
  let x = 0;
  for (let i = 0; i < data.length; i += step) {
    const y = (0.5 - data[i] * 0.5) * height;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += 1;
  }
  ctx.stroke();
}

interface PlantArc {
  name: string;
  headingDegrees: number;
  weight: number;
}

export function drawRadialCompass(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  heading: number,
  plants: PlantArc[],
): void {
  const { width, height } = canvas;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 12;

  ctx.clearRect(0, 0, width, height);

  // outer ring
  ctx.strokeStyle = '#23392e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const toXY = (deg: number, r: number) => {
    // heading 0 = "up" on screen, clockwise
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };

  // plant markers, sized by current blend weight
  for (const plant of plants) {
    const [px, py] = toXY(plant.headingDegrees, radius);
    const markerRadius = 6 + plant.weight * 12;
    ctx.beginPath();
    ctx.arc(px, py, markerRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(224, 164, 88, ${0.25 + plant.weight * 0.75})`;
    ctx.fill();

    ctx.fillStyle = '#93a89b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(plant.name, px, py + markerRadius + 12);
  }

  // heading needle
  const [tipX, tipY] = toXY(heading, radius - 14);
  ctx.strokeStyle = '#e8f0ea';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#e8f0ea';
  ctx.fill();
}
