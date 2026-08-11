import path from "path"
import { defineConfig, loadEnv, type ProxyOptions } from "vite"
import react from "@vitejs/plugin-react"

function openAiProxy(apiKey: string): Record<string, ProxyOptions> {
  return {
    "/api/openai": {
      target: "https://api.openai.com",
      changeOrigin: true,
      rewrite: (requestPath) => requestPath.replace(/^\/api\/openai/, "/v1"),
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyRequest) => {
          proxyRequest.setHeader("Authorization", `Bearer ${apiKey}`)
        })
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const apiKey = loadEnv(mode, process.cwd(), "").OPENAI_API_KEY
  const proxy = apiKey ? openAiProxy(apiKey) : undefined

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: { proxy },
    preview: { proxy },
  }
})
