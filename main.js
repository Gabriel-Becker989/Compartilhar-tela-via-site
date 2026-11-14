const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

// Opt-in diagnostic run. Configure paths synchronously, before Electron creates
// its default session or loads the native addon.
const isolatedRunValue = process.env.COLLAB_ISOLATED_RUN;
if (isolatedRunValue !== undefined && isolatedRunValue !== '1') {
    throw new Error('COLLAB_ISOLATED_RUN must be 1 when set');
}
const isolatedRun = isolatedRunValue === '1';
let isolatedAddonPath = null;

if (isolatedRun) {
    const canonical = (input) => {
        let ancestor = path.resolve(input);
        const suffix = [];
        while (true) {
            try {
                fs.lstatSync(ancestor);
                break;
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
                const parent = path.dirname(ancestor);
                if (parent === ancestor) throw new Error(`Cannot resolve path: ${input}`);
                suffix.unshift(path.basename(ancestor));
                ancestor = parent;
            }
        }
        return path.join(fs.realpathSync.native(ancestor), ...suffix);
    };
    const overlaps = (a, b) => {
        const contains = (parent, child) => {
            const relative = path.relative(parent.toLowerCase(), child.toLowerCase());
            return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
        };
        return contains(a, b) || contains(b, a);
    };

    const workspace = canonical(__dirname);
    const normalUserData = canonical(app.getPath('userData'));
    const normalSessionData = canonical(app.getPath('sessionData'));
    const tempBase = canonical(os.tmpdir());
    if (overlaps(tempBase, workspace) || overlaps(tempBase, normalUserData) || overlaps(tempBase, normalSessionData)) {
        throw new Error('Temporary base overlaps the workspace or normal Electron profile');
    }

    const addonOverride = process.env.COLLAB_ISOLATED_ADDON;
    if (addonOverride !== undefined) {
        if (!path.isAbsolute(addonOverride) || path.extname(addonOverride).toLowerCase() !== '.node') {
            throw new Error('COLLAB_ISOLATED_ADDON must be an absolute .node path');
        }
        const addon = fs.realpathSync.native(addonOverride);
        if (!fs.statSync(addon).isFile() || overlaps(addon, workspace) || overlaps(addon, normalUserData) || overlaps(addon, normalSessionData)) {
            throw new Error('Isolated addon must be a file outside the workspace and normal Electron profile');
        }
        fs.accessSync(addon, fs.constants.R_OK);
        isolatedAddonPath = addon;
    }

    const runRoot = fs.mkdtempSync(path.join(tempBase, 'screen-share-collab-'));
    const userData = path.join(runRoot, 'userData');
    const sessionData = path.join(runRoot, 'sessionData');
    fs.mkdirSync(userData);
    fs.mkdirSync(sessionData);
    if (overlaps(canonical(runRoot), workspace) || overlaps(canonical(runRoot), normalUserData) || overlaps(canonical(runRoot), normalSessionData)) {
        throw new Error('Isolated run directory overlaps the workspace or normal Electron profile');
    }
    app.setPath('userData', userData);
    app.setPath('sessionData', sessionData);
    console.log('[Main] Isolated run data:', runRoot);
}

// ============================================================================
// Native Audio Module (Windows WASAPI) or Linux (PulseAudio/PipeWire)
// ============================================================================

let wasiAudio = null;
let linuxAudio = null;

if (process.platform === 'win32') {
    try {
        wasiAudio = require(isolatedAddonPath || './build/Release/wasi_audio.node');
        console.log('[Main] Windows WASAPI module loaded');
    } catch (err) {
        if (isolatedAddonPath) throw err;
        console.warn('[Main] WASAPI module not available:', err.message);
    }
}

if (process.platform === 'linux') {
    linuxAudio = createLinuxAudioModule();
}

