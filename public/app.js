/* =====================================================================
   Screen Share Collab — Frontend (Vanilla JS + WebRTC + Socket.io)
   ===================================================================== */

// ─── DOM refs ──────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const roomScreen    = document.getElementById('room-screen');
const avatarInput   = document.getElementById('avatar-input');
const avatarPreview = document.getElementById('avatar-preview');
const nicknameInput = document.getElementById('nickname-input');
const passwordInput = document.getElementById('password-input');
const joinBtn       = document.getElementById('join-btn');
const loginError    = document.getElementById('login-error');
const btnShare      = document.getElementById('btn-share');
const btnStop       = document.getElementById('btn-stop');
const btnSidebar    = document.getElementById('btn-toggle-sidebar');
const videoGrid     = document.getElementById('video-grid');
const emptyState    = document.getElementById('empty-state');
const sidebar       = document.getElementById('sidebar');
const partList      = document.getElementById('participants-list');
const partCount     = document.getElementById('participant-count');
const qualitySelect = document.getElementById('quality-select');

// ─── Default avatar (simple SVG data URL) ──────────────────
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="%235865f2"/>' +
  '<text x="50" y="62" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">😊</text>' +
  '</svg>'
);

avatarPreview.src = DEFAULT_AVATAR;

// ─── State ─────────────────────────────────────────────────
const socket = io();

let myId       = null;
let myNickname = '';
let myAvatar   = DEFAULT_AVATAR;
let isSharing  = false;
let localStream = null;
let videoTrack = null; // Referência ao video track para applyConstraints

// Peer connections & related data
const outPeers = new Map(); // peerId -> { pc, iceQueue, senders: Map<trackId, sender> }
const inPeers = new Map();  // peerId -> { pc, iceQueue, nickname, avatar }

// Active video tiles: peerId -> HTMLElement
const videoTiles = new Map();

// Participant map: peerId -> { nickname, avatar, sharing }
const participants = new Map();

// ─── Quality Presets Configuration ─────────────────────────
/**
 * Presets de qualidade para transmissão de tela.
 * Cada preset define resolução, framerate e bitrate máximo.
 * degradationPreference='maintain-resolution' prioriza nitidez em oscilações de rede.
 */
const QUALITY_PRESETS = {
  '1080p60': { width: 1920, height: 1080, frameRate: 60, maxBitrate: 6000000, label: '1080p 60 FPS' },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4000000, label: '1080p 30 FPS' },
  '720p60':  { width: 1280, height: 720,  frameRate: 60, maxBitrate: 3500000, label: '720p 60 FPS' },
  '720p30':  { width: 1280, height: 720,  frameRate: 30, maxBitrate: 2000000, label: '720p 30 FPS' },
  '480p60':  { width: 854,  height: 480,  frameRate: 60, maxBitrate: 1500000, label: '480p 60 FPS' },
  '480p30':  { width: 854,  height: 480,  frameRate: 30, maxBitrate: 800000,  label: '480p 30 FPS' }
};

// Preset atual (default: 720p60)
let currentQuality = '720p60';

// Detecta Firefox para ajustes específicos
const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

// ICE config (public STUN + TURN for NAT traversal)
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

/* =====================================================================
   1. LOGIN
   ===================================================================== */

// Avatar preview
avatarInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    myAvatar = reader.result;
    avatarPreview.src = myAvatar;
  };
  reader.readAsDataURL(file);
});

// Join button
joinBtn.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  const password = passwordInput.value;

  if (!nickname) {
    showLoginError('Por favor, insira um nickname.');
    return;
  }
  if (!password) {
    showLoginError('Por favor, insira a senha da sala.');
    return;
  }

  joinBtn.disabled = true;
  joinBtn.textContent = 'Entrando...';

  socket.emit('auth', { password, nickname, avatar: myAvatar }, (res) => {
    if (!res.success) {
      showLoginError(res.message);
      joinBtn.disabled = false;
      joinBtn.textContent = 'Entrar na Sala';
      return;
    }

    myId = res.userId;
    myNickname = nickname;

    // Populate participants list
    for (const p of res.participants) {
      participants.set(p.id, {
        nickname: p.nickname,
        avatar: p.avatar || DEFAULT_AVATAR,
        sharing: p.sharing
      });
    }

    // Switch screens
    loginScreen.classList.remove('active');
    roomScreen.classList.add('active');
    updateParticipantsUI();
  });
});

