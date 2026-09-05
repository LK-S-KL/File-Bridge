# Rove Maintenance Rules

- Product name: Rove.
- Keep `main` runnable and scope each change to one user-visible goal.
- Run `npm test` before declaring work complete.
- Keep CEP panel JavaScript compatible with its embedded Chromium runtime.
- Keep `extension/jsx/host.jsx` ES3-compatible for Adobe ExtendScript.
- Never add permanent deletion of source media. Trash operations must stay recoverable and require explicit user action.
- Never commit credentials, tokens, signing certificates, private NAS details, user media, generated packages, or local caches.
- Keep the version in `package.json`, `extension/CSXS/manifest.xml`, and `extension/jsx/host.jsx` synchronized.
- Update `CHANGELOG.md` for every user-visible change.
