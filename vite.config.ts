import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"

export default defineConfig({
  // Relative asset paths, so the same build works at a domain root, under a
  // GitHub Pages project path (/Glass-Drawing-AI/) or in any sub-folder.
  // Safe here because the app is a single page with no client-side routing.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
