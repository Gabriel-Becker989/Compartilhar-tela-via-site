const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ============================================================================
// Native Audio Module (Windows WASAPI) or Linux (PulseAudio/PipeWire)
// ============================================================================

let wasiAudio = null;
let linuxAudio = null;

if (process.platform === 'win32') {
    try {
        wasiAudio = require('./build/Release/wasi_audio.node');
        console.log('[Main] Windows WASAPI module loaded');
    } catch (err) {
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

    return {
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

                // Use parecord to capture audio and output to a pipe
                // For system audio (processId=0): capture from default monitor source
                // For specific app: capture from matching sink-input

                const args = [
                    '--format=s16le',
                    '--rate=48000',
                    '--channels=2',
                    '--file-format=wav',
                    '-' // output to stdout
                ];

                // If specific process, try to find its sink-input
                if (processId > 0) {
                    try {
                        const sinkInputs = execSync('pactl list short sink-inputs 2>/dev/null', {
                            encoding: 'utf-8',
                            timeout: 2000
                        });

                        for (const line of sinkInputs.split('\n').filter(Boolean)) {
                            const parts = line.split('\t');
                            if (parts.length >= 2) {
                                const detail = execSync(`pactl list sink-inputs 2>/dev/null | sed -n '/Sink Input #${parts[0]}:/,/^[^ ]/p'`, {
                                    encoding: 'utf-8',
                                    timeout: 2000
                                });

                                const pidMatch = detail.match(/application\.process\.id\s*=\s*"${processId}"/);
                                if (pidMatch) {
                                    args.unshift('--device=' + parts[1]);
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('[Linux] Could not find sink-input for PID', processId);
                    }
                }

                captureProcess = spawn('parecord', args, {
                    stdio: ['ignore', 'pipe', 'pipe']
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
            lastError: null
        })
    };
}

// Desativa aceleração de hardware para evitar travamentos
app.disableHardwareAcceleration();

// Allow screen capture and media permissions in renderer
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
    if (audioModule) return await audioModule.startCapture(config);
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
