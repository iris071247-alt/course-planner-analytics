# Course Planner Analytics

Independent privacy-conscious analytics for the course planning web app.

## Deploy

Use Node.js 20+ on Railway with `npm start`. Set `SITE_ORIGIN`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `VISITOR_SALT`, `DB_PATH=/data/analytics.sqlite`, and `NODE_ENV=production` in Railway Variables. Mount a persistent volume at `/data`.

The `/admin` page is password-protected. `/health` returns `ok`.

The main course-planner site must opt-in load `/tracker.js` from this deployment to start collecting metrics. It must not be added before the website supplies appropriate privacy notice/consent controls.

Admin credentials must never be committed. To track a verified business event, call `window.CourseAnalytics?.track('export_success')` only after successful export; `questionnaire_click` does not demonstrate completion.
