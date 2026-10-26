# Certificate PDF (mobile): fill the A4 page and centre the body

## Goal

Match the web fix (NBA-WEB-APP `fix/certificate-spacing`). On mobile the certificate is HTML printed by expo-print. Its gold frame only wraps the content, so on a short certificate the cream sheet ends about two-thirds down the A4 page and the rest is bare gold. Make the frame fill the page, pin the foot (date, QR, chairman) to the bottom, and centre the body between the header and the foot, with capped gaps between sections.

## Code inspected

- `mobile/lib/pdf.ts` `certificateHtml`: `@page { size: A4 portrait; margin: 0 }`. The frame is `body` (gold, 14px padding) > `.outer` > `.inner` > `.sheet`, all sized by their content with no height. The sections are crest, rule, title, rule, lead, recital, `table.p`, `.note`, `.foot`, with fixed margins.
- `mobile/lib/__tests__/pdf-layout.test.ts`: string checks for particulars and A4. `RENDER_OUT` writes `certificate.html` and `certificate-longest.html` for render checks.
- I rendered both with Chromium at A4. Short: the frame ends at about 68% of the page. Longest (revoked, 160-character parties, 500-character description): one page.

## Decisions

- **The frame fills the page.** `body` gets `min-height: 297mm` and becomes a flex column. `.outer`, `.inner` and `.sheet` each `flex: 1` down the chain. It's a min-height, so the longest certificate still grows naturally and nothing gets clipped.
- **The foot sits at the bottom.** `.sheet` is a flex column. The title-to-note block is wrapped in `.body { flex: 1; display: flex; flex-direction: column; justify-content: center }`, so leftover space is split evenly above and below it, the same as `centre` on the web.
- **Capped section gaps**, as on the web. Empty `.gap` spacers `{ flex: 1 1 0; max-height: 24px }` sit between header/title, title/lead, recital/particulars and particulars/note. They grow to at most 24px, then the centring takes the rest. They take 0px when there's no spare space.
- **Row spacing stays as it is.** On the web each row grows by up to 8pt, but table rows can't flex in CSS without restructuring the table. The capped gaps and centring do most of the work. This is noted, not hidden.
- Wording, fonts, colours, particulars, QR, signature and revoked banner are unchanged.
- Branch: `fix/certificate-spacing`, cut from `feat/description-of-property`.

## Files

- `mobile/lib/pdf.ts`: certificate CSS and markup only.
- `mobile/lib/__tests__/pdf-layout.test.ts`: assert the certificate declares the page-filling frame (`min-height: 297mm`) and that the foot follows the centred body.

## Security

- Layout only. Escaping, the QR/verification URL and the signature handling are untouched.

## Acceptance criteria

- Short certificate: the cream sheet reaches the bottom of the A4 page (with the same 14px gold margin all round), the foot is at the bottom and the body is centred, on one page.
- Longest revoked certificate: still one A4 page.

## Checks

- `npx jest` (mobile)
- `npm run typecheck` (mobile)
- Render the short and longest certificates via `RENDER_OUT` → Chromium A4 PDF. Check there's exactly 1 page and compare by eye.

## Manual test

1. Run the app (Expo) and sign in as a practitioner with a certificate.
2. Certificates → open one → Share/Download PDF.
3. Open the PDF. The frame should fill the page, the date/QR/chairman block should sit at the bottom, and the body should be centred.
4. Do the same on both iOS and Android, because expo-print uses each platform's own WebView.

## Push

- Commit and push `fix/certificate-spacing` in both NBA-WEB-APP and NBA-Mobile-App to `origin`. No PRs.
