# Render deployment fix — JK CAPITAL test project

## What was fixed
The original ZIP placed all application files inside an extra `jk_capital_test/` directory.
If you uploaded that directory as a nested folder in the GitHub repository, Render would run
`npm install` from the repository root and fail to find `package.json`.

This fixed package places `package.json`, `app.js`, `render.yaml`, `views/`, and `public/`
directly at the project root. The JavaScript syntax check passed.

## How to deploy
1. Extract this ZIP.
2. In your GitHub repository `Cocojojobank/xx-bank-2`, upload the *contents* of this folder
   to the repository root (not the containing folder itself). You should see `package.json`
   at the same level as `app.js`.
3. Commit and push the changes.
4. In Render, open the `jk-capital-test` service → Settings → Build & Deploy.
5. Set Root Directory to blank / unset (or `.` if the dashboard requires a value).
6. Set Build Command to `npm install` and Start Command to `npm start`.
7. Ensure `DATABASE_URL` and `SESSION_SECRET` are set in the service environment. For an
   admin account, also set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD`.
8. Deploy latest commit and check `/health` and the logs.

## Important
- Do not commit a real `.env` file, passwords, API keys, or database credentials.
- The app requires PostgreSQL and exits at startup if `DATABASE_URL` or a 32+ character
  `SESSION_SECRET` is missing.
- This project is configured as a simulation/test environment. It does not process real
  deposits or bank transfers.
- Render may ask for a PostgreSQL plan that is available on your account; adjust the plan
  in `render.yaml` if necessary.
