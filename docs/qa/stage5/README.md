# Stage 5 visual QA

All images are captures of the real production bundle (`dist/`) at 390 × 844 CSS px / DPR 2 unless a
file name says otherwise. Regenerate with:

```bash
npm run build
npm run test:visual
```

The visual test creates the Stage 3 balance seed (`9E3779B8-00000001`), advances **200 real
simulation years** through the QA-only `advance` command (the normal `runDay` pipeline, not injected
state), then captures the mature world. It then advances until a real active war exists for the
political capture, applies a real Blight and advances a season for the ecological/economic captures.

| File | Screen |
|---|---|
| `01-worlds-empty.jpg` | first-run world selection |
| `02-world-creation.jpg` | creation with real generator preview |
| `03-onboarding.jpg` | first coach mark |
| `04-fresh-map.jpg` | fresh map |
| `05-mature-map.jpg` | 200-year world, 200 settlements, terrain |
| `06-mature-political.jpg` | political layer at maturity |
| `07-mature-population.jpg` | population layer |
| `08-mature-economy.jpg` | economy layer |
| `09-mature-ecology-fertility.jpg` | fertility metric |
| `10-mature-ecology-vegetation.jpg` | vegetation metric |
| `11-mature-ecology-moisture.jpg` | moisture metric |
| `12-mature-history.jpg` | history layer, severity pins |
| `13-panel-settlement.jpg` | settlement panel |
| `14-panel-civilization.jpg` | civilization panel with settlements list |
| `15-panel-economy.jpg` | economy panel |
| `16-panel-influence.jpg` | influence panel |
| `17-panel-world.jpg` | world panel |
| `18-event-causality.jpg` | event detail after a real Bless |
| `19-chronicle.jpg` | chronicle mode |
| `20-political-conflict.jpg` | active-war political layer |
| `21-ecological-stress.jpg` | real Blight effect |
| `22-economic-stress.jpg` | economy layer after the blight |
| `23-settings.jpg` | settings sheet |
| `24-large-text-200.jpg` | 200 % text at 390 dp |
| `25-narrow-320.jpg` | 320 × 720 layout |
| `26-landscape.jpg` | 844 × 390 landscape |
| `26b-landscape-panel.jpg` | landscape right-side panel |
| `27-world-panel-english.jpg` | English LTR panel |
| `28-map-english.jpg` | English LTR map |
| `29-worlds-english.jpg` | saved world list, English |
| `30-worlds-persian.jpg` | saved world list, Persian |

Stage 4 captures are kept at `docs/qa/stage4/` as the “before” set.

Physical-device captures are **not** here; they belong to the Stage 5 A23 device pass and must be
recorded with a real device path when available.
