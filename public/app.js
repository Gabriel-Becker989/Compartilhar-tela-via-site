/* =====================================================================
 *  Screen Share Collab — Frontend (LiveKit Cloud SDK)
 *  ===================================================================== */

// ─── DOM refs ──────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const roomScreen    = document.getElementById('room-screen');
const avatarInput   = document.getElementById('avatar-input');
const avatarPreview = document.getElementById('avatar-preview');
const roomInput     = document.getElementById('room-input');
const nameInput     = document.getElementById('name-input');
const passwordInput = document.getElementById('password-input');
const joinBtn       = document.getElementById('join-btn');
const loginError    = document.getElementById('login-error');
const btnShare      = document.getElementById('btn-share');
const btnStop       = document.getElementById('btn-stop');
const partList      = document.getElementById('participants-list');
const partCount     = document.getElementById('participant-count');
const remoteVideo   = document.getElementById('remoteVideo');

// ─── Estado do LiveKit ─────────────────────────────────────
let livekitUrl        = '';
let accessToken       = '';
let myRoomName        = '';
let myParticipantName = '';
let myRoom            = null;

// ─── Default avatar ──────────────────────────────────────────
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="%235865f2"/>' +
  '<text x="50" y="62" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">😊</text>' +
  '</svg>'
);

if (avatarPreview) {
  avatarPreview.src = DEFAULT_AVATAR;
}

/* =====================================================================
 *  1. LOGIN / JOIN SCREEN
 *  ===================================================================== */

joinBtn.addEventListener('click', async () => {
  const roomName = roomInput ? roomInput.value.trim() : 'sala-principal';
  const participantName = nameInput ? nameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const avatarFile = avatarInput && avatarInput.files ? avatarInput.files[0] : null;

  // Validações
  if (!participantName) {
    showLoginError('Por favor, insira seu nome.');
    return;
  }
  if (password !== 'ovo') {
    showLoginError('Senha incorreta! A senha da sala é sempre "ovo".');
    return;
  }

  let avatarDataUrl = '';
  if (avatarFile) {
    const reader = new FileReader();
    reader.onload = (e) => {
      avatarDataUrl = e.target.result;
      if (avatarPreview) avatarPreview.src = avatarDataUrl;
      iniciarLogin(roomName, participantName, password, avatarDataUrl);
    };
    reader.readAsDataURL(avatarFile);
  } else {
    if (avatarPreview) avatarPreview.src = DEFAULT_AVATAR;
    iniciarLogin(roomName, participantName, password, '');
  }
});

/**
 * Centraliza o fluxo de login e conexão ao LiveKit Cloud
 */
async function iniciarLogin(roomName, participantName, password, avatarDataUrl) {
  myRoomName = roomName;
  myParticipantName = participantName;

  // 1. Busca o JWT token via Serverless Function
  try {
    const res = await fetch(`/api/get-token?roomName=${encodeURIComponent(roomName)}&participantName=${encodeURIComponent(participantName)}&password=${encodeURIComponent(password)}&avatar=${encodeURIComponent(avatarDataUrl)}`);

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Erro ao obter token');
    }

    const data = await res.json();
    accessToken = data.token;
    livekitUrl  = data.url;
  } catch (err) {
    console.error('[login] Erro ao buscar token:', err);
    showLoginError(err.message || 'Não foi possível conectar ao servidor.');
    return;
  }

  // 2. Instancia e conecta na Room do LiveKit Cloud
  try {
    const room = new LivekitClient.Room();
    myRoom = room;

    // Escutar faixas de vídeo recebidas
    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === LivekitClient.Track.Kind.Video && remoteVideo) {
        track.attach(remoteVideo); // Anexa o vídeo usando a SDK nativa
      }
    });

    // Escutar faixas removidas
    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      if (remoteVideo) {
        track.detach(remoteVideo);
      }
    });

    // Atualização da lista de participantes
    room.on(LivekitClient.RoomEvent.ParticipantConnected, () => updateParticipantsUI());
    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => updateParticipantsUI());

    room.on(LivekitClient.RoomEvent.Disconnected, () => {
      disconnectRoom();
    });

    // Conectar à sala
    await room.connect(livekitUrl, accessToken);

    // 3. Atualizar telas
    if (loginScreen) loginScreen.classList.remove('active');
    if (roomScreen) roomScreen.classList.add('active');
    updateParticipantsUI();

  } catch (err) {
    console.error('[login] Erro inesperado ao conectar:', err);
    showLoginError('Erro ao conectar na sala do LiveKit.');
  }
}

/* =====================================================================
 *  2. CONTROLES DE COMPARTILHAMENTO DE TELA
 *  ===================================================================== */

if (btnShare) {
  btnShare.addEventListener('click', async () => {
    if (myRoom) {
      try {
        await myRoom.localParticipant.setScreenShareEnabled(true);
        if (btnShare) btnShare.disabled = true;
        if (btnStop) btnStop.disabled = false;
      } catch (err) {
        console.error('[screen-share] Erro ao compartilhar:', err);
      }
    }
  });
}

if (btnStop) {
  btnStop.addEventListener('click', async () => {
    if (myRoom) {
      await myRoom.localParticipant.setScreenShareEnabled(false);
      if (btnShare) btnShare.disabled = false;
      if (btnStop) btnStop.disabled = true;
    }
  });
}

/* =====================================================================
 *  3. DESCONEXÃO E NAVEGAÇÃO
 *  ===================================================================== */

function disconnectRoom() {
  if (myRoom) {
    myRoom.disconnect();
    myRoom = null;
  }
  if (loginScreen) loginScreen.classList.add('active');
  if (roomScreen) roomScreen.classList.remove('active');
  updateParticipantsUI();
}

/* =====================================================================
 *  4. INTERFACE DE PARTICIPANTES
 *  ===================================================================== */

function updateParticipantsUI() {
  if (!partList) return;
  partList.innerHTML = '';
  let count = 0;

  if (myRoom && myRoom.remoteParticipants) {
    count = myRoom.remoteParticipants.size + 1; // Inclui o participante local

    myRoom.remoteParticipants.forEach((participant) => {
      const li = document.createElement('li');
      li.textContent = participant.identity;
      partList.appendChild(li);
    });
  }

  if (partCount) {
    partCount.textContent = `${count} online`;
  }
}

function showLoginError(msg) {
  if (loginError) {
    loginError.textContent = msg;
    setTimeout(() => { loginError.textContent = ''; }, 4000);
  }
}
