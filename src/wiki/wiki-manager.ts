import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface WikiPage {
  slug: string;
  path: string;
  frontmatter: WikiFrontmatter;
  body: string;
}

export interface WikiFrontmatter {
  title: string;
  tags: string[];
  created: string;
  updated: string;
  [key: string]: unknown;
}

export interface WikiSearchResult {
  slug: string;
  title: string;
  score: number;
  snippet: string;
}

export class WikiManager {
  constructor(private wikiDir: string) {
    mkdirSync(join(wikiDir, 'pages'), { recursive: true });
  }

  read(slug: string): WikiPage | null {
    const path = this.slugToPath(slug);
    if (!existsSync(path)) return null;
    return this.parsePage(path, slug);
  }

  write(slug: string, title: string, body: string, tags: string[] = []): WikiPage {
    const path = this.slugToPath(slug);
    mkdirSync(dirname(path), { recursive: true });

    const existing = this.read(slug);
    const now = new Date().toISOString();
    const frontmatter: WikiFrontmatter = {
      title,
      tags,
      created: existing?.frontmatter.created ?? now,
      updated: now,
    };

    const content = `---\n${stringifyYaml(frontmatter)}---\n${body}\n`;
    writeFileSync(path, content, 'utf-8');
    return { slug, path, frontmatter, body };
  }

  update(slug: string, updates: { body?: string; tags?: string[]; title?: string }): WikiPage | null {
    const existing = this.read(slug);
    if (!existing) return null;

    return this.write(
      slug,
      updates.title ?? existing.frontmatter.title,
      updates.body ?? existing.body,
      updates.tags ?? existing.frontmatter.tags,
    );
  }

  delete(slug: string): boolean {
    const path = this.slugToPath(slug);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  search(query: string, limit = 10): WikiSearchResult[] {
    const pages = this.listAll();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const results: WikiSearchResult[] = [];

    for (const page of pages) {
      const fullText = `${page.frontmatter.title} ${page.frontmatter.tags.join(' ')} ${page.body}`.toLowerCase();
      let score = 0;

      for (const term of terms) {
        const idx = fullText.indexOf(term);
        if (idx >= 0) {
          score += 1;
          // Title matches score higher
          if (page.frontmatter.title.toLowerCase().includes(term)) score += 2;
          // Tag matches score higher
          if (page.frontmatter.tags.some(t => t.toLowerCase().includes(term))) score += 1.5;
        }
      }

      // Recency boost (last 7 days)
      const age = Date.now() - new Date(page.frontmatter.updated).getTime();
      if (age < 7 * 86_400_000) score += 0.5;

      if (score > 0) {
        const snippet = this.extractSnippet(page.body, terms[0]);
        results.push({ slug: page.slug, title: page.frontmatter.title, score, snippet });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  listAll(): WikiPage[] {
    return this.walkDir(join(this.wikiDir, 'pages'), '');
  }

  buildIndex(query?: string): string {
    const pages = this.listAll();
    let ranked = pages;

    if (query) {
      const results = this.search(query, 50);
      const slugSet = new Set(results.map(r => r.slug));
      ranked = pages.filter(p => slugSet.has(p.slug));
      ranked.sort((a, b) => {
        const sa = results.find(r => r.slug === a.slug)?.score ?? 0;
        const sb = results.find(r => r.slug === b.slug)?.score ?? 0;
        return sb - sa;
      });
    }

    return ranked.map(p => {
      const tags = p.frontmatter.tags.length ? ` [${p.frontmatter.tags.join(', ')}]` : '';
      return `- [[${p.slug}]] — ${p.frontmatter.title}${tags}`;
    }).join('\n');
  }

  remember(entity: string, fact: string, tags: string[] = []): WikiPage {
    const slug = this.slugify(entity);
    const existing = this.read(slug);

    if (existing) {
      const newBody = existing.body.trimEnd() + '\n- ' + fact + '\n';
      return this.update(slug, { body: newBody, tags: [...new Set([...existing.frontmatter.tags, ...tags])] })!;
    }

    return this.write(slug, entity, `- ${fact}\n`, tags);
  }

  forget(slug: string, lineToRemove?: string): boolean {
    if (!lineToRemove) return this.delete(slug);

    const page = this.read(slug);
    if (!page) return false;

    const lines = page.body.split('\n').filter(l => !l.includes(lineToRemove));
    this.update(slug, { body: lines.join('\n') });
    return true;
  }

  private slugToPath(slug: string): string {
    return join(this.wikiDir, 'pages', `${slug}.md`);
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private parsePage(filePath: string, slug: string): WikiPage {
    const raw = readFileSync(filePath, 'utf-8');
    const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = raw.match(fmRegex);

    if (!match) {
      return {
        slug,
        path: filePath,
        frontmatter: { title: slug, tags: [], created: '', updated: '' },
        body: raw,
      };
    }

    const fm = parseYaml(match[1]) as Partial<WikiFrontmatter>;
    return {
      slug,
      path: filePath,
      frontmatter: {
        ...fm,
        title: fm.title ?? slug,
        tags: fm.tags ?? [],
        created: fm.created ?? '',
        updated: fm.updated ?? '',
      } as WikiFrontmatter,
      body: match[2].trim(),
    };
  }

  private walkDir(dir: string, prefix: string): WikiPage[] {
    if (!existsSync(dir)) return [];
    const results: WikiPage[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        results.push(...this.walkDir(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name));
      } else if (entry.name.endsWith('.md')) {
        const slug = prefix ? `${prefix}/${entry.name.replace('.md', '')}` : entry.name.replace('.md', '');
        const page = this.parsePage(join(dir, entry.name), slug);
        results.push(page);
      }
    }

    return results;
  }

  private extractSnippet(body: string, term: string, maxLen = 120): string {
    const lower = body.toLowerCase();
    const idx = lower.indexOf(term.toLowerCase());
    if (idx < 0) return body.slice(0, maxLen);
    const start = Math.max(0, idx - 40);
    const end = Math.min(body.length, idx + maxLen - 40);
    return (start > 0 ? '...' : '') + body.slice(start, end).replace(/\n/g, ' ') + (end < body.length ? '...' : '');
  }
}
