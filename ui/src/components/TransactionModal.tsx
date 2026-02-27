import React, { useState, useEffect } from 'react';

interface Transaction {
  id: string;
  type: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: string;
}

interface Props {
  playerId: string;
  accessToken: string;
  isDemo?: boolean;
  onClose: () => void;
}

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || '';

const TYPE_COLORS: Record<string, string> = {
  bet:          '#f59e0b',
  payout_win:   '#38a169',
  payout_loss:  '#fc8181',
  payout_push:  '#8b949e',
  deposit:      '#38a169',
  withdrawal:   '#fc8181',
};

function typeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatAmount(type: string, amount: string): string {
  const n = parseFloat(amount);
  if (n === 0) return '—';
  const wins = ['payout_win', 'deposit'];
  const prefix = wins.some(t => type === t) ? '+' : type === 'payout_push' ? '±' : '-';
  return `${prefix}${n.toFixed(2)}`;
}

export function TransactionModal({ playerId, accessToken, isDemo, onClose }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const authHeader: Record<string, string> = {};
    if (accessToken) authHeader['Authorization'] = `Bearer ${accessToken}`;
    fetch(`${GATEWAY_URL}/api/bank/transactions?playerId=${encodeURIComponent(playerId)}&limit=100`, {
      headers: authHeader,
    })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: { transactions: Transaction[] } | Transaction[]) => {
        // Bank service returns { playerId, transactions: [...] }
        const txs = Array.isArray(data) ? data : (data as { transactions: Transaction[] }).transactions ?? [];
        setTransactions(txs);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [playerId]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const exportHeaders: Record<string, string> = {};
      if (accessToken) exportHeaders['Authorization'] = `Bearer ${accessToken}`;
      const r = await fetch(
        `${GATEWAY_URL}/api/bank/export?playerId=${encodeURIComponent(playerId)}`,
        { headers: exportHeaders }
      );
      if (!r.ok) throw new Error(`Export failed: ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    // Backdrop
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 12,
        width: '100%',
        maxWidth: 680,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #21262d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e6edf3' }}>
                Transaction History
              </div>
              {isDemo && (
                <span style={{
                  fontSize: '0.6rem', fontWeight: 700, color: '#f59e0b',
                  background: '#f59e0b15', border: '1px solid #f59e0b44',
                  borderRadius: 4, padding: '2px 6px', letterSpacing: 1,
                }}>DEMO</span>
              )}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#8b949e', marginTop: 2 }}>
              {loading ? 'Loading...' : `${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#8b949e', fontSize: '1.3rem', lineHeight: 1, padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: '#8b949e', fontSize: '0.8rem' }}>
              Loading transactions...
            </div>
          )}
          {error && (
            <div style={{ padding: 24, color: '#fc8181', fontSize: '0.8rem', textAlign: 'center' }}>
              {error}
            </div>
          )}
          {!loading && !error && transactions.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#8b949e', fontSize: '0.8rem' }}>
              No transactions yet.
            </div>
          )}
          {!loading && transactions.length > 0 && (
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: '0.75rem',
            }}>
              <thead>
                <tr style={{ background: '#0d1117', position: 'sticky', top: 0 }}>
                  {['Type', 'Amount', 'Balance', 'Time'].map(h => (
                    <th key={h} style={{
                      padding: '8px 16px', textAlign: 'left',
                      color: '#8b949e', fontWeight: 600,
                      fontSize: '0.65rem', letterSpacing: 0.5,
                      borderBottom: '1px solid #21262d',
                    }}>
                      {h.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => {
                  const color = TYPE_COLORS[tx.type] ?? '#8b949e';
                  const formatted = formatAmount(tx.type, tx.amount);
                  const isCredit = formatted.startsWith('+');
                  return (
                    <tr key={tx.id} style={{
                      background: i % 2 === 0 ? 'transparent' : '#0d111788',
                      borderBottom: '1px solid #21262d20',
                    }}>
                      <td style={{ padding: '8px 16px' }}>
                        <span style={{
                          color,
                          fontWeight: 600,
                          fontSize: '0.72rem',
                        }}>
                          {typeLabel(tx.type)}
                        </span>
                      </td>
                      <td style={{
                        padding: '8px 16px',
                        color: isCredit ? '#38a169' : formatted === '—' ? '#8b949e' : '#fc8181',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                      }}>
                        {formatted}
                      </td>
                      <td style={{
                        padding: '8px 16px',
                        color: '#e2e8f0',
                        fontFamily: 'monospace',
                      }}>
                        {parseFloat(tx.balanceAfter).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 16px', color: '#4a5568', fontSize: '0.68rem' }}>
                        {new Date(tx.createdAt).toLocaleString([], {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #21262d',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px', background: 'none',
              border: '1px solid #30363d', borderRadius: 6,
              color: '#8b949e', fontSize: '0.75rem', cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || transactions.length === 0}
            style={{
              padding: '7px 16px',
              background: downloading ? '#1f3050' : '#1f6feb22',
              border: '1px solid #1f6feb',
              borderRadius: 6,
              color: downloading ? '#8b949e' : '#58a6ff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: downloading || transactions.length === 0 ? 'not-allowed' : 'pointer',
              opacity: transactions.length === 0 ? 0.5 : 1,
            }}
          >
            {downloading ? 'Generating PDF...' : '↓ Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
