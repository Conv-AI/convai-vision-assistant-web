# Working with this repository

## Help a first-time user run the app

When asked to set up, run, try or preview this project, assume the user is not a web developer.
Use plain English by default and keep explanations brief. Read README.md, package.json and
.env.example before acting. Follow these instructions even when the user's prompt is short.

1. Work in this repository. If it has not been downloaded, clone the repository URL supplied by
   the user into a new folder. Never overwrite an existing checkout or local configuration.
2. Default to running locally in the user's desktop browser. Deploy only when explicitly asked.
   Check the required runtime and the pinned package manager from package.json. Install project
   dependencies with the lockfile. If a required system tool is missing, explain the minimum
   action needed and link its official installer; do not silently change system-wide settings.
3. Check whether CONVAI_API_KEY is configured without printing its
   value. Create .env.local from .env.example only when it does not already exist.
4. If credentials are missing, guide the user through the following handoff:
   - Say: "You'll need a Convai API key. Do you already have one, or would
     you like help finding it?"
   - Link https://convai.com/ and the public Web SDK quickstart:
     https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/quickstart
   - Explain that the key comes from the user's Convai account dashboard and that they should create a character if their account has none. Dashboard layouts can change: consult the
     public documentation rather than inventing exact button names.
   - Open .env.local in the available editor, or tell the user how to open it. Point to
     CONVAI_API_KEY. Ask them to enter the value there and save. The app loads account
     characters automatically; do not ask the user for character IDs.
     Do not ask them to paste the API key into chat. Wait for confirmation before connecting.
5. Start pnpm dev, keep the server running, and open the actual printed localhost address if
   browser tools are available. Otherwise give a clickable local URL. Restart after env changes.
6. Check the page and API routes without printing tokens, keys, full API responses or account
   data. If credentials are missing, explain the setup requirement rather than modifying code.
7. Explain the first use: finish the welcome flow, choose push to talk or text, then explicitly
   select a visual source in the browser. Let the user approve microphone, camera and sharing.
8. Distinguish what was verified: page loaded, token issued, character connected, and an actual
   conversation. Do not call mocked tests proof of a working live conversation.
9. Finish with the local URL, one next action, and how to stop and restart the app. Do not bury
   the user in installation logs or framework details unless they ask.

## Boundaries

- Routine setup should not change source code, dependency versions or the lockfile.
- Never print, commit, screenshot or expose .env.local, API keys or auth tokens. Never put keys
  in browser code, VITE_ variables, URL parameters or command arguments.
- No Convai website login or shared cookie secret is needed. The server exchanges the user's
  API key for a short-lived browser token. See the README's How credentials work section.
- Hosting is optional. Before deploying, explain that visitors use the configured Convai account
  and that this starter does not include visitor authentication or rate limiting.
- Keep public documentation and authored interface text in English. Preserve Unicode input and
  international keyboard support; test fixtures containing other scripts are not UI translations.

## Development

Use the scripts in package.json. For code changes, run the relevant tests and typecheck; also
run lint and format:check before handing off. Browser tests use fake Convai connections and media.
Production build credential checks require dummy canary values, never real credentials.
