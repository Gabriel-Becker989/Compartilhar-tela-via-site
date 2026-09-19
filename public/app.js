/* =====================================================================
 *  Screen Share Collab — Frontend (LiveKit Cloud SDK + WASAPI Audio)
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
const effectiveQualityBadge = document.getElementById('effective-quality-badge');

// Audio capture elements
const audioSourceSelect = document.getElementById('audio-source-select');
const audioProcessSelect = document.getElementById('audio-process-select');
const audioProcessWrapper = document.getElementById('audio-process-wrapper');
const refreshProcessesBtn = document.getElementById('refresh-processes-btn');
const audioStatusBadge = document.getElementById('audio-status-badge');

let myRoom = null;
const activeSubscribedSids = new Set();

// Audio capture state
let audioCaptureEnabled = false;
let audioTrack = null;
let audioContext = null;
let audioWorkletNode = null;
let sourceNode = null;

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

// Redimensiona a foto de perfil para evitar tokens/URLs gigantes
// (o avatar viaja dentro do metadata do token JWT e da query string).
function resizeAvatar(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const SIZE = 128;
          const scale = Math.min(1, SIZE / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          let dataUrl = canvas.toDataURL('image/png');
          if (dataUrl.length > 24 * 1024) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          }
          resolve(dataUrl);
        } catch (e) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = reader.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

// ─── Avatar dos participantes ───────────────────────────
// O /api/get-token grava { avatar } no metadata do participante.
function getParticipantAvatar(participant) {
  let avatar = '';
  try {
    const meta = participant && participant.metadata ? JSON.parse(participant.metadata) : null;
    if (meta && meta.avatar) avatar = meta.avatar;
  } catch (e) { /* metadata inválida — usa default */ }
  return avatar || DEFAULT_AVATAR;
}

function createParticipantAvatar(participant, cls) {
  const img = document.createElement('img');
  img.className = cls || 'participant-avatar';
  img.src = getParticipantAvatar(participant);
  img.alt = '';
  return img;
}

if (avatarInput) {
  avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && avatarPreview) {
      resizeAvatar(file).then((url) => { if (url) avatarPreview.src = url; });
    }
  });
}

// ============================================================================
// AUDIO CAPTURE INTEGRATION
// ============================================================================

let audioCaptureState = {
    isCapturing: false,
    selectedSource: 'system', // 'window', 'system', 'none'
    selectedProcessId: null,
    processList: []
};

// Screen share state
let screenShareStream = null;
let screenSharePublication = null;
let screenShareAudioPublication = null;
let selectedScreenSourceId = null;

async function loadProcessList() {
    try {
        const processes = await window.audioCapture?.getProcessList?.() ||
                          await window.electronAPI?.getProcessList?.();
        
        if (processes && audioProcessSelect) {
            audioProcessSelect.innerHTML = '<option value="">Selecione um processo...</option>';
            processes.forEach(proc => {
                const option = document.createElement('option');
                option.value = proc.processId;
                option.textContent = `${proc.processName} — ${proc.windowTitle || 'Sem título'} (PID: ${proc.processId})`;
                audioProcessSelect.appendChild(option);
            });
            audioCaptureState.processList = processes;
        }
    } catch (err) {
        console.error('Erro ao carregar processos:', err);
    }
}

function updateAudioUI() {
    if (!audioProcessSelect || !audioSourceSelect) return;
    
    const source = audioCaptureState.selectedSource;
    
    if (source === 'window') {
        if (audioProcessWrapper) audioProcessWrapper.classList.remove('hidden');
        loadProcessList();
    } else {
        if (audioProcessWrapper) audioProcessWrapper.classList.add('hidden');
    }
    
    // Update status badge
    if (audioStatusBadge) {
        const labels = {
            'window': `🎮 Janela: ${audioCaptureState.selectedProcessId ? audioCaptureState.processList.find(p => p.processId === audioCaptureState.selectedProcessId)?.processName || `PID ${audioCaptureState.selectedProcessId}` : 'Selecione...'}`,
            'system': '🔊 Som do Sistema',
            'none': '🔇 Sem Áudio'
        };
        audioStatusBadge.textContent = labels[source] || 'Áudio';
        audioStatusBadge.className = 'audio-status-badge ' + (source === 'none' ? 'muted' : '');
    }
}

