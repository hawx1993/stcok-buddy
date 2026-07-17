import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import styles from './index.module.scss';

interface ErrorBoundaryProps {
  name: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] render failed`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles['error-boundary']}>
          <div className={styles['error-title']}>{this.props.name} 加载失败</div>
          <div className={styles['error-desc']}>{this.state.error.message}</div>
          <button type='button' onClick={() => this.setState({ error: undefined })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
