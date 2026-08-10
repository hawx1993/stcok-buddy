import { migrateLegacyUserData } from './services/user-data-migration.js';

migrateLegacyUserData();
await import('./app-main.js');
