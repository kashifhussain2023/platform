/**
 * Shared Tailwind preset for V-AEP. Apps supply their own `content` globs and
 * reference this via `presets: [require('@vaep/config/tailwind')]`.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
