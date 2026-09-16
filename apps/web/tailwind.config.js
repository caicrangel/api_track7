/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effdf4',
          100: '#d9f9e5',
          200: '#b5f1cd',
          300: '#7fe4ab',
          400: '#42cf81',
          500: '#1db563',
          600: '#12934f',
          700: '#117442',
          800: '#135c37',
          900: '#114c30',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
      },
    },
  },
  plugins: [],
};
