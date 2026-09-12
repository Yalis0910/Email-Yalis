import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }
      return (
        <div className="min-h-[200px] p-6 flex flex-col items-center justify-center text-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl my-4">
          <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-neutral-9)]">组件渲染异常</h3>
          <p className="text-xs font-mono text-[var(--color-neutral-6)] mt-1 max-w-md break-words">
            {this.state.error?.message || '未知运行错误'}
          </p>
          <button
            onClick={this.handleReset}
            className="mt-4 px-3 py-1.5 rounded-md bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-xs font-mono hover:bg-[var(--color-surface)] flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>重试加载</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
