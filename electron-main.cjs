const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

console.log("ELECTRON BOOTING...");

function createWindow() {
    console.log("Creating Browser Window...");
    const win = new BrowserWindow({
        width: 1300,
        height: 900,
        show: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // 🚀 SOFT UPDATE SYSTEM: Check for external 'nadtally_update' folder next to the .exe
    const exeDir = path.dirname(app.getPath('exe'));
    const updatePath = path.join(exeDir, 'nadtally_update', 'index.html');
    const builtInPath = path.join(__dirname, 'dist', 'index.html');

    if (fs.existsSync(updatePath)) {
        console.log("🔥 LOADING UPDATE FROM:", updatePath);
        win.loadFile(updatePath).catch(err => {
            dialog.showErrorBox("Update Load Error", "Failed to load update: " + err.message);
            win.loadFile(builtInPath); // Fallback
        });
    } else if (fs.existsSync(builtInPath)) {
        win.loadFile(builtInPath);
    } else {
        const rootIndex = path.join(__dirname, 'index.html');
        if (fs.existsSync(rootIndex)) {
            win.loadFile(rootIndex);
        } else {
            dialog.showErrorBox("Missing Files", "Application files not found.");
        }
    }

    win.webContents.on('did-fail-load', (e, code, desc) => {
        console.error("Content failed to load:", code, desc);
    });
}

// 📂 IPC HANDLERS
ipcMain.handle('get-system-info', () => {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const k in interfaces) {
        for (const k2 in interfaces[k]) {
            const address = interfaces[k][k2];
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }
    return {
        hostname: os.hostname(),
        platform: os.platform(),
        ip: addresses[0] || '127.0.0.1'
    };
});

ipcMain.handle('get-data-path', () => app.getPath('userData'));

ipcMain.handle('select-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory']
    });
    return canceled ? null : filePaths[0];
});

ipcMain.handle('restart-app', () => {
    app.relaunch();
    app.exit();
});

app.whenReady().then(() => {
    console.log("App Ready!");
    try {
        const configPath = path.join(app.getPath('appData'), 'nadtally-config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.userDataPath) app.setPath('userData', config.userDataPath);
        }
    } catch (e) {
        console.error("Config Path Error:", e);
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}).catch(err => {
    dialog.showErrorBox("Fatal Startup Error", String(err));
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
