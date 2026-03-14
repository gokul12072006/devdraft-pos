const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    loadData:        ()       => ipcRenderer.invoke('load-data'),
    saveData:        (data)   => ipcRenderer.invoke('save-data', data),
    saveExcel:       (opts)   => ipcRenderer.invoke('save-excel', opts),
    getDataPath:     ()       => ipcRenderer.invoke('get-data-path'),
    openExcelFolder: ()       => ipcRenderer.invoke('open-excel-folder'),
    getPrinters:     ()       => ipcRenderer.invoke('get-printers'),
    printReceipt:    (data)   => ipcRenderer.invoke('print-receipt', data),
});
