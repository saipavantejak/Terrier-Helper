import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-widget",
    lib: {
      entry: "widget.tsx",
      formats: ["es"],
      fileName: "terrier-helper",
      cssFileName: "terrier-helper",
    },
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime"] },
    sourcemap: false,
  },
});
