import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { registerServiceWorker } from './register-service-worker';
import 'antd/dist/reset.css';
import './styles/theme.css';
import './styles/global.css';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
