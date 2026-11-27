# Stewardship visual QA

Real production bundle (`dist/`), 390 × 844 CSS px at DPR 2 unless noted. Regenerate:

```bash
npm run build
npx playwright test tests/visual/stewardship.spec.ts --config=playwright.visual.config.ts
```

| File | Screen |
|---|---|
| `01-campaign-create.jpg` | creation with campaign mode and legacy select |
| `02-choose-people.jpg` | steward people setup |
| `03-foundations-board.jpg` | first chapter, baseline and slots |
| `04-objective-offer.jpg` | objective generated from a real condition |
| `05-charter-choice.jpg` | charter effect/trade-off picker |
| `06-mature-board.jpg` | 80-year board: era, chapters, metrics |
| `07-mature-steward-map.jpg` | 80-year map with steward ring and markers |
| `08-steward-capital-detail.jpg` | local-zoom capital footprint (real infra) |
| `09-high-detail-coast.jpg` | regional chunk: smooth coast, water, land |
| `10-charter-and-metrics.jpg` | charter form and measured metrics |
| `11-large-text-board-320.jpg` | 200 % text at 320 × 720, no horizontal overflow |
| `12-persian-board.jpg` | Persian RTL board |
| `13-persian-map.jpg` | Persian RTL map and legacy strip |

The mature scenario advances **80 real years** through the worker pipeline, not injected state.
Physical-device captures are not here; they belong to the A23 device pass.
