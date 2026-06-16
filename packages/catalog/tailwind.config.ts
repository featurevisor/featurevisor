import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--mv-color-background)",
        surface: "var(--mv-color-surface)",
        elevated: "var(--mv-color-elevated)",
        border: "var(--mv-color-border)",
        text: "var(--mv-color-text)",
        muted: "var(--mv-color-muted)",
        faint: "var(--mv-color-faint)",
        primary: "var(--mv-color-primary)",
        success: "var(--mv-color-success)",
        warning: "var(--mv-color-warning)",
        danger: "var(--mv-color-danger)",
        header: "var(--mv-color-header)",
        "header-active": "var(--mv-color-header-active)",
        "header-text": "var(--mv-color-header-text)",
        pill: "var(--mv-color-pill)",
        "success-surface": "var(--mv-color-success-surface)",
        "warning-surface": "var(--mv-color-warning-surface)",
        "danger-surface": "var(--mv-color-danger-surface)",
      },
      boxShadow: {
        soft: "var(--mv-shadow-soft)",
      },
    },
  },
  plugins: [],
} satisfies Config;