// Initialize audio source selector
if (audioSourceSelect) {
    audioSourceSelect.addEventListener('change', (e) => {
        audioCaptureState.selectedSource = e.target.value;
        audioCaptureState.selectedProcessId = null;
        updateAudioUI();
    });
}

if (audioProcessSelect) {
    audioProcessSelect.addEventListener('change', (e) => {
        audioCaptureState.selectedProcessId = parseInt(e.target.value) || null;
        updateAudioUI();
    });
}

if (refreshProcessesBtn) {
    refreshProcessesBtn.addEventListener('click', loadProcessList);
}

// Initialize audio UI on load
updateAudioUI();

// ============================================================================
// AUDIO CAPTURE - Native Module Integration
// ============================================================================

async function startAudioCapture() {
    if (audioCaptureState.isCapturing) return;
    
    const source = audioCaptureState.selectedSource;
    
    if (source === 'none') {
        return { success: true, track: null }; // No audio
    }
    
    let config = {
        processId: 0,
        includeProcessTree: true,
        sampleRate: 48000,
        channels: 2,
        bitDepth: 32, // IEEE_FLOAT
        bufferDurationMs: 10 // menor latência (event-driven will deliver ~10ms cadence)
    };
    
    if (source === 'window') {
        if (!audioCaptureState.selectedProcessId) {
            throw new Error('Selecione um processo/janela para capturar áudio');
        }
        config.processId = audioCaptureState.selectedProcessId;
    } else if (source === 'system') {
        config.processId = 0; // 0 = system default loopback
    }
    
    try {
        // Call native module via preload bridge
        if (window.audioCapture && window.audioCapture.startCapture) {
            await window.audioCapture.startCapture(config);
        } else if (window.electronAPI) {
            await window.electronAPI.startCapture(config);
        } else {
            throw new Error('Módulo de áudio nativo não disponível');
        }

        // Ler a taxa real do mix format negociado (pode ser 44100 em vez de 48000)
        try {
            const caps = await window.audioCapture.getCaptureStatus();
            audioCaptureState.mixRate = caps.sampleRate || 48000;
            audioCaptureState.mixChannels = caps.channels || 2;
        } catch (_) {
            audioCaptureState.mixRate = 48000;
            audioCaptureState.mixChannels = 2;
        }

        audioCaptureState.isCapturing = true;

        // Create audio track from native capture
        audioTrack = await createAudioTrackFromNative(audioCaptureState.mixRate);
        
        // Set up audio callback to feed data
        setupAudioCallback();
        
        return { success: true, track: audioTrack };
    } catch (err) {
        console.error('Erro ao iniciar captura de áudio:', err);
        audioCaptureState.isCapturing = false;
        throw err;
    }
}

async function stopAudioCapture() {
    if (!audioCaptureState.isCapturing) return;
    
    try {
        if (window.audioCapture && window.audioCapture.stopCapture) {
            await window.audioCapture.stopCapture();
        } else if (window.electronAPI) {
            await window.electronAPI.stopCapture();
        }
    } catch (err) {
        console.error('Erro ao parar captura de áudio:', err);
    }
    
    audioCaptureState.isCapturing = false;
    
    // Cleanup audio track
    if (audioTrack) {
        audioTrack.stop();
        audioTrack = null;
    }

    if (audioWorkletNode) {
        try { audioWorkletNode.port.postMessage('stop'); } catch (e) {}
        try { audioWorkletNode.disconnect(); } catch (e) {}
        audioWorkletNode = null;
    }
    
    if (oscillatorRef) {
        oscillatorRef.stop();
        oscillatorRef = null;
    }
    
    if (audioContextRef) {
        await audioContextRef.close();
        audioContextRef = null;
    }
}

