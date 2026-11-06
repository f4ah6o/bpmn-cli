# SVG parity fixtures

These BPMN files include BPMN DI and cover the browserless SVG renderer:

- simple: start, task, end
- japanese: CJK labels and wrapping
- gateway: exclusive gateway, condition/default flows
- nested: expanded subprocess and multiple BPMNDiagrams
- collaboration: pools, participants, message flows
- lanes: lanes and vertical labels
- boundary: boundary events
- multi-process: multiple processes without collaboration

## Reference SVGs

`reference/*.svg` were generated with **bpmn-js 18.31.1 Viewer#saveSVG()** in
Chrome, using the same `dist/svg-runtime.mjs` bundle that Node.js loads. The
reference environment is:

- Linux x64
- Node.js 26 for the browserless side
- Google Chrome for the reference side
- Liberation Sans for Latin text
- Noto Sans CJK JP for CJK text

The browserless and reference SVGs are normalized for browser-specific
serialization (hsl → rgb, random marker ids, matrix precision, CSS spacing,
and root viewBox rounding). They are then compared as XML trees and rendered
with `@resvg/resvg-js`; `pixelmatch` must report zero pixels.

## Running tests

`pnpm test` never starts Chrome. The parity tests run the built CLI and compare
against the committed reference SVGs using resvg + pixelmatch.

## Optional visual reports

For an agent-friendly visual diff report, vlmkit can compare two HTML wrappers
that embed the reference and generated SVGs. This is a development-only
workflow: vlmkit uses Playwright/Chromium, so it is intentionally not part of
`pnpm test` and is not a runtime dependency. The deterministic browserless gate
remains the resvg + pixelmatch comparison above.

## Regenerating references

References are development artifacts. Build the project, serve the current
`dist/svg-runtime.mjs` and the BPMN fixture over HTTP, load
`{ Viewer } from '/svg-runtime.mjs'`, call `viewer.saveSVG()`, and write the
returned SVG into `reference/<name>.svg`.

Keep the same bpmn-js version and fonts when regenerating. A change to the
reference environment must be documented here and accompanied by refreshed
goldens.
