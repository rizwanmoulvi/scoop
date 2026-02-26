/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          400: '#4f8ef7',
          500: '#1a6fff',
          600: '#0052e0',
          700: '#003db5',
          900: '#00257a',
        },
        yes: {
          DEFAULT: '#0052e0',
          dark:    '#003db5',
        },
        no: {
          DEFAULT: '#ff6b00',
          dark:    '#e05e00',
        },
        ink: {
          DEFAULT: '#0a1f5c',
          light:   '#2a4480',
          muted:   '#6b7eb3',
        },
      },
      fontFamily: {
        sans: ['Nunito', 'Fredoka One', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        xl:  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card:   '4px 4px 0px 0px rgba(0,82,224,0.18)',
        btn:    '3px 3px 0px 0px rgba(0,0,0,0.20)',
        'btn-orange': '3px 3px 0px 0px rgba(180,60,0,0.30)',
      },
    },
  },
  plugins: [],
}