function setupAudioCallback() {
    // Medição de latência do nosso pipeline (native → main → renderer → worklet).
    // cadência = intervalo entre chunks (esperado ~10ms); trânsito = tempo main→renderer.
    let lastArrival = null;
    let cadenceSum = 0, transitSum = 0, maxTransit = 0, samples = 0;
    const WINDOW = 200;

    // Register callback for native audio data
    if (window.audioCapture && window.audioCapture.onAudioData) {
        window.audioCapture.onAudioData((audioData, sentAtMs) => {
            // audioData is Float32Array (interleaved samples)
            if (audioWorkletNode && audioWorkletNode.port) {
                audioWorkletNode.port.postMessage({
                    type: 'audioData',
                    buffer: audioData
                });
            }

            const now = Date.now();
            if (lastArrival !== null) cadenceSum += now - lastArrival;
            lastArrival = now;
            if (typeof sentAtMs === 'number') {
                const lat = now - sentAtMs;
                transitSum += lat;
                if (lat > maxTransit) maxTransit = lat;
            }
            samples++;
            if (samples >= WINDOW) {
                console.log(`[Áudio] cadência méd=${(cadenceSum / samples).toFixed(1)}ms transit méd=${(transitSum / samples).toFixed(2)}ms máx=${maxTransit}ms (${samples} pacotes)`);
                cadenceSum = 0; transitSum = 0; maxTransit = 0; samples = 0; lastArrival = null;
            }
        });
    }
}

async function createAudioTrackFromNative(sampleRate) {
    const rate = sampleRate || 48000;
    // Usar a MESMA taxa do device que o nativo entrega — se o loopback for
    // 44.1kHz e o context for 48kHz, o áudio sai esticado/crepitando.
    audioContextRef = new AudioContext({ sampleRate: rate, latencyHint: 'interactive' });
    const destination = audioContextRef.createMediaStreamDestination();

    // Load the PCM worklet that consumes the native audio callback data
    try {
        const workletUrl = new URL('audio-worklet.js', window.location.href).href;
        await audioContextRef.audioWorklet.addModule(workletUrl);
    } catch (err) {
        console.warn('Falha ao carregar audio-worklet:', err);
    }

    try {
        audioWorkletNode = new AudioWorkletNode(audioContextRef, 'pcm-processor', {
            processorOptions: { sampleRate: rate },
            channelCount: 2,
            channelCountMode: 'explicit'
        });
        audioWorkletNode.port.onmessage = (e) => {
            if (e.data && e.data.type === 'stats') {
                const s = e.data;
                const ringMs = s.ringAvailable != null ? (s.ringAvailable / 2 / s.sampleRate * 1000).toFixed(0) : '?';
                console.log(`[Worklet] rate=${s.sampleRate} recv=${s.receivedSamples} cons=${s.consumedSamples} drift=${s.drift} buf=${ringMs}ms underruns=${s.underrunCount} maxGap=${(s.maxGapSamples / 2 / s.sampleRate * 1000).toFixed(0)}ms refills=${s.refills}(${(s.refillSamples / s.sampleRate * 1000).toFixed(0)}ms) drops=${s.dropCount}`);
            }
        };
        audioWorkletNode.connect(destination);
    } catch (err) {
        console.warn('Falha ao criar AudioWorkletNode:', err);
        audioWorkletNode = null;
    }

    const tracks = destination.stream.getAudioTracks();
    return tracks[0] || null;
}

// Store refs for cleanup
let audioContextRef = null;
let oscillatorRef = null;

// ============================================================================
// VIDEO ENCODING PRESETS (FASE 2) - Bitrate, Simulcast, Scalability
// ============================================================================

