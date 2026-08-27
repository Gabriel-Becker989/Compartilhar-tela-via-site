/* =====================================================================
 *  Screen Share Collab — Frontend (LiveKit Cloud SDK)
 *  ===================================================================== */

const loginScreen   = document.getElementById('login-screen');
const roomScreen    = document.getElementById('room-screen');
const avatarInput   = document.getElementById('avatar-input');
const avatarPreview = document.getElementById('avatar-preview');
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
const videoWrapper  = document.getElementById('video-wrapper');
const emptyState    = document.getElementById('empty-state');

// Novos elementos de controle
const qualitySelect = document.getElementById('quality-select');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnMute       = document.getElementById('btn-mute');
const volumeSlider  = document.getElementById('volume-slider');

let myRoom = null;

const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="%235865f2"/>' +
  '<text x="50" y="65" text-anchor="middle" fill="white" font-size="50" font-family="sans-serif">🦈</text>' +
  '</svg>'
);

if (avatarPreview) avatarPreview.src = DEFAULT_AVATAR;

if (avatarInput) {
  avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && avatarPreview) {
      const reader = new FileReader();
      reader.onload = (event) => { avatarPreview.src = event.target.result; };
      reader.readAsDataURL(file);
    }
  });
}

// ─── Login ──────────────────────────────────────────────
if (joinBtn) {
  joinBtn.addEventListener('click', async () => {
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
      reader.onload = (e) => { iniciarLogin('sala-principal', participantName, password, e.target.result); };
      reader.readAsDataURL(avatarFile);
    } else {
      iniciarLogin('sala-principal', participantName, password, DEFAULT_AVATAR);
    }
  });
}

async function iniciarLogin(roomName, participantName, password, avatarDataUrl) {
  try {
    const res = await fetch(`/api/get-token?roomName=${encodeURIComponent(roomName)}&participantName=${encodeURIComponent(participantName)}&password=${encodeURIComponent(password)}&avatar=${encodeURIComponent(avatarDataUrl)}`);
    const { token, url } = await res.json();

    const room = new LivekitClient.Room();
    myRoom = room;

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === LivekitClient.Track.Kind.Video && remoteVideo) {
        track.attach(remoteVideo);
        if (videoWrapper) videoWrapper.classList.remove('hidden');
        if (emptyState) emptyState.classList.add('hidden');
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      if (remoteVideo) {
        track.detach(remoteVideo);
        if (videoWrapper) videoWrapper.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
      }
    });

    room.on(LivekitClient.RoomEvent.ParticipantConnected, () => updateParticipantsUI());
    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => updateParticipantsUI());
    room.on(LivekitClient.RoomEvent.Disconnected, () => disconnectRoom());

    await room.connect(url, token);

    if (loginScreen) loginScreen.classList.remove('active');
    if (roomScreen) roomScreen.classList.add('active');
    updateParticipantsUI();

  } catch (err) {
    console.error('[login] Erro:', err);
    showLoginError('Falha ao conectar no LiveKit.');
  }
}

// ─── Seleção de Qualidade e Transmissão ─────────────────────
function getQualityPresets(qualityKey) {
  switch (qualityKey) {
    case '1080p60':
      return { width: 1920, height: 1080, frameRate: 60 };
    case '480p30':
      return { width: 854, height: 480, frameRate: 30 };
    case '720p30':
    default:
      return { width: 1280, height: 720, frameRate: 30 };
  }
}

if (btnShare) {
  btnShare.addEventListener('click', async () => {
    if (myRoom) {
      try {
        const qualityKey = qualitySelect ? qualitySelect.value : '720p30';
        const resolution = getQualityPresets(qualityKey);

        await myRoom.localParticipant.setScreenShareEnabled(true, {
          audio: true,
          resolution: resolution,
        });

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

// ─── Controles de Volume e Fullscreen ───────────────────────
if (volumeSlider && remoteVideo) {
  volumeSlider.addEventListener('input', (e) => {
    remoteVideo.volume = e.target.value;
    if (btnMute) btnMute.textContent = e.target.value == 0 ? '🔇' : '🔊';
  });
}

if (btnMute && remoteVideo) {
  btnMute.addEventListener('click', () => {
    remoteVideo.muted = !remoteVideo.muted;
    btnMute.textContent = remoteVideo.muted ? '🔇' : '🔊';
    if (volumeSlider) volumeSlider.value = remoteVideo.muted ? 0 : remoteVideo.volume;
  });
}

if (btnFullscreen && videoWrapper) {
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      videoWrapper.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
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
  if (!partList || !myRoom) return;
  partList.innerHTML = '';
  let totalOnline = 0;

  if (myRoom.localParticipant) {
    totalOnline++;
    const li = document.createElement('li');
    li.textContent = `${myRoom.localParticipant.identity} (Você)`;
    partList.appendChild(li);
  }

  if (myRoom.remoteParticipants) {
    myRoom.remoteParticipants.forEach((participant) => {
      totalOnline++;
      const li = document.createElement('li');
      li.textContent = participant.identity;
      partList.appendChild(li);
    });
  }

  if (partCount) partCount.textContent = `${totalOnline} online`;
}

function showLoginError(msg) {
  if (loginError) {
    loginError.textContent = msg;
    setTimeout(() => { loginError.textContent = ''; }, 4000);
  }
}
