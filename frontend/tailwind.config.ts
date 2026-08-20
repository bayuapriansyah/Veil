import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0c0c0e',
        paper: '#101013',
        panel: '#141417',
        panel2: '#1c1c21',
        line: '#26262b',
        ink: '#f2f2f4',
        mut: '#9a9aa3',
        ok: '#3fb950',
        pend: '#d29922',
        bad: '#f85149',
        attest: '#3fb950',
        side: '#0e0e11',
      },
      boxShadow: {
        card: 'inset 0 1px 0 0 rgba(255,255,255,0.02), 0 4px 14px -6px rgba(0,0,0,0.5)',
        pop: '0 24px 60px -24px rgba(0,0,0,0.7)',
      },
      fontFamily: {
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        sans: ['var(--font-geist-sans)', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        serif: ['var(--font-lora)', 'Georgia', 'Times New Roman', 'serif'],
      },
      borderRadius: {
        control: '8px',
        panel: '12px',
        card: '16px',
        '2xl': '20px',
        '3xl': '24px',
        '4xl': '32px',
        '5xl': '40px',
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
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        marquee: 'marquee 32s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
