import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/main.ts',
  platform: 'node',
  tsconfig: 'tsconfig.json',
  output: {
    format: 'esm',
    cleanDir: true,
    minify: true,
  },
  moduleTypes: {
    '.md': 'text',
  },
});