const VIDEO_QUALITY_PRESETS = {
    '1080p60': {
        width: 1920, height: 1080, frameRate: 60,
        encoding: {
            maxBitrate: 6000,      // kbps
            maxFramerate: 60,
            // scalabilityMode omitido: H.264 não suporta SVC no Chromium WebRTC
        }
    },
    '1080p30': {
        width: 1920, height: 1080, frameRate: 30,
        encoding: {
            maxBitrate: 4000,
            maxFramerate: 30,
        }
    },
    '720p60': {
        width: 1280, height: 720, frameRate: 60,
        encoding: {
            maxBitrate: 3500,
            maxFramerate: 60,
        }
    },
    '720p30': {
        width: 1280, height: 720, frameRate: 30,
        encoding: {
            maxBitrate: 2500,
            maxFramerate: 30,
        }
    },
    '480p30': {
        width: 854, height: 480, frameRate: 30,
        encoding: {
            maxBitrate: 1500,
            maxFramerate: 30,
        }
    }
};

// Fallback chain for each quality (tenta qualidade inferior se falhar)
const QUALITY_FALLBACK_CHAIN = {
    '1080p60': ['1080p30', '720p60', '720p30', '480p30'],
    '1080p30': ['720p60', '720p30', '480p30'],
    '720p60': ['720p30', '480p30'],
    '720p30': ['480p30'],
    '480p30': []
};

/**
 * Get quality preset with encoding parameters
 * @param {string} qualityKey - e.g., '1080p60', '720p30'
 * @returns {object} preset with resolution + encoding params
 */
function getQualityPreset(qualityKey) {
    return VIDEO_QUALITY_PRESETS[qualityKey] || VIDEO_QUALITY_PRESETS['720p30'];
}

/**
 * Get screen/window sources via Electron desktopCapturer
 * Falls back to getDisplayMedia for browser environments
 */
async function getScreenSources() {
    // In Electron: use desktopCapturer via preload
    if (window.electronAPI && window.electronAPI.getSources) {
        return await window.electronAPI.getSources();
    }
    return [];
}

/**
 * Show the source picker modal and resolve with the selected source
 * @returns {Promise<{id: string, name: string}|null>} Selected source or null if cancelled
 */
function showSourcePicker() {
    return new Promise((resolve) => {
        const modal = document.getElementById('source-picker-modal');
        const grid = document.getElementById('source-picker-grid');
        const closeBtn = document.getElementById('source-picker-close');
        const cancelBtn = document.getElementById('source-picker-cancel');
        const tabs = document.querySelectorAll('.source-tab');
        let allSources = [];
        let currentTab = 'screen';

        if (!modal || !grid) { resolve(null); return; }

        let resolved = false;
        const done = (source) => {
            if (resolved) return;
            resolved = true;
            modal.classList.add('hidden');
            resolve(source);
        };

        const render = () => {
            grid.innerHTML = '<div class="loading-sources">Carregando fontes...</div>';
            const filtered = allSources.filter(s => {
                if (currentTab === 'screen') return s.id && typeof s.id === 'string' && s.id.startsWith('screen');
                return s.id && typeof s.id === 'string' && s.id.startsWith('window');
            });

            if (filtered.length === 0) {
                grid.innerHTML = '<div class="loading-sources">Nenhuma fonte disponível.</div>';
                return;
            }

            grid.innerHTML = '';
            filtered.forEach(source => {
                const item = document.createElement('div');
                item.className = 'source-item';

                const img = document.createElement('img');
                img.src = source.thumbnail || 'data:image/svg+xml;utf8,' + encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="100%" height="100%" fill="%23232329"/><text x="50%" y="50%" text-anchor="middle" fill="%235865f2" font-size="40" font-family="sans-serif">🖥️</text></svg>'
                );
                img.alt = source.name;

                const span = document.createElement('span');
                span.textContent = source.name;
                span.title = source.name;

                item.appendChild(img);
                item.appendChild(span);

                item.addEventListener('click', () => {
                    selectedScreenSourceId = source.id;
                    done(source);
                });

                grid.appendChild(item);
            });
        };

        // Close handlers
        closeBtn.addEventListener('click', () => done(null));
        cancelBtn.addEventListener('click', () => done(null));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) done(null);
        });

        // Tab switching
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentTab = tab.dataset.type;
                render();
            });
        });

        modal.classList.remove('hidden');

        // Load sources
        getScreenSources().then(sources => {
            allSources = sources;
            render();
        }).catch(err => {
            console.error('[SourcePicker] Falha ao carregar fontes:', err);
            grid.innerHTML = '<div class="loading-sources">Erro ao carregar fontes: ' + err.message + '</div>';
        });
    });
}

