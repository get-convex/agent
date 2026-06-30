module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          primary: "var(--background-primary)",
          secondary: "var(--background-secondary)",
          tertiary: "var(--background-tertiary)",
          deep: "var(--background-deep)",
          error: "var(--background-error)",
          success: "var(--background-success)",
        },
        content: {
          primary: "var(--content-primary)",
          secondary: "var(--content-secondary)",
          tertiary: "var(--content-tertiary)",
          accent: "var(--content-accent)",
          success: "var(--content-success)",
          error: "var(--content-error)",
        },
        edge: {
          soft: "var(--border-soft)",
          transparent: "var(--border-transparent)",
          selected: "var(--border-selected)",
        },
        red: { 200: "var(--red-200)", 500: "var(--red-500)" },
        green: { 200: "var(--green-200)", 900: "var(--green-900)" },
        yellow: { 200: "var(--yellow-200)", 900: "var(--yellow-900)" },
        blue: { 200: "var(--blue-200)" },
        util: { accent: "var(--util-accent)" },
      },
      fontFamily: {
        sans: "var(--font-sans)",
        display: "var(--font-display)",
        mono: "var(--font-mono)",
      },
      keyframes: {
        spin: { to: { transform: "rotate(360deg)" } },
        blink: {
          "0%, 45%": { opacity: "1" },
          "50%, 95%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        spin: "spin 0.8s linear infinite",
        blink: "blink 1s step-end infinite",
        pulse: "pulse 1.6s ease-in-out infinite",
        "fade-in": "fade-in 0.2s ease both",
      },
    },
  },
  plugins: [],
};
