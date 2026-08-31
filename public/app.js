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
const videoGrid     = document.getElementById('video-grid');
const emptyState    = document.getElementById('empty-state');
const qualitySelect = document.getElementById('quality-select');

let myRoom = null;
const activeSubscribedSids = new Set();

// Define a URL base da Vercel para compatibilidade com Electron e Web
const VERCEL_API_URL = window.location.protocol.startsWith('http')
? ''
: 'https://compartilhar-tela-via-site.vercel.app';

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
    const res = await fetch(`${VERCEL_API_URL}/api/get-token?roomName=${encodeURIComponent(roomName)}&participantName=${encodeURIComponent(participantName)}&password=${encodeURIComponent(password)}&avatar=${encodeURIComponent(avatarDataUrl)}`);
    const { token, url } = await res.json();

    const room = new LivekitClient.Room({
      autoSubscribe: false, // Desativa assinatura automática
    });
    myRoom = room;

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (activeSubscribedSids.has(participant.sid)) {
        renderTrack(track, participant);
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      removeTrack(track, participant);
    });

    room.on(LivekitClient.RoomEvent.TrackPublished, () => updateParticipantsUI());
    room.on(LivekitClient.RoomEvent.TrackUnpublished, (pub, participant) => {
      activeSubscribedSids.delete(participant.sid);
      removeWrapper(participant.sid);
      updateParticipantsUI();
    });

    room.on(LivekitClient.RoomEvent.ParticipantConnected, () => updateParticipantsUI());
    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
      activeSubscribedSids.delete(participant.sid);
      removeWrapper(participant.sid);
      updateParticipantsUI();
    });
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

// ─── Criação e Remoção de Quadrados de Vídeo ────────────────
function renderTrack(track, participant) {
  if (emptyState) emptyState.classList.add('hidden');

  let wrapper = document.getElementById(`wrapper-${participant.sid}`);
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = `wrapper-${participant.sid}`;
    wrapper.className = 'video-wrapper';

    const tag = document.createElement('div');
    tag.className = 'stream-owner-tag';
    tag.textContent = participant.identity;
    wrapper.appendChild(tag);

    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';

    const controlsTop = document.createElement('div');
    controlsTop.className = 'video-controls-top';

    const volContainer = document.createElement('div');
    volContainer.className = 'volume-container';

    const btnMute = document.createElement('button');
    btnMute.className = 'overlay-btn';
    btnMute.textContent = '🔊';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = '1';

    volContainer.appendChild(btnMute);
    volContainer.appendChild(slider);

    const btnFullscreen = document.createElement('button');
    btnFullscreen.className = 'overlay-btn';
    btnFullscreen.textContent = '⛶';

    controlsTop.appendChild(volContainer);
    controlsTop.appendChild(btnFullscreen);
    overlay.appendChild(controlsTop);
    wrapper.appendChild(overlay);

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    wrapper.appendChild(videoEl);

    slider.addEventListener('input', (e) => {
      videoEl.volume = e.target.value;
      btnMute.textContent = e.target.value == 0 ? '🔇' : '🔊';
    });

    btnMute.addEventListener('click', () => {
      videoEl.muted = !videoEl.muted;
      btnMute.textContent = videoEl.muted ? '🔇' : '🔊';
      slider.value = videoEl.muted ? 0 : videoEl.volume;
    });

    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        wrapper.requestFullscreen().catch(err => console.error(err));
      } else {
        document.exitFullscreen();
      }
    });

    videoGrid.appendChild(wrapper);
  }

  const videoEl = wrapper.querySelector('video');
  if (track) {
    track.attach(videoEl);
    if (track.kind === LivekitClient.Track.Kind.Audio) {
      videoEl.muted = false;
    }
  }
}

function removeTrack(track, participant) {
  const wrapper = document.getElementById(`wrapper-${participant.sid}`);
  if (wrapper) {
    const videoEl = wrapper.querySelector('video');
    if (videoEl && track) track.detach(videoEl);
  }
}

function removeWrapper(participantSid) {
  const wrapper = document.getElementById(`wrapper-${participantSid}`);
  if (wrapper) wrapper.remove();

  const remainingWrappers = videoGrid.querySelectorAll('.video-wrapper');
  if (remainingWrappers.length === 0 && emptyState) {
    emptyState.classList.remove('hidden');
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
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
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

if (btnLeave) {
  btnLeave.addEventListener('click', () => disconnectRoom());
}

function disconnectRoom() {
  activeSubscribedSids.clear();
  if (myRoom) {
    myRoom.disconnect();
    myRoom = null;
  }
  if (loginScreen) loginScreen.classList.add('active');
  if (roomScreen) roomScreen.classList.remove('active');
}

// ─── Lista de Participantes e Botão Independente ─────────────
function updateParticipantsUI() {
  if (!partList || !myRoom) return;
  partList.innerHTML = '';
  let totalOnline = 0;

  // 1. Participante Local (Você)
  if (myRoom.localParticipant) {
    totalOnline++;
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'participant-name-text';
    nameSpan.textContent = `${myRoom.localParticipant.identity} (Você)`;
    li.appendChild(nameSpan);
    partList.appendChild(li);
  }

  // 2. Participantes Remotos
  if (myRoom.remoteParticipants) {
    myRoom.remoteParticipants.forEach((participant) => {
      totalOnline++;
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'participant-name-text';
      nameSpan.textContent = participant.identity;
      li.appendChild(nameSpan);

      let hasScreenShare = false;
      participant.videoTrackPublications.forEach((pub) => {
        if (pub.source === LivekitClient.Track.Source.ScreenShare || pub.trackName === 'screen') {
          hasScreenShare = true;
        }
      });

      if (hasScreenShare) {
        const watchBtn = document.createElement('button');
        const isWatching = activeSubscribedSids.has(participant.sid);

        if (isWatching) {
          // ESTADO: Assistindo -> Botão Vermelho para fechar
          watchBtn.className = 'btn-watch-stream stop';
          watchBtn.textContent = '❌';
          watchBtn.title = 'Parar de assistir transmissão';

          watchBtn.addEventListener('click', () => {
            activeSubscribedSids.delete(participant.sid);

            // Cancela assinatura das publicações de áudio e vídeo
            participant.videoTrackPublications.forEach((pub) => pub.setSubscribed(false));
            participant.audioTrackPublications.forEach((pub) => pub.setSubscribed(false));

            removeWrapper(participant.sid);
            updateParticipantsUI();
          });
        } else {
          // ESTADO: Não assistindo -> Botão Verde com câmera para abrir
          watchBtn.className = 'btn-watch-stream start';
          watchBtn.textContent = '🎥';
          watchBtn.title = 'Clique para assistir a transmissão';

          watchBtn.addEventListener('click', () => {
            activeSubscribedSids.add(participant.sid);

            // Assina as publicações de vídeo e áudio do participante
            participant.videoTrackPublications.forEach((pub) => {
              pub.setSubscribed(true);
              if (pub.track) {
                renderTrack(pub.track, participant);
              }
            });

            participant.audioTrackPublications.forEach((pub) => {
              pub.setSubscribed(true);
              if (pub.track) {
                renderTrack(pub.track, participant);
              }
            });

            updateParticipantsUI();
          });
        }

        li.appendChild(watchBtn);
      }

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