/**
 * Capture a screen/window source via getUserMedia (Electron desktopCapturer)
 * @param {string} sourceId - Electron source ID (e.g. "screen:0:0" or "window:123:0")
 * @param {object} preset - Quality preset with width/height/frameRate
 * @returns {Promise<MediaStream>} Captured stream
 */
async function captureScreenStream(sourceId, preset) {
    const width = preset.width;
    const height = preset.height;
    const frameRate = preset.frameRate;

    // Electron: use desktopCapturer source ID
    const constraints = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                maxWidth: width,
                maxHeight: height,
                maxFrameRate: frameRate,
                minFrameRate: Math.min(frameRate, 30),
            }
        }
    };

    return navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Attempt screen share with automatic fallback on failure.
 * Uses Electron desktopCapturer + getUserMedia instead of getDisplayMedia.
 * @param {string} qualityKey - Initial quality to try
 * @param {MediaStreamTrack|null} audioTrack - Optional audio track
 * @returns {Promise<{success: boolean, qualityUsed: string, error?: Error}>}
 */
async function shareScreenWithFallback(qualityKey, audioTrack) {
    const fallbackChain = [qualityKey, ...QUALITY_FALLBACK_CHAIN[qualityKey] || []];
    let lastError = null;

    // In Electron, we need to pick a source first
    let sourceId = selectedScreenSourceId;
    if (!sourceId) {
        const source = await showSourcePicker();
        if (!source) {
            return { success: false, qualityUsed: qualityKey, error: new Error('Nenhuma fonte selecionada') };
        }
        sourceId = source.id;
        selectedScreenSourceId = sourceId;
    }

    for (const attemptQuality of fallbackChain) {
        const preset = getQualityPreset(attemptQuality);

        try {
            console.log(`[Share] Tentando qualidade: ${attemptQuality} (${preset.width}x${preset.height} @ ${preset.frameRate}fps)`);

            // 1. Capture the screen/window stream
            const stream = await captureScreenStream(sourceId, preset);
            screenShareStream = stream;

            // Sem isso o Chromium trata o capture como conteúdo "motion" e
            // derruba a RESOLUÇÃO de captura (ex.: um preset 1080p vira 480p)
            // para segurar fps. contentHint='detail' + maintain-resolution
            // garantem que a qualidade escolhida chega de verdade.
            const vTrack = stream.getVideoTracks()[0];
            if (vTrack) {
                try { vTrack.contentHint = 'detail'; } catch (_) {}
                try { await vTrack.applyConstraints({ degradationPreference: 'maintain-resolution' }); } catch (_) {}
            }

            // 2. Add audio track if available
            if (audioTrack && !stream.getAudioTracks().length) {
                stream.addTrack(audioTrack);
            }

            // 3. Publish video track to LiveKit
            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                throw new Error('Nenhum track de vídeo capturado');
            }

            screenSharePublication = await myRoom.localParticipant.publishTrack(videoTrack, {
                source: LivekitClient.Track.Source.ScreenShare,
                name: `screen-${attemptQuality}`,
                videoEncoding: preset.encoding,
                // simulcast: false — H.264 não suporta SVC real no WebRTC Chromium.
                // Simulcast com H.264 codificaria 3 streams separados (1x/0.5x/0.25x)
                // triplicando o uso de CPU de encoding sem ganho de qualidade adaptativa.
                simulcast: false,
                videoCodec: 'h264',     // prefere encode/decode com aceleração de hardware
                dtx: true,
            });

            // 4. Publish audio track separately (as microphone-like track)
            const audio = stream.getAudioTracks()[0];
            if (audio) {
                screenShareAudioPublication = await myRoom.localParticipant.publishTrack(audio, {
                    source: LivekitClient.Track.Source.Microphone,
                    name: 'screen-audio',
                    // dtx: false — DTX (Discontinuous Transmission) pode silenciar o Opus
                    // durante períodos de áudio baixo (ex.: música suave, efeitos sutis de
                    // jogo), causando cortes. Para áudio de screen share, continuidade é
                    // mais importante do que economia de banda.
                    dtx: false,
                    red: true, // Opus: redundância contra perda de pacote
                });
            }

            console.log(`[Share] Sucesso com qualidade: ${attemptQuality}`);
            return { success: true, qualityUsed: attemptQuality };

        } catch (err) {
            lastError = err;
            console.warn(`[Share] Falha com ${attemptQuality}:`, err.message);

            // Clean up failed stream
            if (screenShareStream) {
                screenShareStream.getTracks().forEach(t => t.stop());
                screenShareStream = null;
            }
            if (screenSharePublication) {
                try { await myRoom.localParticipant.unpublishTrack(screenSharePublication.track); } catch (e) {}
                screenSharePublication = null;
            }
            if (screenShareAudioPublication) {
                try { await myRoom.localParticipant.unpublishTrack(screenShareAudioPublication.track); } catch (e) {}
                screenShareAudioPublication = null;
            }

            // If this was the last fallback, break
            if (attemptQuality === fallbackChain[fallbackChain.length - 1]) {
                break;
            }

            // Brief delay before retry
            await new Promise(r => setTimeout(r, 300));
        }
    }

    return { success: false, qualityUsed: qualityKey, error: lastError };
}

