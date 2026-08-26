# Captured transcripts

Ground truth for the context objects the real Marketplace host sends.

`src/fixtures.ts` reconstructs these from the SDK's TypeScript interfaces, but most of those
end in `[key: string]: any` — the real host almost certainly sends more. Run `apps/probe` in
Cloud Portal at each extension point, download the transcript, and drop it here, then fold the
real shapes back into `src/fixtures.ts`.

Transcripts are redacted on export (names, emails, `sub`, anything token-shaped), but read one
before committing it.
