# Security policy

## Reporting a vulnerability

Please do not report security problems in public issues, discussions or pull requests.

Email [support@convai.com](mailto:support@convai.com) with "Security: Convai Vision Assistant for
the web" in the subject. Include what you found, the steps to reproduce it, and the version or
commit you tested. We will confirm that we received your report and keep you informed while we
work on a fix.

## Supported versions

There is no release yet: only the latest commit on `main` is supported. Once releases begin, fixes
are made on `main` and shipped in the next release, and older releases do not receive fixes.

## Handling keys

This app is designed so that a Convai API key never reaches the browser: the key stays on the
server side, and the browser receives only a short-lived token. If you find a way for the key to
reach the browser, a build output or a log, please report it as a vulnerability.
