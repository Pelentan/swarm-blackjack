import React, { useState } from 'react';
import { ObservabilityPanel } from './ObservabilityPanel';

export const ObservabilityDrawer: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle button — fixed left edge */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Swarm Activity"
        style={{
          position: 'fixed',
          left: open ? 340 : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 200,
          background: '#161b22',
          border: '1px solid #30363d',
          borderLeft: open ? '1px solid #30363d' : 'none',
          borderRadius: open ? '0 6px 6px 0' : '0 6px 6px 0',
          color: '#8b949e',
          padding: '12px 6px',
          cursor: 'pointer',
          fontSize: '0.65rem',
          letterSpacing: 1,
          writingMode: 'vertical-rl',
          transition: 'left 0.25s ease',
          lineHeight: 1.2,
        }}
      >
        {open ? '◀ CLOSE' : 'SWARM ▶'}
      </button>

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        left: open ? 0 : -340,
        top: 0,
        bottom: 0,
        width: 340,
        background: '#0d1117',
        borderRight: '1px solid #21262d',
        zIndex: 199,
        overflowY: 'auto',
        transition: 'left 0.25s ease',
        padding: '16px 12px',
        boxShadow: open ? '4px 0 24px rgba(0,0,0,0.5)' : 'none',
      }}>
        <div style={{
          fontSize: '0.65rem', color: '#8b949e',
          letterSpacing: 2, textTransform: 'uppercase',
          marginBottom: 12, paddingBottom: 8,
          borderBottom: '1px solid #21262d',
        }}>
          Swarm Activity
        </div>
        <ObservabilityPanel compact />
      </div>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            zIndex: 198, cursor: 'pointer',
          }}
        />
      )}
    </>
  );
};
