# README media

These assets introduce the web application. The screenshots are browser captures of this
repository's actual React interface, not mobile-app screens or generated interface mockups.

The screenshots were captured from the updated application in an isolated working copy, including
the character artwork and separate foreground/background layers. [capture-source.json](capture-source.json)
records fingerprints of the application files used for capture. No environment files or credentials
were included, and the original application files and Git index were not changed by capture.

`18-character-preview.png` adds the actual large character preview, and `character-overview.png`
(1800 × 820) compares it with the updated character grid. The gallery now contains 18 app captures.

| Asset                         | Size        | Use                                |
| ----------------------------- | ----------- | ---------------------------------- |
| `hero.png`                    | 1600 × 900  | Main README cover                  |
| `social-preview.png`          | 1280 × 640  | Repository social preview          |
| `overview.png`                | 1800 × 1080 | One-image overview for team review |
| `01-conversation.png`         | 1440 × 900  | Camera scene, reply and transcript |
| `02-type-and-follow-up.png`   | 1440 × 900  | Actual typed-message composer      |
| `03-visual-sources.png`       | 1440 × 900  | Visual-source selection menu       |
| `04-characters.png`           | 1440 × 900  | Actual character picker            |
| `05-settings.png`             | 1440 × 900  | Accessibility preferences          |
| `06-image-and-transcript.png` | 1440 × 900  | Image sharing and transcript       |

## What is illustrative

The expanded set includes all six visual-source modes: camera, browser tab, window, entire screen,
selected area and image. `07`–`11` show different sharing scenarios and the actual area-selection
workflow. `12`–`14` compare Moments, Continuum and Conversation using the same three-question
exchange. `15` shows Quick controls, `16` shows no visual sharing and `17` shows transcript choices.

| Additional asset                                 | Size            | Use                                   |
| ------------------------------------------------ | --------------- | ------------------------------------- |
| `sharing-overview.png`                           | 1800 × 1080     | Six visual sources in one image       |
| `transcript-comparison.png`                      | 1800 × 680      | Three transcript layouts side by side |
| `07-browser-tab.png`–`17-transcript-choices.png` | 1440 × 900 each | Individual full-size captures         |

The separate capture workspace includes a local gallery with category filters for sharing sources, transcript layouts and app controls.

- The industrial camera plate and micrometer image are AI-created demonstration inputs reused
  from Convai's Vision Assistant creative work. They do not depict a physical camera capture.
- Camera frames are supplied through a canvas stream. The real app renders them through its
  existing camera flow. The micrometer is loaded through the actual JPG file chooser.
- Shared tabs, windows and screens use four original HTML/SVG learning fixtures: pressure
  regulation, an RC filter response, a fictional solar-energy workspace and a schematic bearing
  section. These pages were created by the capture workspace's `scripts/readme-scenes.mjs`; charts, values and diagrams are
  illustrative, not measured data or manufacturing drawings. Screen capture is replaced with a
  canvas stream, so the user's real desktop and other applications are never captured. Region
  selection and cropping use the app's actual production controls and crop pipeline.
- Questions and replies are scripted educational examples, supplied through the repository's
  existing fake Convai transport. No live Convai response, microphone recording or API usage is
  represented as verified by these captures.
- Portraits come from the public [Convai sample-character catalog](https://convai.com/api/sample-characters).
  The six-character roster is a local capture fixture, not a promise that a new account includes
  those characters. Synthetic IDs are used, and requests are fulfilled locally during capture.
- The normal application source, UI styles, credential routes and production transport are unchanged.
  Production builds exclude the E2E transport hook.

## Refresh the screenshots

This folder contains the finished documentation images, capture inputs in `fixtures/`, and the
source fingerprint record. The separate capture workspace supplied the capture scripts and specs;
those tools are not included in this documentation-only import.

The original workflow used Playwright Chromium, the app's existing E2E-only fake Convai transport,
and local media fixtures. It required no API key or real camera. Its steps were:

1. Generate the four illustrative sharing scenes with `scripts/readme-scenes.mjs`.
2. Set `README_CAPTURE=1` and a dedicated `VA_E2E_PORT`, then run
   `e2e/readme-capture.spec.ts` and `e2e/readme-options-capture.spec.ts` in Chromium.
3. Remove the capture environment settings and run `scripts/readme-artwork.mjs` to compose the
   cover, overview and social preview with the repository's Inter font.
4. Review the full-size captures and composite images before replacing documentation assets.

To refresh these images, use the capture tools in their original workspace or recreate that workflow
in an isolated copy of the current app. The commands above are provenance notes, not runnable setup
instructions for this checkout. Keep capture tooling and mock inputs out of the production app.

## Set the repository social preview

Upload `social-preview.png` through the repository's social-preview setting. Committing the file
does not configure the repository setting automatically. This task does not change GitHub settings.
