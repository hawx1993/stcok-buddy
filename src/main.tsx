import React from 'react';
import ReactDOM from 'react-dom/client';
import posthog from 'posthog-js';
import { App } from './app';
import { registerServiceWorker } from './register-service-worker';
import 'antd/dist/reset.css';
import './styles/theme.css';
import './styles/global.scss';

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
if (import.meta.env.PROD && posthogKey) {
  posthog.init(posthogKey, {
    api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
  });
}

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
