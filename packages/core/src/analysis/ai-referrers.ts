// AI referral hosts, mirrored from knowledge/ai-referrers.md. Keep the two in sync.
export const AI_REFERRER_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "gemini.google.com",
  "bard.google.com",
  "claude.ai",
  "copilot.microsoft.com",
  "you.com",
  "phind.com",
];

// True when the GA4 source value is one of the hosts, or a subdomain of one.
export function isAiReferrer(source: string): boolean {
  const host = source.trim().toLowerCase();
  return AI_REFERRER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
