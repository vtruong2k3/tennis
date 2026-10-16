import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0b0f19] text-[#dfe2f1] flex flex-col items-center justify-center p-6 font-mono">
          <div className="max-w-xl w-full bg-[#111624] border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/40 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Đã xảy ra lỗi hiển thị giao diện</h2>
                <p className="text-xs text-[#8f9bb3]">Giao diện gặp sự cố khi xử lý dữ liệu từ Engine.</p>
              </div>
            </div>

            <div className="bg-[#070b13] p-3 rounded-lg border border-white/5 text-xs text-red-300 font-mono overflow-x-auto max-h-48">
              {this.state.error?.toString()}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  window.location.reload();
                }}
                className="px-4 py-2 bg-[#caf300] hover:bg-[#b5db00] text-black font-bold text-xs rounded-lg transition-colors flex items-center gap-2"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Tải lại trang
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.href = '/';
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white font-semibold text-xs rounded-lg transition-colors"
              >
                Khôi phục mặc định
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
