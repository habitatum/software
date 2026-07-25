/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta de marca HABITATUM
        dorado: '#b88a52',
        'gris-calido': '#cdc5ba',
        hueso: '#efece6',
        carbon: '#2e2e2e',
      },
      fontFamily: {
        marca: ['var(--font-cormorant)', 'serif'],
      },
    },
  },
  plugins: [],
};
