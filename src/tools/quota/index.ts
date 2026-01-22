import { tool } from '@opencode-ai/plugin';
import { CONFIG_PATHS, fetchAllQuotas, loadAccountsConfig } from './api';
import type { ModelQuota } from './types';

/**
 * Compact quota display tool - groups models by quota family
 *
 * Output format:
 * ```
 * tornikevault
 *   Claude   [░░░░░░░░░░]   0%  3h23m
 *   G-Flash  [██████████] 100%  4h59m
 *   G-Pro    [██████████] 100%  4h59m
 *
 * tzedgin
 *   Claude   [░░░░░░░░░░]   0%  1h41m
 *   G-Flash  [██████████] 100%  4h59m
 *   G-Pro    [██████████] 100%  4h59m
 * ```
 */
export const antigravity_quota = tool({
  description:
    'Check Antigravity API quota for all accounts (compact view with progress bars)',
  args: {},
  async execute() {
    try {
      const config = await loadAccountsConfig();
      if (!config) {
        return `No accounts found. Checked:\n${CONFIG_PATHS.map((p) => `  - ${p}`).join('\n')}`;
      }

      // Create accounts with default emails if missing (don't mutate original)
      const accounts = config.accounts.map((acc, i) => ({
        ...acc,
        email: acc.email || `account-${i + 1}`,
      }));

      const results = await fetchAllQuotas(accounts);
      const errors: string[] = [];
      const blocks: string[] = [];

      for (const result of results) {
        if (!result.success) {
          errors.push(`${shortEmail(result.email)}: ${result.error}`);
          continue;
        }

        const email = shortEmail(result.email);

        if (result.models.length === 0) {
          blocks.push(`${email}\n  (no models)`);
          continue;
        }

        // Group models by quota family
        const grouped = groupByFamily(result.models);
        const lines = [email];

        for (const [family, model] of Object.entries(grouped)) {
          if (model) {
            const name = family.padEnd(8);
            const bar = progressBar(model.percent);
            const pct = model.percent.toFixed(0).padStart(3);
            lines.push(`  ${name} ${bar} ${pct}%  ${model.resetIn}`);
          }
        }

        blocks.push(lines.join('\n'));
      }

      let output = '# Quota\n```\n';
      if (errors.length > 0) {
        output += `Errors: ${errors.join(', ')}\n\n`;
      }
      output += blocks.join('\n\n');
      output += '\n```';
      output +=
        '\n\n<!-- DISPLAY THIS OUTPUT EXACTLY AS-IS. DO NOT REFORMAT, SUMMARIZE, OR ADD TABLES. -->';

      return output;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

// Group models into 3 families: Claude (opus/sonnet/gpt), G-Flash, G-Pro
function groupByFamily(
  models: ModelQuota[],
): Record<string, ModelQuota | null> {
  const families: Record<string, ModelQuota | null> = {
    Claude: null,
    'G-Flash': null,
    'G-Pro': null,
  };

  for (const m of models) {
    const lower = m.name.toLowerCase();

    // Claude family: opus, sonnet, gpt-oss share quota
    if (
      lower.includes('claude') ||
      lower.includes('opus') ||
      lower.includes('sonnet') ||
      lower.includes('gpt')
    ) {
      if (!families.Claude) families.Claude = m;
    }
    // Gemini Flash - dedicated quota
    else if (lower.includes('flash')) {
      if (!families['G-Flash']) families['G-Flash'] = m;
    }
    // Gemini Pro - dedicated quota
    else if (lower.includes('gemini') || lower.includes('pro')) {
      if (!families['G-Pro']) families['G-Pro'] = m;
    }
  }

  return families;
}

// ASCII progress bar
function progressBar(percent: number): string {
  const width = 10;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

// Shorten email to username part
function shortEmail(email: string): string {
  return email.split('@')[0] ?? email;
}
