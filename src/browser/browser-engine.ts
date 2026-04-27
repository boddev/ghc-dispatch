/**
 * Browser Automation Engine
 *
 * Playwright-based browser automation that supports natural language commands.
 * Manages a persistent browser session with page state, navigation history,
 * screenshots, and content extraction for AI reasoning.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface BrowserConfig {
  headless: boolean;
  defaultTimeout: number;
  screenshotDir: string;
  userAgent?: string;
}

export interface PageInfo {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  inputs: Array<{ name: string; type: string; placeholder: string; value: string }>;
  buttons: Array<{ text: string; type: string }>;
}

export interface BrowserActionResult {
  success: boolean;
  action: string;
  description: string;
  url?: string;
  title?: string;
  screenshot?: string;
  content?: string;
  error?: string;
}

const DEFAULT_CONFIG: BrowserConfig = {
  headless: true,
  defaultTimeout: 30_000,
  screenshotDir: '',
};

export class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserConfig;
  private history: string[] = [];

  constructor(config?: Partial<BrowserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async launch(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: this.config.headless,
    });
    this.context = await this.browser.newContext({
      userAgent: this.config.userAgent,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.defaultTimeout);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  isRunning(): boolean {
    return this.browser !== null && this.page !== null;
  }

  // --- Core Actions ---

  async navigate(url: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
      this.history.push(url);
      return this.actionResult('navigate', `Navigated to ${url}`);
    } catch (err: any) {
      return { success: false, action: 'navigate', description: `Failed to navigate to ${url}`, error: err.message };
    }
  }

  async click(selector: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.click(selector, { timeout: 10_000 });
      await this.page!.waitForLoadState('domcontentloaded').catch(() => {});
      return this.actionResult('click', `Clicked: ${selector}`);
    } catch (err: any) {
      return { success: false, action: 'click', description: `Failed to click: ${selector}`, error: err.message };
    }
  }

  async clickText(text: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.getByText(text, { exact: false }).first().click({ timeout: 10_000 });
      await this.page!.waitForLoadState('domcontentloaded').catch(() => {});
      return this.actionResult('click_text', `Clicked element with text: "${text}"`);
    } catch (err: any) {
      return { success: false, action: 'click_text', description: `No clickable element with text: "${text}"`, error: err.message };
    }
  }

  async fill(selector: string, value: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.fill(selector, value, { timeout: 10_000 });
      return this.actionResult('fill', `Filled ${selector} with "${value}"`);
    } catch (err: any) {
      return { success: false, action: 'fill', description: `Failed to fill: ${selector}`, error: err.message };
    }
  }

  async fillByLabel(label: string, value: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.getByLabel(label).fill(value, { timeout: 10_000 });
      return this.actionResult('fill_label', `Filled "${label}" with "${value}"`);
    } catch (err: any) {
      return { success: false, action: 'fill_label', description: `No input with label: "${label}"`, error: err.message };
    }
  }

  async fillByPlaceholder(placeholder: string, value: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.getByPlaceholder(placeholder).fill(value, { timeout: 10_000 });
      return this.actionResult('fill_placeholder', `Filled placeholder "${placeholder}" with "${value}"`);
    } catch (err: any) {
      return { success: false, action: 'fill_placeholder', description: `No input with placeholder: "${placeholder}"`, error: err.message };
    }
  }

  async select(selector: string, value: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.selectOption(selector, value, { timeout: 10_000 });
      return this.actionResult('select', `Selected "${value}" in ${selector}`);
    } catch (err: any) {
      return { success: false, action: 'select', description: `Failed to select: ${selector}`, error: err.message };
    }
  }

  async press(key: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.keyboard.press(key);
      return this.actionResult('press', `Pressed key: ${key}`);
    } catch (err: any) {
      return { success: false, action: 'press', description: `Failed to press: ${key}`, error: err.message };
    }
  }

  async type(text: string): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.keyboard.type(text);
      return this.actionResult('type', `Typed: "${text.slice(0, 50)}"`);
    } catch (err: any) {
      return { success: false, action: 'type', description: `Failed to type text`, error: err.message };
    }
  }

  async scroll(direction: 'up' | 'down' = 'down', amount = 500): Promise<BrowserActionResult> {
    await this.ensurePage();
    const delta = direction === 'down' ? amount : -amount;
    await this.page!.mouse.wheel(0, delta);
    return this.actionResult('scroll', `Scrolled ${direction} by ${amount}px`);
  }

  async back(): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.goBack({ waitUntil: 'domcontentloaded' });
      return this.actionResult('back', 'Went back');
    } catch (err: any) {
      return { success: false, action: 'back', description: 'Failed to go back', error: err.message };
    }
  }

  async waitForSelector(selector: string, timeoutMs = 10_000): Promise<BrowserActionResult> {
    await this.ensurePage();
    try {
      await this.page!.waitForSelector(selector, { timeout: timeoutMs });
      return this.actionResult('wait', `Element found: ${selector}`);
    } catch (err: any) {
      return { success: false, action: 'wait', description: `Timeout waiting for: ${selector}`, error: err.message };
    }
  }

  // --- Content Extraction ---

  async getPageInfo(): Promise<PageInfo> {
    await this.ensurePage();
    const page = this.page!;

    const [url, title, text, links, inputs, buttons] = await Promise.all([
      page.url(),
      page.title(),
      page.innerText('body').catch(() => ''),
      page.$$eval('a[href]', els => els.slice(0, 50).map(a => ({
        text: (a.textContent ?? '').trim().slice(0, 80),
        href: a.getAttribute('href') ?? '',
      }))).catch(() => []),
      page.$$eval('input, textarea, select', els => els.slice(0, 30).map(el => ({
        name: el.getAttribute('name') ?? '',
        type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
        placeholder: el.getAttribute('placeholder') ?? '',
        value: (el as any).value ?? '',
      }))).catch(() => []),
      page.$$eval('button, [role="button"], input[type="submit"]', els => els.slice(0, 20).map(el => ({
        text: (el.textContent ?? '').trim().slice(0, 50),
        type: el.getAttribute('type') ?? 'button',
      }))).catch(() => []),
    ]);

    return {
      url, title,
      text: text.slice(0, 5000),
      links: links.filter(l => l.text || l.href),
      inputs,
      buttons: buttons.filter(b => b.text),
    };
  }

  async screenshot(path?: string): Promise<string> {
    await this.ensurePage();
    const buffer = await this.page!.screenshot({ type: 'png', fullPage: false });
    if (path) {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buffer);
      return path;
    }
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  async extractText(selector?: string): Promise<string> {
    await this.ensurePage();
    if (selector) {
      return this.page!.innerText(selector).catch(() => '');
    }
    return this.page!.innerText('body').catch(() => '');
  }

  async evaluateScript(script: string): Promise<any> {
    await this.ensurePage();
    return this.page!.evaluate(script);
  }

  // --- Natural Language Command Parser ---

  async executeNaturalLanguage(command: string): Promise<BrowserActionResult> {
    const lower = command.toLowerCase().trim();

    // Navigation
    const goToMatch = lower.match(/(?:go to|open|navigate to|visit|browse)\s+(.+)/);
    if (goToMatch) {
      let url = goToMatch[1].trim().replace(/['"]/g, '');
      if (!url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('about:')) url = `https://${url}`;
      return this.navigate(url);
    }

    // Click by text
    const clickMatch = lower.match(/click\s+(?:on\s+)?(?:the\s+)?["']?(.+?)["']?\s*$/);
    if (clickMatch) {
      return this.clickText(clickMatch[1]);
    }

    // Fill by label or placeholder
    const fillMatch = lower.match(/(?:fill|type|enter|input|set)\s+["'](.+?)["']\s+(?:in|into|for|as)\s+["']?(.+?)["']?\s*$/);
    if (fillMatch) {
      const value = fillMatch[1];
      const target = fillMatch[2];
      const result = await this.fillByLabel(target, value);
      if (result.success) return result;
      return this.fillByPlaceholder(target, value);
    }

    // Fill reverse pattern: "set email to X"
    const fillReverseMatch = lower.match(/(?:fill|type|enter|input|set)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:to|with|as)\s+["'](.+?)["']/);
    if (fillReverseMatch) {
      const target = fillReverseMatch[1];
      const value = fillReverseMatch[2];
      const result = await this.fillByLabel(target, value);
      if (result.success) return result;
      return this.fillByPlaceholder(target, value);
    }

    // Scroll
    if (/scroll\s+down/i.test(lower)) return this.scroll('down');
    if (/scroll\s+up/i.test(lower)) return this.scroll('up');

    // Back
    if (/go\s+back|back/i.test(lower)) return this.back();

    // Screenshot
    if (/screenshot|capture|snap/i.test(lower)) {
      const path = await this.screenshot();
      return { success: true, action: 'screenshot', description: 'Screenshot captured', screenshot: path };
    }

    // Read/extract page content
    if (/(?:read|get|extract|show|what's on)\s+(?:the\s+)?(?:page|content|text)/i.test(lower)) {
      const info = await this.getPageInfo();
      return {
        success: true, action: 'read_page',
        description: `Page: ${info.title}`,
        url: info.url, title: info.title,
        content: info.text.slice(0, 3000),
      };
    }

    // Search (Google)
    if (/search\s+(?:for\s+)?["']?(.+?)["']?\s*$/i.test(lower)) {
      const query = lower.match(/search\s+(?:for\s+)?["']?(.+?)["']?\s*$/i)![1];
      await this.navigate(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
      return this.actionResult('search', `Searched Google for: "${query}"`);
    }

    // Press key
    const pressMatch = lower.match(/press\s+(.+)/);
    if (pressMatch) return this.press(pressMatch[1].trim());

    // Submit form
    if (/submit|press\s+enter/i.test(lower)) return this.press('Enter');

    return {
      success: false, action: 'unknown',
      description: `Could not parse browser command: "${command}"`,
      error: 'Unrecognized command. Try: "go to <url>", "click <text>", "fill <value> in <field>", "search <query>", "screenshot", "read page"',
    };
  }

  // --- State ---

  getHistory(): string[] {
    return [...this.history];
  }

  getCurrentUrl(): string {
    return this.page?.url() ?? '';
  }

  // --- Internal ---

  private async ensurePage(): Promise<void> {
    if (!this.browser || !this.page) {
      await this.launch();
    }
  }

  private async actionResult(action: string, description: string): Promise<BrowserActionResult> {
    const url = this.page?.url();
    const title = await this.page?.title().catch(() => '');
    return { success: true, action, description, url, title };
  }
}
