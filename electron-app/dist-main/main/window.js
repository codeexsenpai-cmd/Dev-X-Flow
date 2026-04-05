"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMainWindow = createMainWindow;
const electron_1 = require("electron");
const node_path_1 = require("node:path");
let mainWindow = null;
function createMenu(window) {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Repository',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        window.webContents.send('menu:open-repo');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Refresh Status',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        window.webContents.send('menu:refresh');
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'License',
            submenu: [
                {
                    label: 'View License Status',
                    click: () => {
                        window.webContents.send('license:show-modal');
                    }
                },
                {
                    label: 'Enter License Key',
                    click: () => {
                        window.webContents.send('license:show-activate');
                    }
                },
                {
                    label: 'Buy License',
                    click: () => {
                        void electron_1.shell.openExternal('https://devxflow.com/pricing');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Deactivate License',
                    click: () => {
                        window.webContents.send('license:deactivate');
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: () => {
                        void electron_1.shell.openExternal('https://devxflow.com/docs');
                    }
                },
                {
                    label: 'Submit Feedback',
                    click: () => {
                        void electron_1.shell.openExternal('https://devxflow.com/feedback');
                    }
                },
                { type: 'separator' },
                {
                    label: 'About Dev-X-Flow',
                    click: () => {
                        window.webContents.send('menu:about');
                    }
                }
            ]
        }
    ];
    const menu = electron_1.Menu.buildFromTemplate(template);
    electron_1.Menu.setApplicationMenu(menu);
}
function createMainWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 760,
        show: true,
        backgroundColor: '#0a0a0f',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: (0, node_path_1.join)(__dirname, '../preload/index.js'),
        },
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Create application menu
    createMenu(mainWindow);
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
        mainWindow.loadURL(devServerUrl);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile((0, node_path_1.join)(__dirname, '../../dist-renderer/index.html'));
    }
    return mainWindow;
}
