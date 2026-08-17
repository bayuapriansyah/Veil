import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#070b13',
        paper: '#0a0f18',
        panel: '#0d141f',
        panel2: '#111a29',
        line: '#1d2a3f',
        ink: '#d8e2f0',
        mut: '#7e8ca3',
        ok: '#a3e635',
        pend: '#fbbf24',
        bad: '#f87171',
        settle: '#22d3ee',
        agent: '#a78bfa',
        provider: '#34d399',
        attest: '#38bdf8',
      },
      fontFamily: {
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['var(--font-geist-sans)', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        control: '8px',
        panel: '12px',
        card: '16px',
      },
      spacing: {
        hair: '1px',
      },
      transitionTimingFunction: {
        'veil-in': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;