// Also allow Enter to join
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordInput.focus();
});

function showLoginError(msg) {
  loginError.textContent = msg;
  setTimeout(() => { loginError.textContent = ''; }, 4000);
}

/* =====================================================================
   2. QUALITY CONTROL (UI + Constraints)
   ===================================================================== */

/**
 * Inicializa o seletor de qualidade na UI.
 * Restaura o último preset salvo no localStorage (se houver).
 */
function initQualityControl() {
  const saved = localStorage.getItem('screenShareQuality');
  if (saved && QUALITY_PRESETS[saved]) {
    currentQuality = saved;
    qualitySelect.value = saved;
  }

  qualitySelect.addEventListener('change', async (e) => {
    const newQuality = e.target.value;
    if (QUALITY_PRESETS[newQuality]) {
      await applyQualitySettings(newQuality);
    }
  });
}

/**
 * Aplica as configurações de qualidade selecionadas.
 * Se estiver compartilhando, usa applyConstraints() no track de vídeo
 * e atualiza o bitrate em todos os RTCRtpSender ativos.
 * @param {string} qualityKey - Chave do preset (ex: '720p60')
 */
async function applyQualitySettings(qualityKey) {
  const preset = QUALITY_PRESETS[qualityKey];
  if (!preset) return;

  currentQuality = qualityKey;
  localStorage.setItem('screenShareQuality', qualityKey);

  // Se não está compartilhando, apenas atualiza o preset para a próxima vez
  if (!isSharing || !videoTrack) {
    console.log('[Quality] Preset updated to:', preset.label);
    return;
  }

  try {
    // 1. Aplica constraints no track de vídeo (resolução + framerate)
    // O navegador fará o melhor esforço para atender; se não suportar, ajustará automaticamente
    await videoTrack.applyConstraints({
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.frameRate }
    });
    console.log('[Quality] applyConstraints applied:', preset.label);

    // 2. Atualiza bitrate e degradationPreference em todos os senders de vídeo ativos
    await updateAllSendersBitrate(preset.maxBitrate);

  } catch (err) {
    console.warn('[Quality] Falha ao aplicar constraints, tentando fallback:', err);
    // Fallback gracioso: tenta obter as capacidades reais do track
    try {
      const caps = videoTrack.getCapabilities();
      const fallback = {
        width: { ideal: Math.min(preset.width, caps.width?.max || preset.width) },
        height: { ideal: Math.min(preset.height, caps.height?.max || preset.height) },
        frameRate: { ideal: Math.min(preset.frameRate, caps.frameRate?.max || preset.frameRate) }
      };
      await videoTrack.applyConstraints(fallback);
      await updateAllSendersBitrate(preset.maxBitrate);
      console.log('[Quality] Fallback applied:', fallback);
    } catch (fallbackErr) {
      console.error('[Quality] Fallback também falhou:', fallbackErr);
    }
  }
}

/**
 * Atualiza maxBitrate e degradationPreference em todos os RTCRtpSender de vídeo
 * de todas as conexões outPeers ativas.
 * @param {number} maxBitrate - Bitrate máximo em bps
 */
async function updateAllSendersBitrate(maxBitrate) {
  for (const [peerId, peerData] of outPeers) {
    if (!peerData.pc) continue;

    const senders = peerData.pc.getSenders();
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        try {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          
          // Configura bitrate máximo
          params.encodings[0].maxBitrate = maxBitrate;
          
          // Prioriza manter resolução em oscilações de rede
          params.degradationPreference = 'maintain-resolution';
          
          await sender.setParameters(params);
          console.log(`[Bitrate] Updated for peer ${peerId}: ${maxBitrate} bps`);
        } catch (err) {
          console.warn(`[Bitrate] Failed to set parameters for peer ${peerId}:`, err);
        }
      }
    }
  }
}

