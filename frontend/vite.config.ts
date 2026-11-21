import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 개발: 프론트(5173) -> 백엔드(8000) 프록시. 현장: 백엔드가 dist 를 직접 제공 (외부 인터넷 불필요)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") }, dedupe: ["react", "react-dom"] },
  server: {
    host: true,
    proxy: { "/api": { target: "http://127.0.0.1:8000", ws: true } },
  },
})
