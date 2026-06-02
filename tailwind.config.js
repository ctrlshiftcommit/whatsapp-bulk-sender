/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1739",
        navy: "#062a58",
        emerald: "#0f9f64",
        mist: "#f5f7fb",
      },
      boxShadow: {
        panel: "0 8px 28px rgba(15, 23, 42, 0.05)",
      },
    },
  },
  plugins: [],
};
