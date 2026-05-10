import { updateRadar } from './radar.js';
import { initAudio, updateSpatialAudio, setMasterVol } from './audio.js';
import {
  init as initPeers,
  getPeers,
  checkForNewPeers,
  handleSignal,
  cleanupAll,
  setMaxRange,
} from './peers.js';
import {
  updateJukeboxAudio,
  updateJukeboxSpatialAudio,
  getNearbyJukebox,
  setJukeboxVolume,
  uploadJukeboxAudio,
  removeJukeboxAudio,
} from './jukebox.js';

let myName = localStorage.getItem('voicepos-name') ?? null;
let localStream = null;
let micActive = false;
let maxRange = 96;
let ws = null;
let wsOpen = false;
let currentJukeboxId = null; // id of jukebox currently shown in UI

// ─── logging ──────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const el = document.getElementById('log');
  const line = document.createElement('span');
  line.className = `entry ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(line);
}

// ─── WebSocket ────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    wsOpen = true;
    if (myName) ws.send(JSON.stringify({ type: 'identify', name: myName }));
  });

  ws.addEventListener('message', async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'players') {
      updateNamePicker(msg.data);
    } else if (msg.type === 'positions') {
      updateUI(msg.data);
    } else if (msg.type === 'signal') {
      await handleSignal(msg.from, msg.data, myName);
    }
  });

  ws.addEventListener('close', () => {
    wsOpen = false;
    document.getElementById('dot').className = 'status-dot error';
    document.getElementById('status-text').textContent = 'reconnecting...';
    setTimeout(connectWS, 2000);
  });

  ws.addEventListener('error', () => ws.close());
}

function sendSignal(to, data) {
  if (ws && wsOpen) ws.send(JSON.stringify({ type: 'signal', to, data }));
}

// ─── name picker ──────────────────────────────────────────────────────────
function updateNamePicker(names) {
  if (myName) return;
  const list = document.getElementById('name-picker-list');
  const hint = list.previousElementSibling;
  if (!names.length) {
    hint.textContent = 'waiting for mod data — start Minecraft first';
    list.innerHTML = '';
    return;
  }
  hint.textContent = 'select your Minecraft username:';
  list.innerHTML = names.map(n =>
    `<button class="name-option" data-name="${n}">${n}</button>`
  ).join('');
}

function selectName(name) {
  myName = name;
  localStorage.setItem('voicepos-name', name);
  document.getElementById('name-picker-section').style.display = 'none';
  document.getElementById('reset-name').style.display = '';
  log(`you are ${name}`, 'ok');
  if (ws && wsOpen) ws.send(JSON.stringify({ type: 'identify', name }));
}

function resetName() {
  myName = null;
  localStorage.removeItem('voicepos-name');
  document.getElementById('name-picker-section').style.display = '';
  document.getElementById('reset-name').style.display = 'none';
  cleanupAll();
}

// ─── UI updates ───────────────────────────────────────────────────────────
function updateUI(data) {
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('status-text');
  const peers = getPeers();

  if (data.self) {
    dot.className = 'status-dot connected';
    statusText.textContent = myName;
    document.getElementById('coord-x').innerHTML = `<span>X</span>${data.self.x.toFixed(1)}`;
    document.getElementById('coord-y').innerHTML = `<span>Y</span>${data.self.y.toFixed(1)}`;
    document.getElementById('coord-z').innerHTML = `<span>Z</span>${data.self.z.toFixed(1)}`;
    document.getElementById('coord-yaw').innerHTML = `<span>YAW</span>${data.self.yaw.toFixed(0)}°`;
  } else if (myName) {
    dot.className = 'status-dot';
    statusText.textContent = 'mod not sending data...';
  } else {
    dot.className = 'status-dot';
    statusText.textContent = 'pick your name →';
  }

  const jukeboxes = data.jukeboxes ?? [];

  updateRadar(data, maxRange);
  updatePlayerList(data, peers);
  updateSpatialAudio(data, peers, maxRange);
  updateJukeboxAudio(jukeboxes);
  updateJukeboxSpatialAudio(jukeboxes, data.self);
  updateJukeboxUI(jukeboxes, data.self);
  if (micActive && myName) checkForNewPeers(data, myName);
}

function updatePlayerList(data, peers) {
  const el = document.getElementById('player-list');
  if (!data.self || !data.nearby?.length) {
    el.innerHTML = '<div style="color:var(--muted)">no players nearby</div>';
    return;
  }
  el.innerHTML = data.nearby.map(p => {
    const dx = p.x - data.self.x;
    const dy = p.y - data.self.y;
    const dz = p.z - data.self.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(1);
    const vol = Math.max(0, 1 - dist / maxRange);
    const state = peers.get(p.name)?.state;
    const dotColor = state === 'connected' ? 'var(--accent)' : state === 'connecting' ? 'var(--yellow)' : 'var(--muted)';
    return `
      <div class="player-entry${state === 'connected' ? ' speaking' : ''}">
        <span style="color:${dotColor};font-size:9px;flex-shrink:0">●</span>
        <div class="player-name">${p.name}</div>
        <div class="player-dist">${dist}m</div>
        <div class="player-vol"><div class="player-vol-fill" style="width:${state === 'connected' ? vol * 100 : 0}%"></div></div>
      </div>`;
  }).join('');
}

// ─── jukebox UI ───────────────────────────────────────────────────────────
function updateJukeboxUI(jukeboxes, self) {
  const section = document.getElementById('jukebox-section');
  const world = self?.world ?? null;
  const nearby = getNearbyJukebox(jukeboxes, self, world, 3);

  if (!nearby) {
    section.style.display = 'none';
    currentJukeboxId = null;
    return;
  }

  section.style.display = '';
  currentJukeboxId = nearby.id;

  document.getElementById('jukebox-coords').textContent =
    `${Math.floor(nearby.x)}, ${Math.floor(nearby.y)}, ${Math.floor(nearby.z)}`;

  const statusEl = document.getElementById('jukebox-status');
  if (nearby.file) {
    statusEl.textContent = nearby.active ? `▶ playing` : `⏹ stopped`;
    statusEl.style.color = nearby.active ? 'var(--accent)' : 'var(--muted)';
    document.getElementById('jukebox-remove-btn').style.display = '';
  } else {
    statusEl.textContent = 'no audio';
    statusEl.style.color = 'var(--muted)';
    document.getElementById('jukebox-remove-btn').style.display = 'none';
  }
}

// ─── mic ──────────────────────────────────────────────────────────────────
function micConstraints() {
  const deviceId = document.getElementById('mic-select').value;
  const noiseSuppression = document.getElementById('noise-suppression').checked;
  const audio = { noiseSuppression };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

async function applyNoiseSuppression() {
  const enabled = document.getElementById('noise-suppression').checked;
  if (localStream) {
    const track = localStream.getAudioTracks()[0];
    if (track) await track.applyConstraints({ noiseSuppression: enabled }).catch(() => {});
  }
  log(`noise suppression ${enabled ? 'on' : 'off'}`);
}

async function toggleMic() {
  if (micActive) {
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    micActive = false;
    document.getElementById('btn-mic').textContent = '🎙 join voice';
    log('left voice chat');
    cleanupAll();
  } else {
    initAudio();
    try {
      localStream = await navigator.mediaDevices.getUserMedia(micConstraints());
      micActive = true;
      document.getElementById('btn-mic').textContent = '🔴 in voice chat';
      log('joined voice chat', 'ok');
    } catch (e) {
      log('mic error: ' + e.message, 'err');
    }
  }
}

async function onMicDeviceChange() {
  if (!micActive) return;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia(micConstraints());
    const newTrack = newStream.getAudioTracks()[0];
    for (const [, peer] of getPeers()) {
      const sender = peer.pc?.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(newTrack);
    }
    localStream?.getTracks().forEach(t => t.stop());
    localStream = newStream;
    log('microphone changed', 'ok');
  } catch (e) {
    log('mic change error: ' + e.message, 'err');
  }
}

function updateRange(v) {
  maxRange = parseInt(v);
  setMaxRange(maxRange);
  document.getElementById('range-val').textContent = v;
  for (const [, peer] of getPeers()) {
    if (peer.panner) peer.panner.maxDistance = maxRange;
  }
}

// ─── mic device enumeration ───────────────────────────────────────────────
async function populateMicList() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    tmp.getTracks().forEach(t => t.stop());
  } catch (e) {}
  const devices = await navigator.mediaDevices.enumerateDevices();
  const sel = document.getElementById('mic-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">default microphone</option>';
  devices.filter(d => d.kind === 'audioinput').forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`;
    sel.appendChild(opt);
  });
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

