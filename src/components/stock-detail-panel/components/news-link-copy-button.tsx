import { message as antdMessage } from 'antd';
import { Copy } from 'lucide-react';
import type { MouseEvent } from 'react';
import styles from '../index.module.scss';

interface INewsLinkCopyButtonProps {
  url?: string;
}

export function NewsLinkCopyButton({ url }: INewsLinkCopyButtonProps) {
  if (!isSafeArticleUrl(url)) return null;
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      antdMessage.success('原文链接已复制');
    } catch (error: unknown) {
      console.error(error);
      antdMessage.error('复制原文链接失败');
    }
  };
  return <button aria-label='复制原文链接' className={styles['news-copy-button']} onClick={(event) => void copy(event)} title='复制原文链接' type='button'><Copy aria-hidden='true' size={13} /></button>;
}

function isSafeArticleUrl(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
