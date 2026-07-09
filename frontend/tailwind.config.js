/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bankPrimary: '#00427a',
        bankSecondary: '#002952',
      }
    },
  },
  plugins: [],
}
