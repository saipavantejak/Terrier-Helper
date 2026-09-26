import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://localhost:3111", trace: "retain-on-failure" },
  webServer: {
    command: "npm start",
    url: "http://localhost:3111/api/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: "3111",
      DATABASE_PATH: "data/browser-tests.sqlite",
      GEMINI_API_KEY: "",
      API_KEY: "",
      APP_ORIGIN: "http://localhost:3111",
    },
  },
});
