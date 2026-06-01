import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#F48024',
          'orange-dark': '#D96A10',
          'orange-light': '#FEF0E3',
          navy: '#1E2D5A',
          'navy-dark': '#131D3D',
          'navy-mid': '#2D4178',
        },
        sand: {
          50: '#F8F7F4',
          100: '#F0EDE8',
          200: '#C8C4BC',
          300: '#AEA99F',
          500: '#6B6760',
        },
      },
      fontFamily: {
        heading: ['var(--font-rajdhani)', 'sans-serif'],
        body: ['var(--font-dmsans)', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(30,45,90,0.04), 0 8px 24px rgba(30,45,90,0.06)',
        glow: '0 8px 24px rgba(244,128,36,0.35)',
        sidebar: '0 0 40px rgba(0,0,0,0.12)',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.4s ease both',
      },
    },
  },
  plugins: [],
};

export default config;
