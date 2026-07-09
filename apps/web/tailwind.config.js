const preset = require('@vaep/config/tailwind');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
};
