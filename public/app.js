/* =====================================================================
   Screen Share Collab — Frontend (LiveKit Cloud SDK)
   ===================================================================== */

// ─── DOM refs ──────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const roomScreen    = document.getElementById('room-screen');
const avatarInput   = document.getElementById('avatar-input');
const avatarPreview = document.getElementById('avatar-preview');
const nicknameInput = document.getElementById('nickname-input');
const roomInput     = document.getElementById('room-input'); // Novo: input de nome da sala
const nameInput     = document.getElementById('name-input'); // Novo: input de nome do participante
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
const remoteVideo   = document.getElementById('remoteVideo'); // Novo: vídeo remoto

// ─── Estado da LiveKit ─────────────────────────────────────
let livekitUrl   = '';        // URL do servidor LiveKit (wss://...)
let accessToken  = '';        // JWT token
let myRoomName   = '';        // Nome da sala atual
let myParticipantName = '';   // Nome do participante atual
let myRoom       = null;      // Instância da Room do LiveKit

// Peer connections & related data - removidas; usando LiveKit SDK ao invés disso

// ─── Default avatar ──────────────────────────────────────────
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="%235865f2"/>' +
  '<text x="50" y="62" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">😊</text>' +
  '</svg>'
);

avatarPreview.src = DEFAULT_AVATAR;

/* =====================================================================
   1. LOGIN / JOIN SCREEN
   ===================================================================== */

joinBtn.addEventListener('click', async () => {
  const roomName = roomInput.value.trim() || 'sala-principal';
  const participantName = nameInput.value.trim();

  if (!participantName) {
    showLoginError('Por favor, insira seu nome.');
    return;
  }

  myRoomName   = roomName;
  myParticipantName = participantName;

  // 1. Busca JWT token via serverless function
  try {
    const res = await fetch(`/api/get-token?roomName=${encodeURIComponent(roomName)}&participantName=${encodeURIComponent(participantName)}`);
    if (!res.ok) throw new Error('Erro ao obter token');
    const data = await res.json();
    accessToken = data.token;
    livekitUrl  = data.url;
  } catch (err) {
    console.error('[login] Erro ao buscar token:', err);
    showLoginError('Não foi possível conectar ao servidor. Tente novamente.');
    return;
  }

  // 2. Instancia e conecta na Room do LiveKit
  try {
    const room = new LivekitClient.Room();
    myRoom = room;

    await room.connect(livekitUrl, accessToken, {
      // optional: você pode adicionar tracks aqui ou deixe o host compartilhar
    });

    // Eventos da room
    room.on('participantConnected', (participant) => {
      console.log('[room] Participante conectado:', participant.identity);
      updateParticipantsUI();
    });

    room.on('participantDisconnected', (participant) => {
      console.log('[room] Participante desconectado:', participant.identity);
      removeParticipantUI(participant.identity);
    });

    room.on('trackSubscribed', (track, participant) => {
      // Apenas vídeo: anexa ao elemento <video>
      if (track.kind === 'video') {
        remoteVideo.srcObject = track;
        remoteVideo.playsInline = true;
        remoteVideo.muted = true; // evita feedback/echo
        remoteVideo.play().catch(() => console.warn('[track] autoplay bloqueado'));
      }
    });

    room.on('trackPublished', (track, participant) => {
      console.log('[room] Track published por', participant.identity, 'kind:', track.kind);
    });

    room.on('connectionStateChanged', (state) => {
      console.log('[room] Connection state:', state);
      if (state === 'disconnected' || state === 'failed') {
        showLoginError('Conexão perdida. Recarregue a página para tentar novamente.');
        disconnectRoom();
      }
    });

    room.on('error', (error) => {
      console.error('[room] Erro:', error);
    });

    // 3. Mostra tela da room, esconde login
    loginScreen.classList.remove('active');
    roomScreen.classList.add('active');
    updateRoomUI(roomName);

    // 4. Habilita compartilhamento de tela (apenas para o próprio participante)
    // Isso pedirá ao navegador para solicitar screen sharing
    room.localParticipant.setScreenShareEnabled(true).then((track) => {
      console.log('[screen-share] Share enabled, track added to local room');
      // O track de screen share já será publicado automaticamente
    }).catch((err) => {
      console.error('[screen-share] Erro ao habilitar share:', err);
      showLoginError('Não foi possível iniciar o compartilhamento de tela. Verifique permissões.');
    });

  } catch (err) {
    console.error('[login] Erro inesperado:', err);
    showLoginError('Erro inesperado ao conectar na sala.');
  }
});

/* =====================================================================
   2. SHARE / STOP
   ===================================================================== */

btnShare.addEventListener('click', () => {
  // O share já foi habilitado no connect(); se necessário, pode re-aplicar
  if (myRoom) {
    myRoom.localParticipant.setScreenShareEnabled(true);
  }
});

btnStop.addEventListener('click', () => {
  if (myRoom) {
    myRoom.localParticipant.setScreenShareEnabled(false);
    myRoom.disconnect();
  }
});

/* =====================================================================
   3. DESCONEXÃO
   ===================================================================== */

function disconnectRoom() {
  if (myRoom) {
    myRoom.disconnect();
    myRoom = null;
  }
  loginScreen.classList.add('active');
  roomScreen.classList.remove('active');
  updateParticipantsUI();
  emptyState.classList.remove('hidden');
}

/* =====================================================================
   4. QUALITY CONTROL (Engrenagem dropdown)
   ===================================================================== */

// Durante o shared, o host pode mudar o preset via dropdown
btnQuality.addEventListener('click', (e) => {
  e.stopPropagation();
  qualityDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  qualityDropdown.classList.add('hidden');
});

qualityDropdown.addEventListener('click', (e) => e.stopPropagation());

qualitySelect.addEventListener('change', async (e) => {
  const qualityKey = e.target.value;
  // Nota: no LiveKit Cloud, as constraints de bitrate/resolução são
  // definidas no momento da captura (getUserMedia/setConstraints).
  // O host já selecionou a qualidade antes de iniciar o share.
  // Aqui apenas atualizamos o display; a mudança real requer reiniciar o share.
  qualityDropdown.classList.add('hidden');
});

/* =====================================================================
   5. PARTICIPANTES UI
   ===================================================================== */

function updateParticipantsUI() {
  partList.innerHTML = '';
  let count = 0;

  // Conta participantes conectados na room
  if (myRoom) {
    const participants = myRoom.participants;
    for (const [id, participant] of participants) {
      count++;
      const li = document.createElement('li');
      li.textContent = participant.displayName || participant.identity;
      const status = document.createElement('span');
      status.className = 'participant-status';
      status.textContent = participant.isConnected ? 'online' : 'offline';
      li.appendChild(status);
      partList.appendChild(li);
    }
  }

  partCount.textContent = `${count} online`;
}

function updateRoomUI(roomName) {
  roomNameBadge.textContent = roomName;
}

/* =====================================================================
   6. UTILITIES
   ===================================================================== */

function showLoginError(msg) {
  loginError.textContent = msg;
  setTimeout(() => { loginError.textContent = ''; }, 4000);
}

/* =====================================================================
   7. INITIALIZATION
   ===================================================================== */

// O init é feito no click do #joinBtn; não precisa de chamado extra.

/* =====================================================================
   8. UTILITIES (antigas)
   ===================================================================== */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '"');
}