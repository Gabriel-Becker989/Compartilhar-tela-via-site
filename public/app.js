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
const btnLeave      = document.getElementById('btn-leave');
const loginError    = document.getElementById('login-error');
const btnShare      = document.getElementById('btn-share');
const btnStop       = document.getElementById('btn-stop');
const partList      = document.getElementById('participants-list');
const partCount     = document.getElementById('participant-count');
const remoteVideo   = document.getElementById('remoteVideo');
const emptyState    = document.getElementById('empty-state');
const roomNameBadge = document.getElementById('room-name-badge');

// ─── Estado do LiveKit ─────────────────────────────────────
let myRoom = null;

// Avatar Padrão
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="%235865f2"/>' +
  '<text x="50" y="62" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">😊</text>' +
  '</svg>'
);

// Preview dinâmico de troca de foto
if (avatarInput) {
  avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && avatarPreview) {
      const reader = new FileReader();
      reader.onload = (event) => {
        avatarPreview.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  });
}

// ─── Login e Entrada na Sala ──────────────────────────────
if (joinBtn) {
  joinBtn.addEventListener('click', async () => {
    const roomName = roomInput ? roomInput.value.trim() : 'sala-principal';
    const participantName = nameInput ? nameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value.trim() : '';
    const avatarFile = avatarInput && avatarInput.files ? avatarInput.files[0] : null;

    if (!participantName) {
      showLoginError('Por favor, insira seu nome de usuário.');
      return;
    }

    if (password !== 'ovo') {
      showLoginError('Senha incorreta! A senha é "ovo".');
      return;
    }

    let avatarDataUrl = '';
    if (avatarFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        avatarDataUrl = e.target.result;
        iniciarLogin(roomName, participantName, password, avatarDataUrl);
      };
      reader.readAsDataURL(avatarFile);
    } else {
      iniciarLogin(roomName, participantName, password, DEFAULT_AVATAR);
    }
  });
}
async function iniciarLogin(roomName, participantName, password, avatarDataUrl) {
  try {
    const res = await fetch(`/api/get-token?roomName=${encodeURIComponent(roomName)}&participantName=${encodeURIComponent(participantName)}&password=${encodeURIComponent(password)}&avatar=${encodeURIComponent(avatarDataUrl)}`);

    // Verifica se a resposta do servidor não é OK ou se retornou HTML de erro
    const contentType = res.headers.get("content-type");
    if (!res.ok || !contentType || !contentType.includes("application/json")) {
      const textError = await res.text();
      console.error('[login] Resposta do servidor não-JSON:', textError);
      throw new Error('Falha no servidor. Verifique as chaves no painel da Vercel.');
    }

    const { token, url } = await res.json();

    const room = new LivekitClient.Room();
    myRoom = room;

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === LivekitClient.Track.Kind.Video && remoteVideo) {
        track.attach(remoteVideo);
        remoteVideo.classList.remove('hidden');
        if (emptyState) emptyState.classList.add('hidden');
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      if (remoteVideo) {
        track.detach(remoteVideo);
        remoteVideo.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
      }
    });

    room.on(LivekitClient.RoomEvent.ParticipantConnected, () => updateParticipantsUI());
    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => updateParticipantsUI());
    room.on(LivekitClient.RoomEvent.Disconnected, () => disconnectRoom());

    await room.connect(url, token);

    if (loginScreen) loginScreen.classList.remove('active');
    if (roomScreen) roomScreen.classList.add('active');
    if (roomNameBadge) roomNameBadge.textContent = roomName;

    updateParticipantsUI();

  } catch (err) {
    console.error('[login] Erro:', err);
    showLoginError(err.message || 'Falha ao conectar no LiveKit.');
  }
}

// ─── Botões de Controle ──────────────────────────────────
if (btnShare) {
  btnShare.addEventListener('click', async () => {
    if (myRoom) {
      try {
        await myRoom.localParticipant.setScreenShareEnabled(true);
        btnShare.classList.add('hidden');
        if (btnStop) btnStop.classList.remove('hidden');
      } catch (err) {
        console.error('Erro ao compartilhar tela:', err);
      }
    }
  });
}

if (btnStop) {
  btnStop.addEventListener('click', async () => {
    if (myRoom) {
      await myRoom.localParticipant.setScreenShareEnabled(false);
      btnStop.classList.add('hidden');
      if (btnShare) btnShare.classList.remove('hidden');
    }
  });
}

if (btnLeave) {
  btnLeave.addEventListener('click', () => disconnectRoom());
}

function disconnectRoom() {
  if (myRoom) {
    myRoom.disconnect();
    myRoom = null;
  }
  if (loginScreen) loginScreen.classList.add('active');
  if (roomScreen) roomScreen.classList.remove('active');
}

function updateParticipantsUI() {
  if (!partList) return;
  partList.innerHTML = '';
  let count = 0;

  if (myRoom && myRoom.remoteParticipants) {
    count = myRoom.remoteParticipants.size + 1;
    myRoom.remoteParticipants.forEach((participant) => {
      const li = document.createElement('li');
      li.textContent = participant.identity;
      partList.appendChild(li);
    });
  }

  if (partCount) partCount.textContent = `${count} online`;
}

function showLoginError(msg) {
  if (loginError) {
    loginError.textContent = msg;
    setTimeout(() => { loginError.textContent = ''; }, 4000);
  }
}
