const { contextBridge, ipcRenderer } = require('electron');

// Expose audio capture API to renderer
contextBridge.exposeInMainWorld('audioCapture', {
    // Get list of captureable processes (windows with audio)
    getProcessList: async () => {
        return await ipcRenderer.invoke('audio:getProcessList');
    },
    
    // Start capturing audio from a specific process
    startCapture: async (config) => {
        return await ipcRenderer.invoke('audio:startCapture', config);
    },
    
    // Stop current audio capture
    stopCapture: async () => {
        return await ipcRenderer.invoke('audio:stopCapture');
    },
    
    // Get current capture status
    getCaptureStatus: async () => {
        return await ipcRenderer.invoke('audio:getCaptureStatus');
    },
    
    // Set callback for audio data (ThreadSafeFunction from native module)
    onAudioData: (callback) => {
        // Store callback globally for native module to call
        window._audioDataCallback = callback;
    },
    
    // Remove audio data callback
    offAudioData: () => {
        window._audioDataCallback = null;
    }
});

// Forward native PCM chunks (main -> renderer) to the registered callback
ipcRenderer.on('audio:data', (_event, buffer, sentAtMs) => {
    const cb = window._audioDataCallback;
    if (cb) cb(buffer, sentAtMs);
});

// Expose Electron API for screen capture
contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
});