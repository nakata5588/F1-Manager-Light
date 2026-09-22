import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

function codespacesHost(port) {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  return name && domain ? `${name}-${port}.${domain}` : null;
}

const devCodespacesHost = codespacesHost(5173);
const previewCodespacesHost = codespacesHost(4173);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: devCodespacesHost ? [devCodespacesHost] : [],
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: previewCodespacesHost ? [previewCodespacesHost] : [],
  },
});
