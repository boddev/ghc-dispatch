import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WikiManager } from '../../src/wiki/wiki-manager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WikiManager', () => {
  let wiki: WikiManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wiki-test-'));
    wiki = new WikiManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads a page', () => {
    wiki.write('test-page', 'Test Page', 'Hello world', ['test']);
    const page = wiki.read('test-page');
    expect(page).toBeDefined();
    expect(page!.frontmatter.title).toBe('Test Page');
    expect(page!.body).toBe('Hello world');
    expect(page!.frontmatter.tags).toEqual(['test']);
  });

  it('returns null for missing page', () => {
    expect(wiki.read('nonexistent')).toBeNull();
  });

  it('updates an existing page', () => {
    wiki.write('updatable', 'Original', 'Original body', ['v1']);
    wiki.update('updatable', { body: 'Updated body', tags: ['v1', 'v2'] });
    const page = wiki.read('updatable');
    expect(page!.body).toBe('Updated body');
    expect(page!.frontmatter.tags).toEqual(['v1', 'v2']);
  });

  it('preserves created date on update', () => {
    wiki.write('dates', 'Dates Test', 'Body');
    const original = wiki.read('dates')!;
    wiki.update('dates', { body: 'New body' });
    const updated = wiki.read('dates')!;
    expect(updated.frontmatter.created).toBe(original.frontmatter.created);
    expect(updated.frontmatter.updated).not.toBe(original.frontmatter.updated);
  });

  it('deletes a page', () => {
    wiki.write('deleteme', 'Delete Me', 'Gone');
    expect(wiki.delete('deleteme')).toBe(true);
    expect(wiki.read('deleteme')).toBeNull();
  });

  it('searches pages', () => {
    wiki.write('typescript', 'TypeScript Guide', 'TypeScript is a superset of JavaScript');
    wiki.write('python', 'Python Guide', 'Python is great for data science');
    wiki.write('rust', 'Rust Guide', 'Rust provides memory safety', ['systems']);

    const results = wiki.search('TypeScript');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].slug).toBe('typescript');
  });

  it('builds an index of all pages', () => {
    wiki.write('page-a', 'Page A', 'Content A');
    wiki.write('page-b', 'Page B', 'Content B');

    const index = wiki.buildIndex();
    expect(index).toContain('[[page-a]]');
    expect(index).toContain('[[page-b]]');
  });

  it('remembers facts about entities', () => {
    wiki.remember('Burke', 'Prefers TypeScript', ['person']);
    wiki.remember('Burke', 'Works on VS Code', ['person']);

    const page = wiki.read('burke');
    expect(page).toBeDefined();
    expect(page!.body).toContain('Prefers TypeScript');
    expect(page!.body).toContain('Works on VS Code');
    expect(page!.frontmatter.tags).toContain('person');
  });

  it('forgets specific facts', () => {
    wiki.remember('Project', 'Uses React');
    wiki.remember('Project', 'Deployed on Vercel');

    wiki.forget('project', 'Uses React');
    const page = wiki.read('project');
    expect(page!.body).not.toContain('Uses React');
    expect(page!.body).toContain('Deployed on Vercel');
  });

  it('lists all pages', () => {
    wiki.write('a', 'A', 'a');
    wiki.write('b', 'B', 'b');
    wiki.write('c', 'C', 'c');

    const all = wiki.listAll();
    expect(all).toHaveLength(3);
  });
});
