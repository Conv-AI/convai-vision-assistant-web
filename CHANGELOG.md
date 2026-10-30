# Changelog

## [Unreleased]

Initial public release preparation. No release has been published yet.

### Added

- Automatic account character discovery with an API key.
- Character background artwork and full-image previews with resilient image fallbacks.
- An illustrated README covering sharing sources, transcript layouts and character selection.

- Voice and text conversations with configurable Convai characters.
- Camera, browser tab, window, screen, selected area and image sharing.
- Push to talk, hands-free mode, captions, transcript and vision pause controls.
- Compact floating window where the browser supports it.
- Server-side API key configuration with short-lived browser auth tokens.
- Local development, Node, Docker and Vercel deployment options.
- Unit, accessibility and browser tests; build credential and size checks.

### Fixed

- Respect the app's motion preference when character artwork finishes loading.
- Keep welcome and text conversations usable when the browser exposes no device media or permissions API.

- Explain missing or invalid API keys and guide empty accounts to create a character.
- Cancel stalled character requests, allow retry, and ignore expired requests' late responses.
- Keep browser transport injection out of normal production builds.
- Wait for a stable capture frame before browser tests resize a selected area.
- Preserve existing local configuration in setup commands and correct contributor instructions.