/* =====================================================================
   3. SOCKET EVENTS
   ===================================================================== */

socket.on('user-joined', ({ id, nickname, avatar, sharing }) => {
  participants.set(id, {
    nickname,
    avatar: avatar || DEFAULT_AVATAR,
    sharing: sharing || false
  });
  updateParticipantsUI();
});

socket.on('user-left', ({ id }) => {
  participants.delete(id);
  removeInPeer(id);
  removeOutPeer(id);
  removeVideoTile(id);
  updateParticipantsUI();
  updateGridLayout();
});

socket.on('user-start-sharing', ({ id, nickname, avatar }) => {
  const p = participants.get(id);
  if (p) p.sharing = true;
  updateParticipantsUI();
});

socket.on('user-stop-sharing', ({ id }) => {
  const p = participants.get(id);
  if (p) p.sharing = false;
  removeInPeer(id);
  removeVideoTile(id);
  updateParticipantsUI();
  updateGridLayout();
});

socket.on('request-stream', ({ from }) => {
  if (isSharing && localStream && !outPeers.has(from)) {
    createPeerAndOffer(from);
  }
});

socket.on('stop-watching', ({ from }) => {
  removeOutPeer(from);
});

// ─── WebRTC Signaling ──────────────────────────────────────

socket.on('offer', async ({ from, offer, nickname, avatar }) => {
  try {
    if (!inPeers.has(from)) {
      console.log('Ignoring offer from ' + from + ' because we are not watching.');
      return;
    }

    const pc = createPeerConnection(from, false); // false = receiver (inPeer)
    const peerData = inPeers.get(from);
    peerData.pc = pc;
    peerData.nickname = nickname;
    peerData.avatar = avatar;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('ice-candidate', { from: myId, to: from, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      const p = participants.get(from);
      const nick = nickname || p?.nickname || 'Desconhecido';
      const av = avatar || p?.avatar || DEFAULT_AVATAR;

      const stream = e.streams[0];
      if (!stream) return;

      if (!videoTiles.has(from)) {
        addVideoTile(from, stream, nick, av);
      } else {
        const tile = videoTiles.get(from);
        const video = tile.querySelector('video');
        if (video && video.srcObject !== stream) {
          video.srcObject = stream;
          video.muted = false;
          video.play().catch(err => console.warn(err));
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removeInPeer(from);
        removeVideoTile(from);
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', { to: from, answer, senderId: from });

    if (peerData.iceQueue && peerData.iceQueue.length > 0) {
      for (const c of peerData.iceQueue) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){}
      }
      peerData.iceQueue = [];
    }
  } catch (err) {
    console.error('Error handling offer', err);
  }
});

socket.on('answer', async ({ from, answer, senderId }) => {
  try {
    if (senderId === myId) {
      const peerData = outPeers.get(from);
      if (peerData && peerData.pc) {
        await peerData.pc.setRemoteDescription(new RTCSessionDescription(answer));
        if (peerData.iceQueue && peerData.iceQueue.length > 0) {
          for (const c of peerData.iceQueue) {
            try { await peerData.pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e){}
          }
          peerData.iceQueue = [];
        }
      }
    }
  } catch (err) {
    console.error('Error handling answer', err);
  }
});

socket.on('ice-candidate', async ({ from, to, candidate, senderId }) => {
    try {
      // ICE candidate from remote peer to me (I'm the receiver - inPeers)
      if (to === myId) {
        const peerData = inPeers.get(from);
        if (peerData) {
          if (peerData.pc?.remoteDescription) {
            await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            peerData.iceQueue.push(candidate);
          }
        }
      }
      // ICE candidate from me to remote peer (I'm the sender - outPeers)
      else if (from === myId) {
        const peerData = outPeers.get(to);
        if (peerData) {
          if (peerData.pc?.remoteDescription) {
            await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            peerData.iceQueue.push(candidate);
          }
        }
      }
    } catch (err) {
      console.error('Error handling ice-candidate', err);
    }
  });

/* =====================================================================
   4. WEBRTC - Peer Connection Factory
   ===================================================================== */

/**
 * Cria uma RTCPeerConnection com configuração de codecs preferenciais.
 * Prioriza H.264 / AV1 sobre VP8 para aceleração por hardware.
 * @param {string} peerId - ID do peer remoto
 * @param {boolean} isSender - true se somos o sender (outPeer), false se receiver (inPeer)
 * @returns {RTCPeerConnection}
 */
function createPeerConnection(peerId, isSender) {
  // Configuração base
  const pcConfig = { ...ICE_CONFIG };
  
  // Reordena codecs para priorizar H.264 e AV1 (hardware acceleration)
  // Isso é feito via setCodecPreferences no transceiver (quando disponível)
  const pc = new RTCPeerConnection(pcConfig);

  // Armazena referência ao peerId para debug
  pc._peerId = peerId;
  pc._isSender = isSender;

  return pc;
}

/* =====================================================================
   5. WEBRTC - Outgoing (Sender) - createPeerAndOffer
   ===================================================================== */

async function createPeerAndOffer(peerId) {
  try {
    const pc = createPeerConnection(peerId, true);
    
    // Armazena senders para poder atualizar bitrate depois
    const senders = new Map();
    outPeers.set(peerId, { pc, iceQueue: [], senders });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('ice-candidate', { from: myId, to: peerId, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        // Aplica bitrate inicial nos senders de vídeo
        applyBitrateToSenders(pc, QUALITY_PRESETS[currentQuality].maxBitrate);
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removeOutPeer(peerId);
      }
    };

    // Adiciona tracks do localStream à conexão
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localStream);
        if (track.kind === 'video') {
          senders.set(track.id, sender);
        }
      });
    }

    // Configura codec preferences para priorizar H.264/AV1 (se suportado)
    await setCodecPreferences(pc, 'video');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('offer', {
      to: peerId,
      offer,
      nickname: myNickname,
      avatar: myAvatar
    });
  } catch (err) {
    console.error('Error creating peer and offer', err);
  }
}

