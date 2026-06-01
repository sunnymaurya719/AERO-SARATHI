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
          500: '#6B6760',
        },
      },
      fontFamily: {
        heading: ['var(--font-rajdhani)', 'sans-serif'],
        body: ['var(--font-dmsans)', 'sans-serif'],
      },
      boxShadow: {
        card: '0 32px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
        glow: '0 8px 24px rgba(244,128,36,0.35)',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(1.4)' },
        },
        progressSlide: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.6s ease both',
        marquee: 'marquee 22s linear infinite',
        pulseDot: 'pulseDot 2s infinite',
        progressSlide: 'progressSlide 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
