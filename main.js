const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

// Desativa aceleração de hardware para evitar travamentos no Linux Wayland/X11
app.disableHardwareAcceleration();

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

  // Carrega a interface estática
  win.loadFile(path.join(__dirname, 'public/index.html'));
}

// Handler para capturar janelas e telas
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 300, height: 200 }
  });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});