/**
 * Aplica maxBitrate e degradationPreference nos senders de vídeo de uma PeerConnection.
 * @param {RTCPeerConnection} pc
 * @param {number} maxBitrate
 */
function applyBitrateToSenders(pc, maxBitrate) {
  const senders = pc.getSenders();
  for (const sender of senders) {
    if (sender.track && sender.track.kind === 'video') {
      try {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = maxBitrate;
        params.degradationPreference = 'maintain-resolution';
        sender.setParameters(params).catch(err => console.warn('[Bitrate] setParameters failed:', err));
      } catch (e) {
        console.warn('[Bitrate] Could not set maxBitrate', e);
      }
    }
  }
}

/**
 * Tenta definir codec preferences para priorizar H.264 e AV1.
 * Requer suporte a RTCRtpTransceiver.setCodecPreferences (Chrome 90+, Firefox 90+).
 * @param {RTCPeerConnection} pc
 * @param {string} kind - 'video' ou 'audio'
 */
async function setCodecPreferences(pc, kind) {
  try {
    const transceivers = pc.getTransceivers();
    for (const transceiver of transceivers) {
      if (transceiver.receiver.track?.kind !== kind) continue;

      const capabilities = RTCRtpReceiver.getCapabilities(kind);
      if (!capabilities || !capabilities.codecs) continue;

      // Ordena codecs: H.264 (RTX) > AV1 > VP9 > VP8 > outros
      const preferredCodecs = capabilities.codecs
        .filter(c => c.kind === kind)
        .sort((a, b) => {
          const getPriority = (codec) => {
            const mime = codec.mimeType.toLowerCase();
            if (mime.includes('h264') || mime.includes('avc')) return 4;
            if (mime.includes('av1')) return 3;
            if (mime.includes('vp9')) return 2;
            if (mime.includes('vp8')) return 1;
            return 0;
          };
          return getPriority(b) - getPriority(a);
        });

      if (preferredCodecs.length > 0) {
        transceiver.setCodecPreferences(preferredCodecs);
        console.log(`[Codec] ${kind} preferences set:`, preferredCodecs.map(c => c.mimeType).join(', '));
      }
    }
  } catch (err) {
    // setCodecPreferences pode não estar disponível em navegadores antigos
    console.warn('[Codec] setCodecPreferences not supported or failed:', err);
  }
}

