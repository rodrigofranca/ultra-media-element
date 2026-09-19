import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC_DIR = join(__dirname, '..', 'src');

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectTsFiles(fullPath);
    return fullPath.endsWith('.ts') ? [fullPath] : [];
  });
}

describe('SDK versions', () => {
  it('never loads a runtime dependency via @latest', () => {
    const offenders = collectTsFiles(SRC_DIR).filter((file) =>
      readFileSync(file, 'utf8').includes('@latest')
    );

    expect(offenders).toEqual([]);
  });
});
