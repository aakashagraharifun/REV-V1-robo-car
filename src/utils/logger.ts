/**
 * Minimal logger that scrubs anything resembling an API key or bearer token
 * before it reaches the console. Use this instead of console.* in services.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-or-[A-Za-z0-9_-]{8,}/g, // OpenRouter
  /gsk_[A-Za-z0-9]{8,}/g, // Groq
  /sk-[A-Za-z0-9_-]{16,}/g, // generic OpenAI-style
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[REDACTED]'), text);
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .map(redact)
    .join(' ');
}

export function createLogger(scope: string) {
  const prefix = `[${scope}]`;
  return {
    debug: (...args: unknown[]) => {
      if (__DEV__) console.log(prefix, format(args));
    },
    info: (...args: unknown[]) => console.log(prefix, format(args)),
    warn: (...args: unknown[]) => console.warn(prefix, format(args)),
    error: (...args: unknown[]) => console.error(prefix, format(args)),
  };
}