function createLinuxAudioModule() {
    console.log('[Main] Using Linux PulseAudio/PipeWire audio module');

    let captureProcess = null;
    let isCapturing = false;

    let audioCallback = null;

    return {
        // Espelha a API do módulo Windows: o IPC handler do main registra aqui
        // um callback que faz webContents.send('audio:data', ...).
        setAudioCallback: (cb) => {
            audioCallback = cb;
        },

        getProcessList: async () => {
            const processes = [];

            // 1. System audio (always available)
            processes.push({
                processId: 0,
                processName: '🔊 Som do Sistema',
                windowTitle: 'Captura todo o áudio do computador',
                hasAudio: true,
                type: 'system'
            });

            // 2. Get applications playing audio via pw-dump
            try {
                const pwDump = execSync('pw-dump 2>/dev/null', {
                    encoding: 'utf-8',
                    timeout: 3000
                });
                const nodes = JSON.parse(pwDump);
                const seen = new Set();

                // System/daemon processes to exclude
                const systemApps = new Set([
                    'pipewire', 'WirePlumber', 'WirePlumber [export]',
                    'libcanberra', 'xdg-desktop-portal', 'kwin_wayland',
                    'plasmashell', 'pw-dump', 'pw-record', 'parecord',
                    'KWin', 'Xwayland', 'dbus-daemon', 'systemd'
                ]);

                for (const node of nodes) {
                    const props = node?.info?.props || {};
                    const appName = props['application.name'] || '';
                    const mediaName = props['media.name'] || '';
                    const pid = props['application.process.id'] || '';
                    const mediaRole = props['media.role'] || '';

                    if (!appName || systemApps.has(appName)) continue;
                    if (seen.has(appName)) continue;
                    seen.add(appName);

                    let windowTitle = mediaName || appName;
                    if (pid) {
                        try {
                            const cmdline = execSync(`cat /proc/${pid}/comm 2>/dev/null`, {
                                encoding: 'utf-8',
                                timeout: 1000
                            }).trim();
                            if (cmdline) windowTitle = `${appName} (${cmdline})`;
                        } catch (e) {}
                    }

                    processes.push({
                        processId: parseInt(pid) || Math.floor(Math.random() * 10000),
                        processName: appName,
                        windowTitle: windowTitle,
                        hasAudio: true,
                        type: 'application',
                        mediaRole: mediaRole
                    });
                }
            } catch (err) {
                console.warn('[Linux] pw-dump failed:', err.message);
            }

            // 3. Also list sink-inputs (apps currently playing audio)
            try {
                const sinkInputs = execSync('pactl list short sink-inputs 2>/dev/null', {
                    encoding: 'utf-8',
                    timeout: 2000
                });

                for (const line of sinkInputs.split('\n').filter(Boolean)) {
                    const parts = line.split('\t');
                    if (parts.length >= 4) {
                        const sinkInputId = parts[0];
                        // Get detailed info
                        try {
                            const detail = execSync(`pactl list sink-inputs 2>/dev/null | sed -n '/Sink Input #${sinkInputId}/,/^[^ ]/p'`, {
                                encoding: 'utf-8',
                                timeout: 2000
                            });

                            const appMatch = detail.match(/application\.name\s*=\s*"([^"]+)"/);
                            const pidMatch = detail.match(/application\.process\.id\s*=\s*"(\d+)"/);

                            if (appMatch) {
                                const appName = appMatch[1];
                                const pid = pidMatch ? parseInt(pidMatch[1]) : 0;

                                // Avoid duplicates
                                if (!processes.find(p => p.processName === appName)) {
                                    processes.push({
                                        processId: pid || Math.floor(Math.random() * 10000),
                                        processName: `🎵 ${appName}`,
                                        windowTitle: `Tocando áudio agora (Sink #${sinkInputId})`,
                                        hasAudio: true,
                                        type: 'active_audio',
                                        sinkInputId: sinkInputId
                                    });
                                }
                            }
                        } catch (e) {}
                    }
                }
            } catch (err) {
                console.warn('[Linux] pactl sink-inputs failed:', err.message);
            }

            return processes;
        },

        startCapture: async (config) => {
            if (isCapturing) return true;

            const processId = config.processId || 0;

            try {
                // Kill any existing capture
                if (captureProcess) {
                    captureProcess.kill();
                    captureProcess = null;
                }

                // parecord RAW s16le @48k estéreo (sem header WAV — o renderer
                // espera PCM puro Float32 interleaved, convertido abaixo).
                const args = [
                    '--format=s16le',
                    '--rate=48000',
                    '--channels=2'
                ];

                // Áudio do sistema = monitor do sink padrão (PulseAudio/PipeWire).
                // NOTA: captura por-aplicativo exigiria um null-sink dedicado;
                // por ora qualquer processId usa o monitor do sistema.
                if (processId > 0) {
                    console.warn('[Linux] Captura por aplicativo ainda não suportada; usando áudio do sistema');
                }
                try {
                    const defaultSink = execSync('pactl get-default-sink 2>/dev/null', {
                        encoding: 'utf-8',
                        timeout: 2000
                    }).trim();
                    if (defaultSink) args.push('--device=' + defaultSink + '.monitor');
                } catch (e) {
                    console.warn('[Linux] pactl get-default-sink failed, usando fonte padrão');
                }

                args.push('-'); // stdout

                captureProcess = spawn('parecord', args, {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                // Lê o PCM s16le e repassa ao renderer em lotes de 2000 frames
                // (~41ms), espelhando o batching do caminho Windows (evita
                // engarrafamento de IPC por mensagem).
                const FRAMES_PER_CHUNK = 2000;
                const BYTES_PER_FRAME = 4; // 2ch * 16bit
                const NEED = FRAMES_PER_CHUNK * BYTES_PER_FRAME;
                let pending = Buffer.alloc(0);

                captureProcess.stdout.on('data', (chunk) => {
                    pending = Buffer.concat([pending, chunk]);
                    while (pending.length >= NEED) {
                        const slice = pending.subarray(0, NEED);
                        pending = pending.subarray(NEED);
                        const floats = new Float32Array(FRAMES_PER_CHUNK * 2);
                        for (let i = 0; i < floats.length; i++) {
                            floats[i] = slice.readInt16LE(i * 2) / 32768;
                        }
                        if (audioCallback) audioCallback(floats);
                    }
                });

                captureProcess.stderr.on('data', (data) => {
                    const msg = data.toString().trim();
                    if (msg) console.warn('[Linux] parecord:', msg);
                });

                captureProcess.on('error', (err) => {
                    console.error('[Linux] parecord error:', err.message);
                    isCapturing = false;
                });

                captureProcess.on('exit', () => {
                    isCapturing = false;
                    captureProcess = null;
                });

                isCapturing = true;
                console.log('[Linux] Audio capture started, PID:', processId);
                return true;

            } catch (err) {
                console.error('[Linux] Start capture failed:', err);
                isCapturing = false;
                throw err;
            }
        },

        stopCapture: async () => {
            if (captureProcess) {
                captureProcess.kill();
                captureProcess = null;
            }
            isCapturing = false;
            console.log('[Linux] Audio capture stopped');
            return true;
        },

        getCaptureStatus: async () => ({
            isCapturing,
            lastError: null,
            // O renderer cria o AudioContext na taxa REAL do device — aqui o
            // parecord fixa 48000/2ch, então reportamos o mesmo.
            sampleRate: 48000,
            channels: 2
        })
    };
}

// Aceleração de hardware: LIGADA por padrão (decode/render mais fluido).
// Para voltar ao comportamento antigo (sem HW accel), inicie com:
//   COLLAB_DISABLE_HW=1 compartilhar-tela-collab.exe
if (process.env.COLLAB_DISABLE_HW === '1') {
    app.disableHardwareAcceleration();
}

// AppImage Linux não instala o chrome-sandbox com SUID; sem este switch o
// Chromium aborta com "SUID sandbox helper not found" na maioria das distros.
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('no-sandbox');
}

