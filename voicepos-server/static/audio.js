let audioCtx = null;
let masterGain = null;

export function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = document.getElementById('master-vol').value / 100;
  masterGain.connect(audioCtx.destination);
}

export function getAudioCtx() {
  return audioCtx;
}

export function createPanner(maxRange, dest = null) {
  const p = audioCtx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.maxDistance = maxRange;
  p.refDistance = 4;
  p.rolloffFactor = 1.5;
  p.connect(dest ?? masterGain);
  return p;
}

export function setupPeerAudio(peerName, stream, peers, onReady) {
  const peer = peers.get(peerName);
  if (!peer) return;
  audioCtx.resume();
  if (!peer.sinkEl) {
    peer.sinkEl = document.createElement('audio');
    peer.sinkEl.muted = true;
    peer.sinkEl.autoplay = true;
  }
  peer.sinkEl.srcObject = stream;
  peer.sinkEl.play().catch(() => {});
  if (peer.remoteSource) peer.remoteSource.disconnect();
  peer.remoteSource = audioCtx.createMediaStreamSource(stream);
  peer.remoteSource.connect(peer.panner);
  onReady(peerName);
}

export function updateSpatialAudio(data, peers, maxRange) {
  if (!audioCtx || !data.self) return;
  for (const [name, peer] of peers) {
    if (!peer.panner) continue;
    const p = (data.nearby || []).find(n => n.name === name);
    if (!p) continue;
    const dx = p.x - data.self.x;
    const dy = p.y - data.self.y;
    const dz = p.z - data.self.z;
    const yaw = (data.self.yaw * Math.PI) / 180;
    const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
    peer.panner.positionX.setTargetAtTime(-rx, audioCtx.currentTime, 0.05);
    peer.panner.positionY.setTargetAtTime(dy, audioCtx.currentTime, 0.05);
    peer.panner.positionZ.setTargetAtTime(-rz, audioCtx.currentTime, 0.05);
    peer.panner.maxDistance = maxRange;
  }
}

export function setMasterVol(v) {
  if (masterGain) masterGain.gain.value = v / 100;
}
