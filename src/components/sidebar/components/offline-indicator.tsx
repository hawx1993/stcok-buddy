import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from '../index.module.scss';

export function OfflineIndicator() {
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className={styles['offline-indicator']} title='网络连接已断开'>
      <WifiOff size={15} />
      <span>网络已断开</span>
    </div>
  );
}
