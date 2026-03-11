import { generateCustomData } from 'cem-plugin-vs-code-custom-data-generator';

export default {
  globs: ['src/**/*.ts'],
  plugins: [
    generateCustomData({
      outdir: '.',
      htmlFileName: 'vscode.html-data.json',
      cssFileName: null,
    }),
  ],
};