// ─── init ─────────────────────────────────────────────────────────────────
initPeers(sendSignal, log, () => localStream);

document.getElementById('reset-name').addEventListener('click', resetName);
document.getElementById('btn-mic').addEventListener('click', toggleMic);
document.getElementById('master-vol').addEventListener('input', e => setMasterVol(e.target.value));
document.getElementById('jukebox-vol').addEventListener('input', e => setJukeboxVolume(e.target.value));
document.getElementById('range-slider').addEventListener('input', e => updateRange(e.target.value));
document.getElementById('noise-suppression').addEventListener('change', applyNoiseSuppression);
document.getElementById('mic-select').addEventListener('change', onMicDeviceChange);
document.getElementById('name-picker-list').addEventListener('click', e => {
  const btn = e.target.closest('.name-option');
  if (btn) selectName(btn.dataset.name);
});

// Jukebox controls
document.getElementById('jukebox-upload-btn').addEventListener('click', () => {
  document.getElementById('jukebox-file').click();
});
document.getElementById('jukebox-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentJukeboxId) return;
  log('uploading jukebox audio...', 'info');
  const result = await uploadJukeboxAudio(currentJukeboxId, file);
  if (result.ok) log('jukebox audio uploaded', 'ok');
  else log(`upload failed: ${result.error}`, 'err');
  e.target.value = '';
});
document.getElementById('jukebox-remove-btn').addEventListener('click', async () => {
  if (!currentJukeboxId) return;
  const result = await removeJukeboxAudio(currentJukeboxId);
  if (result.ok) log('jukebox audio removed');
  else log(`remove failed: ${result.error}`, 'err');
});

if (myName) {
  document.getElementById('name-picker-section').style.display = 'none';
  document.getElementById('reset-name').style.display = '';
}

navigator.mediaDevices.addEventListener('devicechange', populateMicList);
populateMicList();
connectWS();
