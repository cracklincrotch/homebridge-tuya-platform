import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // If you have any tests that rely on global timers behaving like jest fake timers,
    // keep real timers (default). You can enable fake timers per-test if needed.
  },
});
