'use client'

import { useRouter } from 'next/navigation'

export default function UnauthorizedPage() {
  const router = useRouter()

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Icon */}
        <div style={styles.iconWrapper}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: '#ef4444' }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        {/* Heading */}
        <h1 style={styles.heading}>Access Denied</h1>

        {/* Subheading */}
        <p style={styles.subheading}>
          The STAFIVO web dashboard is for{' '}
          <strong>administrators and managers only</strong>.
        </p>

        <p style={styles.body}>
          If you are a worker, please use the{' '}
          <strong>STAFIVO mobile app</strong> to view your attendance,
          payroll, and documents.
        </p>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Actions */}
        <div style={styles.actions}>
          <button
            style={styles.primaryBtn}
            onClick={() => router.push('/login')}
          >
            Sign in with a different account
          </button>
        </div>

        {/* Footer */}
        <p style={styles.footer}>
          STAFIVO · Built by Pent 26
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
    padding: '24px',
    fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
  },
  card: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.10)',
    borderRadius: '20px',
    padding: '48px 40px',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.4)',
  },
  iconWrapper: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    marginBottom: '24px',
  },
  heading: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#f8fafc',
    margin: '0 0 12px 0',
    letterSpacing: '-0.5px',
  },
  subheading: {
    fontSize: '16px',
    color: '#cbd5e1',
    margin: '0 0 12px 0',
    lineHeight: '1.6',
  },
  body: {
    fontSize: '14px',
    color: '#94a3b8',
    margin: '0',
    lineHeight: '1.7',
  },
  divider: {
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
    margin: '32px 0',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  primaryBtn: {
    display: 'block',
    width: '100%',
    padding: '13px 24px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    color: '#fff',
    fontWeight: '600',
    fontSize: '15px',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    letterSpacing: '0.1px',
  },
  footer: {
    marginTop: '28px',
    fontSize: '12px',
    color: '#475569',
  },
}
