import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserEngine } from '../../src/browser/browser-engine.js';

describe('BrowserEngine', () => {
  let engine: BrowserEngine;

  beforeAll(async () => {
    engine = new BrowserEngine({ headless: true });
  });

  afterAll(async () => {
    await engine.close();
  });

  describe('lifecycle', () => {
    it('starts not running', () => {
      const fresh = new BrowserEngine({ headless: true });
      expect(fresh.isRunning()).toBe(false);
    });

    it('launches on first action', async () => {
      await engine.navigate('about:blank');
      expect(engine.isRunning()).toBe(true);
    });
  });

  describe('navigation', () => {
    it('navigates to a URL', async () => {
      const result = await engine.navigate('data:text/html,<h1>Hello</h1>');
      expect(result.success).toBe(true);
      expect(result.action).toBe('navigate');
    });

    it('tracks history', async () => {
      await engine.navigate('data:text/html,<h1>Page1</h1>');
      await engine.navigate('data:text/html,<h1>Page2</h1>');
      const history = engine.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('reports current URL', () => {
      const url = engine.getCurrentUrl();
      expect(url).toBeTruthy();
    });
  });

  describe('content extraction', () => {
    it('extracts page info', async () => {
      await engine.navigate('data:text/html,<html><head><title>Test</title></head><body><h1>Hello World</h1><a href="https://example.com">Link</a><input name="email" type="email" placeholder="Enter email"></body></html>');
      const info = await engine.getPageInfo();
      expect(info.title).toBe('Test');
      expect(info.text).toContain('Hello World');
      expect(info.links.length).toBeGreaterThanOrEqual(1);
      expect(info.inputs.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts text', async () => {
      await engine.navigate('data:text/html,<p>Some text here</p>');
      const text = await engine.extractText();
      expect(text).toContain('Some text here');
    });

    it('extracts text by selector', async () => {
      await engine.navigate('data:text/html,<div id="target">Specific</div><div>Other</div>');
      const text = await engine.extractText('#target');
      expect(text).toBe('Specific');
    });
  });

  describe('interactions', () => {
    it('clicks an element by text', async () => {
      await engine.navigate('data:text/html,<button onclick="document.title=\'clicked\'">Click Me</button>');
      const result = await engine.clickText('Click Me');
      expect(result.success).toBe(true);
    });

    it('fills an input by placeholder', async () => {
      await engine.navigate('data:text/html,<input placeholder="Your name" id="name">');
      const result = await engine.fillByPlaceholder('Your name', 'Alice');
      expect(result.success).toBe(true);
    });

    it('scrolls', async () => {
      await engine.navigate('data:text/html,<div style="height:5000px">tall page</div>');
      const result = await engine.scroll('down', 500);
      expect(result.success).toBe(true);
      expect(result.action).toBe('scroll');
    });

    it('presses a key', async () => {
      await engine.navigate('data:text/html,<input id="x">');
      await engine.click('#x');
      const result = await engine.press('a');
      expect(result.success).toBe(true);
    });
  });

  describe('natural language commands', () => {
    it('parses "go to" commands', async () => {
      const result = await engine.executeNaturalLanguage('go to data:text/html,<h1>NL</h1>');
      expect(result.success).toBe(true);
      expect(result.action).toBe('navigate');
    });

    it('parses "click" commands', async () => {
      await engine.navigate('data:text/html,<button>Submit</button>');
      const result = await engine.executeNaturalLanguage('click Submit');
      expect(result.success).toBe(true);
    });

    it('parses "scroll down" commands', async () => {
      const result = await engine.executeNaturalLanguage('scroll down');
      expect(result.success).toBe(true);
      expect(result.action).toBe('scroll');
    });

    it('parses "read page" commands', async () => {
      await engine.navigate('data:text/html,<p>Page content here</p>');
      const result = await engine.executeNaturalLanguage('read the page');
      expect(result.success).toBe(true);
      expect(result.content).toContain('Page content');
    });

    it('parses "screenshot" commands', async () => {
      const result = await engine.executeNaturalLanguage('take a screenshot');
      expect(result.success).toBe(true);
      expect(result.screenshot).toBeTruthy();
    });

    it('parses "search" commands', async () => {
      const result = await engine.executeNaturalLanguage('search for playwright testing');
      expect(result.success).toBe(true);
      expect(result.action).toBe('search');
    });

    it('reports unknown commands', async () => {
      const result = await engine.executeNaturalLanguage('do something impossible');
      expect(result.success).toBe(false);
      expect(result.action).toBe('unknown');
    });
  });
});
