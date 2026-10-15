// Layout checks in a real browser (Chromium): the dashboard at five widths, with every API call answered by recorded
// fixtures (e2e/fixtures), so nothing reaches a server or a database. Run: npx playwright test
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  use: { baseURL: "http://localhost:5199", trace: "off" },
  webServer: { command: "npx vite --port 5199 --strictPort", url: "http://localhost:5199", reuseExistingServer: true, timeout: 120000,
    env: { VITE_API_URL: "http://api.test" } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
