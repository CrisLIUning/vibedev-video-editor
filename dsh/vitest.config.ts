import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://host.test/api/dsh-film/apps/editor/index.html?cwd=C%3A%5Cws&project=film-1&theme=dark' },
    },
  },
});
