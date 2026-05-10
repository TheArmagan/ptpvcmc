export function updateRadar(data, maxRange) {
  const canvas = document.getElementById('radar-canvas');
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const cx = w / 2, cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  const cr = Math.min(cx, cy);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1;
  for (let r = 1; r <= 3; r++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (cr * r) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

  if (!data.self) return;

  const scale = (cr * 0.9) / maxRange;
  const yaw = (data.self.yaw * Math.PI) / 180;

  (data.nearby || []).forEach(p => {
    const dx = (p.x - data.self.x) * -1;
    const dz = (p.z - data.self.z) * -1;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > maxRange) return;

    const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
    const px = cx + rx * scale;
    const py = cy + rz * scale;

    const alpha = Math.max(0.2, 1 - dist / maxRange);
    ctx.fillStyle = `rgba(0,255,136,${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(180,180,180,${alpha})`;
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(p.name, px + 6, py + 4);
  });

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - 14);
  ctx.stroke();
}
