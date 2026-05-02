# Branding Assets

This project uses:

- **Melodarr Proxy** for the proxy/API service.
- **Melodash** for the operator dashboard.

Keep those names distinct in docs, UI, Docker images, and support requests.

## Assets

| Asset | Path | Purpose |
| --- | --- | --- |
| Logo mark | `public/logo.svg` | General project logo and docs usage |
| Favicon | `public/favicon.svg` | Legacy proxy pages |
| Apple/app icon | `public/apple-touch-icon.svg` | Browser/app shortcut icon |
| Melodash icon | `melodash/app/icon.svg` | Next.js app icon |
| Melodash apple icon | `melodash/app/apple-icon.svg` | Next.js app shortcut icon |
| Screenshots | `docs/screenshots/` | README and release documentation |

The current mark is intentionally simple: a blue circular signal mark with a subtle inner highlight. It matches the Melodash header identity and keeps the project recognizable at small favicon sizes.

## Usage Rules

- Use `Melodarr Proxy` when referring to the API service, container, or project.
- Use `Melodash` when referring to the dashboard UI.
- Do not rename the dashboard back to `DevDash`.
- Keep favicon and app icon shapes legible at 16px.
- Prefer SVG for source icons so they stay editable.
- If PNG exports are needed for a platform, generate them from the SVG source.
- Keep screenshots current with the latest stable UI before a major release.

## Changing Icons or Logos

Branding changes should be reviewed like UI changes. A pull request should include:

- updated source asset files
- screenshot or rendered preview
- README or docs updates when asset names or locations change
- confirmation that Melodash and legacy proxy pages both use the new icon

Avoid one-off icon changes in only one surface. If the project mark changes, update:

- `public/logo.svg`
- `public/favicon.svg`
- `public/apple-touch-icon.svg`
- `melodash/app/icon.svg`
- `melodash/app/apple-icon.svg`

## Screenshots

README screenshots live in:

```text
docs/screenshots/
```

Current screenshots:

- `melodash-dashboard.png`
- `melodash-settings.png`
- `melodash-explorer.png`

Screenshots should avoid exposing secrets, API keys, private hostnames, private emails, or personal library data.