async function stopScreenShare() {
    if (!myRoom) return;
    
    try {
        // Unpublish manually published screen share tracks
        if (screenSharePublication) {
            await myRoom.localParticipant.unpublishTrack(screenSharePublication.track);
            screenSharePublication = null;
        }
        if (screenShareAudioPublication) {
            await myRoom.localParticipant.unpublishTrack(screenShareAudioPublication.track);
            screenShareAudioPublication = null;
        }
        
        await stopAudioCapture();
        
        if (screenShareStream) {
            screenShareStream.getTracks().forEach(t => t.stop());
            screenShareStream = null;
        }
        
        // Allow picking a different window/screen on the next share
        selectedScreenSourceId = null;
        
        btnStop.classList.add('hidden');
        if (btnShare) btnShare.classList.remove('hidden');
        
        updateAudioStatusBadge(false);
        
        // Hide effective quality badge
        if (effectiveQualityBadge) {
            effectiveQualityBadge.classList.add('hidden');
        }
        
    } catch (err) {
        console.error('Erro ao parar compartilhamento:', err);
    }
}

function updateAudioStatusBadge(isActive) {
    if (audioStatusBadge) {
        audioStatusBadge.textContent = isActive ? '🔴 AO VIVO' : '⭕ PARADO';
        audioStatusBadge.className = 'audio-status-badge ' + (isActive ? 'live' : 'stopped');
    }
}

