import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[CheatClip ErrorBoundary caught an unhandled error]:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '75vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2.5rem 1.5rem',
            color: '#f4f4f5',
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              background: '#09080e',
              border: '1.5px solid #ff1e27',
              padding: '2.5rem 2rem',
              maxWidth: '680px',
              width: '100%',
              boxShadow: '0 0 30px rgba(255, 30, 39, 0.28)',
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.65rem',
                color: '#ff1e27',
                fontSize: '1.2rem',
                fontWeight: 800,
                marginBottom: '1.25rem',
                letterSpacing: '0.04em',
              }}
            >
              <AlertTriangle size={26} color="#ff1e27" />
              <span>[RENDER_EXCEPTION_RECOVERED]</span>
            </div>

            <p
              style={{
                color: '#d4d4d8',
                fontSize: '0.86rem',
                lineHeight: 1.6,
                marginBottom: '1.5rem',
              }}
            >
              Komponen mengalami gangguan tak terduga saat memproses data antarmuka. Status sistem telah diamankan untuk mencegah kerusakan data sesi Anda.
            </p>

            {this.state.error && (
              <div
                style={{
                  background: '#050408',
                  border: '1px solid #27272a',
                  borderLeft: '3px solid #ff1e27',
                  padding: '0.85rem 1rem',
                  fontSize: '0.76rem',
                  color: '#f87171',
                  textAlign: 'left',
                  overflowX: 'auto',
                  marginBottom: '1.75rem',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '140px',
                }}
              >
                {this.state.error.toString()}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: '1rem',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  background: 'rgba(255, 0, 255, 0.15)',
                  border: '1px solid #ff00ff',
                  color: '#ff00ff',
                  padding: '0.65rem 1.4rem',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 0 10px rgba(255, 0, 255, 0.3)',
                }}
              >
                <RefreshCw size={14} /> Pulihkan Tampilan
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  background: '#ff1e27',
                  border: '1px solid #ff1e27',
                  color: '#ffffff',
                  padding: '0.65rem 1.4rem',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 0 12px rgba(255, 30, 39, 0.45)',
                }}
              >
                <RotateCw size={14} /> Muat Ulang Halaman
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
