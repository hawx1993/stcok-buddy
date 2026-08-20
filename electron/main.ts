import { migrateLegacyUserData } from './services/stock-db/user-data-migration.js';
import { app } from './electron-runtime.js';

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  migrateLegacyUserData();
  await import('./app-main.js');
}