async function startShareFlow(qualityKey) {
    if (!myRoom) return;

    try {
        // Best-effort audio capture: audio failures must NOT block video sharing
        let audioResult = { success: false, track: null };
        let audioError = null;
        try {
            audioResult = await startAudioCapture();
        } catch (err) {
            audioError = err;
            console.warn('[Share] Áudio indisponível, continuando sem áudio:', err);
        }

        // Use fallback mechanism
        const result = await shareScreenWithFallback(qualityKey, audioResult.track || null);

        if (result.success) {
            btnShare.classList.add('hidden');
            if (btnStop) btnStop.classList.remove('hidden');
            updateAudioStatusBadge(true);

            // Update effective quality badge
            if (effectiveQualityBadge) {
                effectiveQualityBadge.textContent = `📹 ${result.qualityUsed}`;
                effectiveQualityBadge.classList.remove('hidden');
                effectiveQualityBadge.className = 'effective-quality-badge';
            }

            // Show notification if fallback was used
            if (result.qualityUsed !== qualityKey) {
                showRoomError(`Qualidade ajustada automaticamente para ${result.qualityUsed}`);
            }
            if (audioError) {
                showRoomError('⚠️ Áudio indisponível (' + (audioError.message || 'erro').split('\n')[0] + '). A transmissão segue sem som.');
            }
        } else {
            throw result.error || new Error('Falha ao iniciar compartilhamento');
        }
    } catch (err) {
        console.error('Erro ao compartilhar tela com áudio:', err);
        showRoomError('Erro ao iniciar compartilhamento: ' + err.message.split('\n')[0]);
        // Clean up: release any capture that may have started, and force the
        // source picker to re-open on the next attempt.
        try { await stopAudioCapture(); } catch (e) {}
        selectedScreenSourceId = null;
        btnStop.classList.add('hidden');
        if (btnShare) btnShare.classList.remove('hidden');
    }
}

// Override existing share/stop handlers
if (btnShare) {
    btnShare.addEventListener('click', () => {
        if (!myRoom) return;
        startShareFlow(qualitySelect ? qualitySelect.value : '720p30');
    });
}

if (qualitySelect) {
    // Re-shares at the new quality when the dropdown changes DURING a live share
    qualitySelect.addEventListener('change', async () => {
        const wasSharing = btnShare && btnShare.classList.contains('hidden');
        if (!wasSharing || !myRoom) return;
        const newQuality = qualitySelect.value;
        console.log(`[Share] Qualidade alterada para: ${newQuality}`);
        await stopScreenShare();
        await startShareFlow(newQuality);
    });
}

if (btnStop) {
    btnStop.addEventListener('click', async () => {
        try {
            await stopScreenShare();
        } catch (err) {
            console.error('Erro ao parar compartilhamento:', err);
        }
    });
}

// ============================================================================
// ORIGINAL CODE (LOGIN, ROOM, PARTICIPANTS, ETC.)
// ============================================================================

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

    let avatarDataUrl = DEFAULT_AVATAR;
    if (avatarFile) {
      avatarDataUrl = (await resizeAvatar(avatarFile)) || DEFAULT_AVATAR;
    }
    iniciarLogin('sala-principal', participantName, password, avatarDataUrl);
  });
}