function removeInPeer(peerId) {
  const peerData = inPeers.get(peerId);
  if (peerData && peerData.pc) {
    peerData.pc.close();
  }
  inPeers.delete(peerId);
}

function removeOutPeer(peerId) {
  const peerData = outPeers.get(peerId);
  if (peerData && peerData.pc) {
    peerData.pc.close();
  }
  outPeers.delete(peerId);
}

/* =====================================================================
   6. SCREEN SHARING
   ===================================================================== */

btnShare.addEventListener('click', startSharing);
btnStop.addEventListener('click', stopSharing);

/**
 * Inicia o compartilhamento de tela com o preset de qualidade atual.
 * Usa getDisplayMedia com constraints baseadas no preset selecionado.
 */
async function startSharing() {
  const preset = QUALITY_PRESETS[currentQuality];

  try {
    // Constraints para getDisplayMedia
    // Firefox: não suporta frameRate em getDisplayMedia, ignora
    // Audio: echoCancellation ajuda a evitar feedback
    const displayMediaOptions = {
      video: {
        cursor: 'always',
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: isFirefox ? undefined : { ideal: preset.frameRate }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    // Remove frameRate undefined para Firefox
    if (isFirefox) {
      delete displayMediaOptions.video.frameRate;
    }

    localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    videoTrack = localStream.getVideoTracks()[0];

    if (!videoTrack) {
      throw new Error('Nenhum track de vídeo obtido');
    }

  } catch (err) {
    console.log('Screen share cancelled or denied', err);
    return;
  }

  isSharing = true;
  btnShare.classList.add('hidden');
  btnStop.classList.remove('hidden');

  // Mark myself as sharing
  const me = participants.get(myId);
  if (me) me.sharing = true;
  updateParticipantsUI();

  // Tell server
  socket.emit('start-sharing');

  // Show local preview (my own screen) — muted to avoid audio feedback
  addVideoTile(myId, localStream, myNickname + ' (você)', myAvatar, true);

  // Aplica bitrate inicial nas conexões existentes (se houver viewers já conectados)
  await updateAllSendersBitrate(preset.maxBitrate);

  // Handle user stopping share via browser controls (botão nativo do browser)
  videoTrack.onended = () => {
    stopSharing();
  };
}

function stopSharing() {
  if (!isSharing) return;
  isSharing = false;

  btnStop.classList.add('hidden');
  btnShare.classList.remove('hidden');

  // Remove local preview
  removeVideoTile(myId);

  // Stop local tracks e limpa event listeners
  if (localStream) {
    localStream.getTracks().forEach(t => {
      t.onended = null; // Remove listener
      t.stop();
    });
    localStream = null;
  }
  videoTrack = null;

  // Close all peer connections I created as sender
  for (const [peerId, peerData] of outPeers) {
    if (peerData && peerData.pc) peerData.pc.close();
  }
  outPeers.clear();

  // Mark myself as not sharing
  const me = participants.get(myId);
  if (me) me.sharing = false;
  updateParticipantsUI();

  // Notify server
  socket.emit('stop-sharing');
}

/* =====================================================================
   7. VIDEO TILES
   ===================================================================== */

function addVideoTile(peerId, stream, nickname, avatar, isLocal = false) {
  if (videoTiles.has(peerId)) return;

  emptyState.classList.add('hidden');

  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.dataset.peerId = peerId;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;

  if (isLocal) {
    video.muted = true;
  } else {
    video.volume = 1;
    video.muted = false;
  }

  const tryPlay = () => {
    video.play().catch(() => {
      tile.addEventListener('click', () => {
        video.muted = false;
        video.play().catch(console.warn);
      }, { once: true });
    });
  };

  if (video.readyState >= 2) {
    tryPlay();
  } else {
    video.addEventListener('loadeddata', tryPlay, { once: true });
  }

  const badge = document.createElement('div');
  badge.className = 'video-badge';
  badge.innerHTML = `
    <img src="${escapeAttr(avatar)}" alt="avatar" />
    <span>Tela de ${escapeHtml(nickname)}</span>
  `;

  const volControl = document.createElement('div');
  volControl.className = 'volume-control';
  volControl.innerHTML = `
    <label>🔊</label>
    <input type="range" min="0" max="1" step="0.05" value="${isLocal ? '0' : '1'}" ${isLocal ? 'disabled' : ''} />
  `;

  const slider = volControl.querySelector('input[type="range"]');
  slider.addEventListener('input', () => {
    video.volume = parseFloat(slider.value);
  });

  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'fullscreen-btn';
  fullscreenBtn.innerHTML = '⛶';
  fullscreenBtn.title = 'Tela Cheia';
  fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) {
      tile.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen();
    }
  };

  tile.appendChild(video);
  tile.appendChild(badge);
  tile.appendChild(volControl);
  tile.appendChild(fullscreenBtn);
  videoGrid.appendChild(tile);
  videoTiles.set(peerId, tile);

  updateGridLayout();
}

