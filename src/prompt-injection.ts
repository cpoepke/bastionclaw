// Prompt injection detection and sanitization for BastionClaw.
// Two levels of response:
// - Neutralize: wraps dangerous patterns in brackets so the LLM sees them as data
// - Block: rejects the message entirely (obfuscation, spam padding)

// Patterns that indicate prompt injection attempts.
// Deliberately excludes backticks, $(), %xx encoding, and OR 1=1 —
// those false-positive on normal code/URL discussions.
const INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  // System prompt override attempts
  {
    pattern:
      /ignore\s+(previous|all|above|prior)\s+(instructions?|prompts?|rules?)/i,
    label: 'system-override',
  },
  {
    pattern:
      /disregard\s+(previous|all|above|prior)\s+(instructions?|prompts?|rules?)/i,
    label: 'system-override',
  },
  {
    pattern:
      /forget\s+(everything|all|previous|prior)\s+(instructions?|prompts?|rules?)/i,
    label: 'system-override',
  },
  {
    pattern: /new\s+(instructions?|system\s*prompts?|rules?)[\s:]/i,
    label: 'system-override',
  },
  { pattern: /you\s+are\s+now\s+(a|an|the)\b/i, label: 'identity-override' },
  {
    pattern: /act\s+as\s+(if\s+you\s+are|though\s+you\s+are)/i,
    label: 'identity-override',
  },
  { pattern: /pretend\s+(to\s+be|you\s+are)/i, label: 'identity-override' },
  { pattern: /roleplay\s+as/i, label: 'identity-override' },

  // Jailbreak attempts
  { pattern: /\bDAN\s*mode\b/i, label: 'jailbreak' },
  { pattern: /\bdeveloper\s*mode\b/i, label: 'jailbreak' },
  { pattern: /\bjailbreak\b/i, label: 'jailbreak' },
  { pattern: /bypass\s+(filter|safety|restriction)/i, label: 'jailbreak' },
  { pattern: /unlock\s+(mode|restriction|filter)/i, label: 'jailbreak' },

  // HTML/script injection
  { pattern: /<script[^>]*>/i, label: 'html-injection' },
  { pattern: /<iframe[^>]*>/i, label: 'html-injection' },
  { pattern: /javascript:/i, label: 'html-injection' },
  { pattern: /data:text\/html/i, label: 'html-injection' },
  { pattern: /onclick\s*=/i, label: 'html-injection' },
  { pattern: /onerror\s*=/i, label: 'html-injection' },
  { pattern: /onload\s*=/i, label: 'html-injection' },

  // Destructive shell commands (chained with operators)
  { pattern: /&&\s*rm\s+-/i, label: 'destructive-shell' },
  { pattern: /;\s*rm\s+-/i, label: 'destructive-shell' },
  { pattern: /\|\s*rm\s+-/i, label: 'destructive-shell' },

  // SQL injection (only the destructive ones, not OR 1=1)
  { pattern: /;\s*DROP\s+TABLE/i, label: 'sql-injection' },
  { pattern: /;\s*DELETE\s+FROM/i, label: 'sql-injection' },
  { pattern: /UNION\s+SELECT/i, label: 'sql-injection' },
];

const MAX_PROMPT_LENGTH = 50_000;

// Messages above this special-char ratio are blocked entirely.
// 70% accommodates code snippets while catching obfuscated payloads.
const SPECIAL_CHAR_BLOCK_RATIO = 0.7;

// Messages with fewer than this ratio of unique words are blocked (spam/padding).
// Only checked when word count > 20 to avoid flagging short messages.
const MIN_UNIQUE_WORD_RATIO = 0.15;

export interface SanitizeResult {
  safe: boolean;
  blocked: boolean;
  sanitized: string;
  reason?: string;
}

/**
 * Sanitize a prompt by detecting and neutralizing injection patterns.
 *
 * - Pattern matches: wrapped in brackets so the LLM treats them as data
 * - Obfuscation / spam: blocked entirely (message replaced with rejection notice)
 * - Truncation: excessively long prompts are cut to MAX_PROMPT_LENGTH
 */
export function sanitizePrompt(text: string): SanitizeResult {
  if (!text || text.length === 0) {
    return { safe: true, blocked: false, sanitized: text };
  }

  // Truncate excessively long prompts
  if (text.length > MAX_PROMPT_LENGTH) {
    return {
      safe: false,
      blocked: false,
      sanitized: text.slice(0, MAX_PROMPT_LENGTH),
      reason: `prompt truncated from ${text.length} to ${MAX_PROMPT_LENGTH} chars`,
    };
  }

  // Strip control characters first (keep newlines, tabs)
  let sanitized = text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    '',
  );

  // --- Block-level checks (message rejected entirely) ---

  // Excessive special characters → likely obfuscated/encoded payload
  const specialCharCount = (sanitized.match(/[^a-zA-Z0-9\s.,!?'"-]/g) || [])
    .length;
  if (
    sanitized.length > 0 &&
    specialCharCount / sanitized.length > SPECIAL_CHAR_BLOCK_RATIO
  ) {
    return {
      safe: false,
      blocked: true,
      sanitized: '[Message blocked: too many special characters]',
      reason: 'high-special-char-ratio',
    };
  }

  // Repetitive word spam → padding/DoS attempt
  const words = sanitized.split(/\s+/).filter(Boolean);
  if (words.length > 20) {
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    if (uniqueWords.size / words.length < MIN_UNIQUE_WORD_RATIO) {
      return {
        safe: false,
        blocked: true,
        sanitized: '[Message blocked: repetitive content]',
        reason: 'repetitive-content',
      };
    }
  }

  // --- Neutralize-level checks (patterns defanged, message passes through) ---

  const matched: string[] = [];

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      matched.push(label);
      // Wrap each match in brackets to neutralize it
      sanitized = sanitized.replace(pattern, (match) => `[${match}]`);
    }
  }

  if (matched.length > 0) {
    const uniqueLabels = [...new Set(matched)];
    return {
      safe: false,
      blocked: false,
      sanitized,
      reason: uniqueLabels.join(', '),
    };
  }

  return { safe: true, blocked: false, sanitized };
}