async function iniciarLogin(roomName, participantName, password, avatarDataUrl) {
  try {
    const res = await fetch(`${VERCEL_API_URL}/api/get-token?roomName=${encodeURIComponent(roomName)}&participantName=${encodeURIComponent(participantName)}&password=${encodeURIComponent(password)}&avatar=${encodeURIComponent(avatarDataUrl)}`);
    const { token, url } = await res.json();

    try {
      if (LivekitClient.setLogLevel) {
        // O modo debug imprime objetos gigantes ("webrtc stats {…}") no console
        // a cada poucos segundos, o que CONGELA o main-thread e esvazia o
        // jitter buffer do áudio (causa os "pipocos"). Nível alto silencia isso.
        LivekitClient.setLogLevel('warn');
      }
    } catch (_) {}

    const room = new LivekitClient.Room({
      autoSubscribe: false,
      // adaptiveStream desligado de propósito: em cena de compartilhamento de
      // tela o espectador quer a MELHOR camada que o link aguenta (a grade
      // pequena faria o adaptive pedir sempre 480p, ignorando o preset do emissor).
      videoCodec: 'h264',   // codec padrão para os tracks publicados nesta sala
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

    const avatarImg = createParticipantAvatar(participant, 'stream-owner-avatar');
    tag.appendChild(avatarImg);

    const tagName = document.createElement('span');
    tagName.textContent = participant.identity;
    tag.appendChild(tagName);

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

if (btnLeave) {
  btnLeave.addEventListener('click', () => disconnectRoom());
}

function disconnectRoom() {
  stopAudioCapture().catch(console.error);
  activeSubscribedSids.clear();
  if (screenShareStream) {
    screenShareStream.getTracks().forEach(t => t.stop());
    screenShareStream = null;
  }
  screenSharePublication = null;
  screenShareAudioPublication = null;
  selectedScreenSourceId = null;
  if (myRoom) {
    myRoom.disconnect();
    myRoom = null;
  }
  if (loginScreen) loginScreen.classList.add('active');
  if (roomScreen) roomScreen.classList.remove('active');

  // Reset do estado da UI para o próximo login
  btnStop.classList.add('hidden');
  if (btnShare) btnShare.classList.remove('hidden');
  updateAudioStatusBadge(false);
  if (effectiveQualityBadge) effectiveQualityBadge.classList.add('hidden');
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

    const info = document.createElement('span');
    info.className = 'participant-info';
    info.appendChild(createParticipantAvatar(myRoom.localParticipant));

    const nameSpan = document.createElement('span');
    nameSpan.className = 'participant-name-text';
    nameSpan.textContent = `${myRoom.localParticipant.identity} (Você)`;
    info.appendChild(nameSpan);

    li.appendChild(info);
    partList.appendChild(li);
  }

  // 2. Participantes Remotos
  if (myRoom.remoteParticipants) {
    myRoom.remoteParticipants.forEach((participant) => {
      totalOnline++;
      const li = document.createElement('li');

      const info = document.createElement('span');
      info.className = 'participant-info';
      info.appendChild(createParticipantAvatar(participant));

      const nameSpan = document.createElement('span');
      nameSpan.className = 'participant-name-text';
      nameSpan.textContent = participant.identity;
      info.appendChild(nameSpan);

      li.appendChild(info);

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
          watchBtn.className = 'btn-watch-stream stop';
          watchBtn.textContent = '❌';
          watchBtn.title = 'Parar de assistir transmissão';

          watchBtn.addEventListener('click', () => {
            activeSubscribedSids.delete(participant.sid);
            participant.videoTrackPublications.forEach((pub) => pub.setSubscribed(false));
            participant.audioTrackPublications.forEach((pub) => pub.setSubscribed(false));
            removeWrapper(participant.sid);
            updateParticipantsUI();
          });
        } else {
          watchBtn.className = 'btn-watch-stream start';
          watchBtn.textContent = '🎥';
          watchBtn.title = 'Clique para assistir a transmissão';

          watchBtn.addEventListener('click', () => {
            activeSubscribedSids.add(participant.sid);
            participant.videoTrackPublications.forEach((pub) => {
              pub.setSubscribed(true);
              if (pub.track) renderTrack(pub.track, participant);
            });
            participant.audioTrackPublications.forEach((pub) => {
              pub.setSubscribed(true);
              if (pub.track) renderTrack(pub.track, participant);
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

function showRoomError(msg) {
  const el = document.getElementById('room-error');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showRoomError._timer);
    showRoomError._timer = setTimeout(() => el.classList.add('hidden'), 6000);
  } else {
    showLoginError(msg);
  }
}

// Initialize: load process list when room screen is shown
const observer = new MutationObserver(() => {
    if (roomScreen && roomScreen.classList.contains('active')) {
        loadProcessList();
        observer.disconnect();
    }
});
observer.observe(document.body, { attributes: true, subtree: true });