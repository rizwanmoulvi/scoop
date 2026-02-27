/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#525252',
          600: '#262626',
          700: '#171717',
          900: '#0a0a0a',
        },
        yes: {
          DEFAULT: '#0a0a0a',
          dark:    '#171717',
        },
        no: {
          DEFAULT: '#525252',
          dark:    '#262626',
        },
        ink: {
          DEFAULT: '#0a0a0a',
          light:   '#404040',
          muted:   '#737373',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        xl:   '0.625rem',
        '2xl': '0.75rem',
        '3xl': '1rem',
      },
      boxShadow: {
        card:         '0 1px 2px 0 rgba(0,0,0,0.06)',
        btn:          '1px 1px 0px 0px rgba(0,0,0,0.20)',
        'btn-orange': '1px 1px 0px 0px rgba(0,0,0,0.20)',
      },
    },
  },
  plugins: [],
}

