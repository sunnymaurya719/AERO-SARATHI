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
    },
  },
  plugins: [],
};

export default config;
