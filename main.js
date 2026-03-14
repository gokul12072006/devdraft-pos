const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const XLSX = require('xlsx');

// Data directory — stored in user's AppData (Windows) or ~/Documents
const DATA_DIR = path.join(app.getPath('userData'), 'DevDraftPOS');
const DATA_FILE = path.join(DATA_DIR, 'posdata.json');
const EXCEL_DIR = path.join(app.getPath('documents'), 'DevDraftPOS_Exports');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EXCEL_DIR)) fs.mkdirSync(EXCEL_DIR, { recursive: true });

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Dev Draft POS – Grocery Point of Sale',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        backgroundColor: '#f4f7f5',
    });

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.setMenuBarVisibility(false);

    // Open external links in default browser
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) { shell.openExternal(url); }
        return { action: 'deny' };
    });
}

app.setName('DevDraft POS');
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────

// Load all data from JSON file
ipcMain.handle('load-data', () => {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Load error:', e);
    }
    return null;
});

// Save all data to JSON file
ipcMain.handle('save-data', (event, data) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        return { success: true };
    } catch (e) {
        console.error('Save error:', e);
        return { success: false, error: e.message };
    }
});

// Save Excel file locally
ipcMain.handle('save-excel', (event, { filename, data, sheetName }) => {
    try {
        const wb = XLSX.utils.book_new();

        if (Array.isArray(data)) {
            // Array of sheets: [{name, rows}]
            data.forEach(sheet => {
                const ws = XLSX.utils.json_to_sheet(sheet.rows);
                styleHeaderRow(ws, sheet.rows);
                XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
            });
        } else {
            const ws = XLSX.utils.json_to_sheet(data);
            styleHeaderRow(ws, data);
            XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
        }

        const outPath = path.join(EXCEL_DIR, filename);
        XLSX.writeFile(wb, outPath);
        return { success: true, path: outPath };
    } catch (e) {
        console.error('Excel error:', e);
        return { success: false, error: e.message };
    }
});

// Get data directory path
ipcMain.handle('get-data-path', () => {
    return { dataDir: DATA_DIR, excelDir: EXCEL_DIR };
});

// Open excel folder in Explorer/Finder
ipcMain.handle('open-excel-folder', () => {
    shell.openPath(EXCEL_DIR);
});

// ─── RECEIPT PRINTING — uses electron-pos-printer (dedicated thermal library) ─
// This bypasses all webContents.print() issues completely
let PosPrinter;
try {
    PosPrinter = require('electron-pos-printer').PosPrinter;
} catch(e) {
    PosPrinter = null;
    console.warn('electron-pos-printer not found, will use fallback print');
}

// Get list of installed printers
ipcMain.handle('get-printers', async (event) => {
    try {
        const allWins = BrowserWindow.getAllWindows();
        if (allWins.length === 0) return [];
        const list = await allWins[0].webContents.getPrintersAsync();
        return list.map(p => ({ name: p.name, isDefault: p.isDefault }));
    } catch(e) {
        return [];
    }
});

// Print receipt using electron-pos-printer
ipcMain.handle('print-receipt', async (event, receiptData) => {
    // receiptData = { printerName, rows: [...] }
    // rows format: [{ type: 'text'|'empty', value: string, style: {...} }]

    if (PosPrinter && receiptData && receiptData.rows) {
        // ── Path 1: electron-pos-printer (best — dedicated thermal library) ────
        try {
            const options = {
                preview: false,
                silent: true,
                printerName: receiptData.printerName || '',
                margin: '0 0 0 0',
                copies: 1,
                timeOutPerLine: 800,
                pageSize: '58mm',
            };
            await PosPrinter.print(receiptData.rows, options);
            return { success: true };
        } catch(e) {
            console.error('electron-pos-printer error:', e.message);
            // Fall through to HTML fallback
        }
    }

    // ── Path 2: HTML fallback — write to temp file, open in default browser ──
    // Works on any Electron version because it delegates to the OS browser
    const html = receiptData && receiptData.html ? receiptData.html : receiptData;
    if (!html || typeof html !== 'string') return { success: false, error: 'no html' };

    const tmpFile = path.join(app.getPath('temp'), 'devdraft_receipt_' + Date.now() + '.html');
    fs.writeFileSync(tmpFile, html, 'utf8');

    // Open in default browser — user prints from there (Ctrl+P)
    await shell.openPath(tmpFile);

    // Clean up after 2 minutes
    setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch(e) {} }, 120000);
    return { success: true, method: 'browser' };
});

// Helper: style header row green
function styleHeaderRow(ws, data) {
    if (!data || data.length === 0) return;
    const cols = Object.keys(data[0]);
    cols.forEach((k, c) => {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) {
            cell.s = {
                font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
                fill: { fgColor: { rgb: '1A7A3C' } },
                alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            };
        }
    });
    ws['!cols'] = cols.map((k, i) => ({
        wch: Math.max(k.length, ...data.map(r => String(Object.values(r)[i] ?? '').length)) + 2
    }));
}
