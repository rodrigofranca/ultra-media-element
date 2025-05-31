import { generateCustomData } from 'cem-plugin-vs-code-custom-data-generator';

export default {
  globs: ['src/**/*.ts'],
  plugins: [
    generateCustomData({
      outdir: '.',
      htmlFileName: 'vscode.html-custom-data.json',
      cssFileName: null,
    }),
  ],
};