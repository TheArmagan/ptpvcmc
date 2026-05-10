import { getAudioCtx, createPanner } from './audio.js';

// id → { audioEl, source, panner, file }
const nodes = new Map();
let jukeboxGain = null;
let volume = 0.8;

function ensureGain() {
  if (jukeboxGain) return jukeboxGain;
  const ctx = getAudioCtx();
  if (!ctx) return null;
  jukeboxGain = ctx.createGain();
  jukeboxGain.gain.value = volume;
  jukeboxGain.connect(ctx.destination);
  return jukeboxGain;
}

export function setJukeboxVolume(v) {
  volume = v / 100;
  if (jukeboxGain) jukeboxGain.gain.value = volume;
}

export function updateJukeboxAudio(jukeboxes) {
  const playingIds = new Set(jukeboxes.filter(jb => jb.active && jb.file).map(jb => jb.id));

  // Stop and tear down nodes for jukeboxes that are gone or inactive
  for (const [id, node] of nodes) {
    if (!playingIds.has(id)) {
      node.audioEl.pause();
      try { node.source?.disconnect(); } catch {}
      try { node.panner?.disconnect(); } catch {}
      nodes.delete(id);
    }
  }

  for (const jb of jukeboxes) {
    if (!jb.active || !jb.file) continue;

    const gain = ensureGain();
    if (!gain) continue;

    const ctx = getAudioCtx();
    const src = `/jukebox-audio/${encodeURIComponent(jb.file)}`;
    let node = nodes.get(jb.id);

    if (node && node.file === jb.file) continue; // already playing correct file

    // Tear down previous node for this id (file changed)
    if (node) {
      node.audioEl.pause();
      try { node.source?.disconnect(); } catch {}
      try { node.panner?.disconnect(); } catch {}
    }

    const panner = createPanner(256, gain);
    const audioEl = new Audio(src);
    audioEl.loop = true;
    audioEl.preload = 'auto';

    const newNode = { audioEl, source: null, panner, file: jb.file, startedAt: jb.startedAt };
    nodes.set(jb.id, newNode);

    audioEl.addEventListener('canplay', () => {
      if (!newNode.source) {
        newNode.source = ctx.createMediaElementSource(audioEl);
        newNode.source.connect(panner);
      }
      // Seek to synced position
      if (audioEl.duration) {
        audioEl.currentTime = ((Date.now() - jb.startedAt) / 1000) % audioEl.duration;
      }
      audioEl.play().catch(() => {});
    }, { once: true });
  }
}

export function updateJukeboxSpatialAudio(jukeboxes, self) {
  const ctx = getAudioCtx();
  if (!ctx || !self) return;

  for (const jb of jukeboxes) {
    const node = nodes.get(jb.id);
    if (!node?.panner) continue;

    // Same coordinate transform as peer spatial audio
    const dx = (jb.x + 0.5) - self.x;
    const dy = (jb.y + 0.5) - self.y;
    const dz = (jb.z + 0.5) - self.z;
    const yaw = (self.yaw * Math.PI) / 180;
    const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);

    node.panner.positionX.setTargetAtTime(-rx, ctx.currentTime, 0.05);
    node.panner.positionY.setTargetAtTime(dy, ctx.currentTime, 0.05);
    node.panner.positionZ.setTargetAtTime(-rz, ctx.currentTime, 0.05);
  }
}

// Returns the closest jukebox within `range` blocks in the same world, or null
export function getNearbyJukebox(jukeboxes, self, world, range = 3) {
  if (!self) return null;
  let closest = null;
  let closestDist = Infinity;
  for (const jb of jukeboxes) {
    if (jb.world !== world) continue;
    const dx = (jb.x + 0.5) - self.x;
    const dy = (jb.y + 0.5) - self.y;
    const dz = (jb.z + 0.5) - self.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= range && dist < closestDist) {
      closest = jb;
      closestDist = dist;
    }
  }
  return closest;
}

export async function uploadJukeboxAudio(id, file) {
  const form = new FormData();
  form.append('audio', file);
  const res = await fetch(`/jukebox/${encodeURIComponent(id)}/upload`, {
    method: 'POST',
    body: form,
  });
  return res.json();
}

export async function removeJukeboxAudio(id) {
  const res = await fetch(`/jukebox/${encodeURIComponent(id)}/audio`, {
    method: 'DELETE',
  });
  return res.json();
}