// Allow screen capture and media permissions in renderer
let mainWindow = null;

app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = [
            'media',
            'mediaCapture',
            'display-capture',
            'audioCapture',
            'videoCapture'
        ].includes(permission);
        callback(allowed);
    });
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        title: "Screen Share Collab",
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow = win;

    win.loadFile(path.join(__dirname, 'public/index.html'));

    if (process.argv.includes('--dev')) {
        win.webContents.openDevTools();
    }
}

// ============================================================================
// IPC Handlers for Screen Capture
// ============================================================================

ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 300, height: 200 }
    });
    return sources.map(source => ({
        id: source.id,
        name: source.name,
        display_id: source.display_id || '',
        thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL()
    }));
});

// ============================================================================
// IPC Handlers for Audio Capture
// ============================================================================

const audioModule = wasiAudio || linuxAudio;

ipcMain.handle('audio:getProcessList', async () => {
    if (audioModule) return await audioModule.getProcessList();
    return [{ processId: 0, processName: 'Som do Sistema', windowTitle: 'Padrão', hasAudio: true, type: 'system' }];
});

ipcMain.handle('audio:startCapture', async (event, config) => {
    if (audioModule) {
        const result = await audioModule.startCapture(config);
        // Wire the native data callback AFTER capture starts so it attaches to
        // the live capture instance. Forward each PCM chunk to the renderer.
        if (process.platform === 'win32' && wasiAudio) {
            try {
                wasiAudio.setAudioCallback((data) => {
                    if (!data) return;
                    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('audio:data', data.slice(), Date.now());
                    }
                });
            } catch (err) {
                console.warn('[Main] setAudioCallback failed:', err.message);
            }
        } else if (process.platform === 'linux' && linuxAudio) {
            try {
                linuxAudio.setAudioCallback((data) => {
                    if (!data) return;
                    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('audio:data', data, Date.now());
                    }
                });
            } catch (err) {
                console.warn('[Main] linuxAudio.setAudioCallback failed:', err.message);
            }
        }
        return result;
    }
    throw new Error('Módulo de áudio não disponível nesta plataforma');
});

ipcMain.handle('audio:stopCapture', async () => {
    if (audioModule) return await audioModule.stopCapture();
    return true;
});

ipcMain.handle('audio:getCaptureStatus', async () => {
    if (audioModule) return await audioModule.getCaptureStatus();
    return { isCapturing: false, lastError: null };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
    if (audioModule) {
        try { await audioModule.stopCapture(); } catch (e) {}
    }
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
