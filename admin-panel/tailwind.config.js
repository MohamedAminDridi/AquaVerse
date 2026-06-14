/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',           // AquaVerse OS toggles `dark` on <html>
  theme: { extend: {
    colors: {
      brand: { 50:'#f0fdf4',100:'#dcfce7',700:'#15803d',800:'#166534' },
      aqua:  { 400:'#22d3ee', 500:'#06b6d4', 600:'#0891b2' },   // signature "live data" accent
    },
    fontFamily: {
      sans: ['Inter','system-ui','sans-serif'],
      mono: ['"JetBrains Mono"','ui-monospace','monospace'],     // telemetry numbers
    },
    boxShadow: { glow: '0 0 24px -4px rgba(34,211,238,0.45)' },
  } },
  plugins: [],
};
