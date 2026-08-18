import { migrateLegacyUserData } from './services/stock-db/user-data-migration.js';

migrateLegacyUserData();
await import('./app-main.js');
