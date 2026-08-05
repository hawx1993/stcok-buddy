import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron: typeof import('electron') = require('electron');

export const { app, BrowserWindow, dialog, ipcMain, Notification, shell, systemPreferences } = electron;
