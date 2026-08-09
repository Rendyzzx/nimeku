module.exports = {
  darkMode: 'class',
  content: ["../index.html", "../alightmotion.html", "../maintenance.html", "../status-hd.html", "../pairing.html"],
  theme: {
    extend: {
      colors: {
        darkbg: 'var(--color-bg)',
        darkcard: '#181A22',
        darkinput: 'var(--color-bg)',
        neonGreen: 'var(--color-accent)',
        cyberYellow: 'var(--color-primary)',
        waGreen: '#25D366'
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        heading: ['Space Grotesk', 'sans-serif'],
        brand: ['Outfit', 'sans-serif']
      },
      borderWidth: {
        '2.5': '2.5px',
        '3': '3px'
      }
    }
  },
  plugins: []
}