function removeVideoTile(peerId) {
  const tile = videoTiles.get(peerId);
  if (tile) {
    const video = tile.querySelector('video');
    if (video) video.srcObject = null;
    tile.remove();
    videoTiles.delete(peerId);
  }
  if (videoTiles.size === 0) {
    emptyState.classList.remove('hidden');
  }
  updateGridLayout();
}

function updateGridLayout() {
  // Handled automatically by CSS grid auto-fit
}

function startWatchingStream(peerId) {
  inPeers.set(peerId, { pc: null, iceQueue: [] });
  socket.emit('request-stream', { to: peerId });
  updateParticipantsUI();
}

function stopWatchingStream(peerId) {
  socket.emit('stop-watching', { to: peerId });
  removeInPeer(peerId);
  removeVideoTile(peerId);
  updateParticipantsUI();
}

/* =====================================================================
   8. PARTICIPANTS UI
   ===================================================================== */

function updateParticipantsUI() {
  partList.innerHTML = '';
  let count = 0;

  for (const [id, p] of participants) {
    count++;
    const li = document.createElement('li');

    const avatarImg = document.createElement('img');
    avatarImg.src = p.avatar;
    avatarImg.alt = 'avatar';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'participant-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'participant-name';
    nameSpan.textContent = p.nickname + (id === myId ? ' (você)' : '');

    const statusSpan = document.createElement('span');
    statusSpan.className = 'participant-status' + (p.sharing ? ' sharing-indicator' : '');
    statusSpan.textContent = p.sharing ? '📺 Compartilhando' : '👁️ Assistindo';

    infoDiv.appendChild(nameSpan);
    infoDiv.appendChild(statusSpan);

    // Mostra qualidade atual se for o próprio usuário e estiver compartilhando
    if (id === myId && isSharing) {
      const qualityBadge = document.createElement('div');
      qualityBadge.className = 'stream-indicator-badge';
      qualityBadge.innerHTML = `
        <span class="stream-icon">⚡</span>
        <span class="stream-text">${QUALITY_PRESETS[currentQuality].label}</span>
      `;
      infoDiv.appendChild(qualityBadge);
    }

    li.appendChild(avatarImg);
    li.appendChild(infoDiv);

    if (p.sharing && id !== myId) {
      const isWatching = inPeers.has(id);
      const watchBtn = document.createElement('button');
      watchBtn.className = 'btn-watch' + (isWatching ? ' watching-active' : '');
      watchBtn.textContent = isWatching ? 'Parar' : 'Assistir';
      watchBtn.addEventListener('click', () => {
        if (isWatching) {
          stopWatchingStream(id);
        } else {
          startWatchingStream(id);
        }
      });
      li.appendChild(watchBtn);
    }

    partList.appendChild(li);
  }

  partCount.textContent = `${count} online`;
}

// ─── Sidebar toggle ────────────────────────────────────────
btnSidebar.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

/* =====================================================================
   9. INITIALIZATION
   ===================================================================== */

// Inicializa controle de qualidade após DOM ready
initQualityControl();

/* =====================================================================
   10. UTILITIES
   ===================================================================== */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

  return str.replace(/"/g, '"');
  return str.replace(/"/g, '"');
}