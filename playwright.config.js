import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8080", headless: true },
  webServer: {
    command: "python3 -m http.server 8080",
    port: 8080,
    reuseExistingServer: true,
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
  ],
  reporter: "list",
});
