import { createPanner, setupPeerAudio } from './audio.js';

// name → { pc, panner, sinkEl, remoteSource, state, lastSeenMs }
const peers = new Map();

let _sendSignal = null;
let _log = null;
let _getStream = null;
let _maxRange = 96;

export function init(sendSignal, log, getStream) {
  _sendSignal = sendSignal;
  _log = log;
  _getStream = getStream;
}

export function setMaxRange(v) {
  _maxRange = v;
}

export function getPeers() {
  return peers;
}

export function cleanupPeer(name) {
  const peer = peers.get(name);
  if (!peer) return;
  peer.pc?.close();
  peer.panner?.disconnect();
  peer.remoteSource?.disconnect();
  if (peer.sinkEl) peer.sinkEl.srcObject = null;
  peers.delete(name);
  _log(`${name}: disconnected`);
}

export function cleanupAll() {
  for (const [name] of [...peers]) cleanupPeer(name);
}

function makePCFor(peerName) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  });

  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    setupPeerAudio(peerName, stream, peers, (name) => _log(`${name}: audio ready`, 'ok'));
  };

  pc.onconnectionstatechange = () => {
    const peer = peers.get(peerName);
    if (!peer) return;
    peer.state = pc.connectionState;
    _log(`${peerName}: ${pc.connectionState}`, pc.connectionState === 'connected' ? 'ok' : 'info');
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanupPeer(peerName);
  };

  const stream = _getStream();
  if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));
  return pc;
}

function waitForICE(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') resolve();
    });
    setTimeout(resolve, 3000);
  });
}

async function initiateConnection(peerName, peer) {
  const pc = makePCFor(peerName);
  peer.pc = pc;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForICE(pc);
  _sendSignal(peerName, pc.localDescription);
  _log(`offer -> ${peerName}`, 'info');
}

export async function checkForNewPeers(data, myName) {
  const now = Date.now();
  const nearbyNames = new Set((data.nearby || []).map(p => p.name));

  for (const [name, peer] of peers) {
    if (nearbyNames.has(name)) peer.lastSeenMs = now;
  }
  for (const [name, peer] of peers) {
    if (now - (peer.lastSeenMs ?? 0) > 8000) cleanupPeer(name);
  }

  for (const player of (data.nearby || [])) {
    if (peers.has(player.name)) continue;
    const peer = {
      pc: null,
      panner: createPanner(_maxRange),
      sinkEl: null,
      remoteSource: null,
      state: 'connecting',
      lastSeenMs: now,
    };
    peers.set(player.name, peer);
    if (myName < player.name) await initiateConnection(player.name, peer);
  }
}

export async function handleSignal(from, data, myName) {
  if (data.type === 'offer') {
    let peer = peers.get(from);
    if (!peer) {
      peer = {
        pc: null,
        panner: createPanner(_maxRange),
        sinkEl: null,
        remoteSource: null,
        state: 'connecting',
        lastSeenMs: Date.now(),
      };
      peers.set(from, peer);
    }
    if (peer.pc) { peer.pc.close(); peer.pc = null; }
    const pc = makePCFor(from);
    peer.pc = pc;
    await pc.setRemoteDescription(data);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForICE(pc);
    _sendSignal(from, pc.localDescription);
    _log(`answer -> ${from}`, 'info');
  } else if (data.type === 'answer') {
    const peer = peers.get(from);
    if (peer?.pc && peer.pc.signalingState !== 'stable') {
      await peer.pc.setRemoteDescription(data);
    }
  }
}
