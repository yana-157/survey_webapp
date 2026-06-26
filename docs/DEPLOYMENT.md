# Wilkinsburg Survey Deployment

## GitHub Pages URL

The published survey page is:

https://yana-157.github.io/survey_webapp/full-boundary-survey.html

## Response Collection

Responses are collected through Supabase.

Run `docs/supabase-response-spreadsheet.sql` once in the Supabase SQL editor. It creates:

- `full_boundary_responses`: raw JSON backup rows.
- `full_boundary_response_spreadsheet`: one spreadsheet-style row per respondent ID.
- `full_boundary_response_export`: a cleaner export view.
- `submit_full_boundary_response(...)`: public submit function.
- `update_full_boundary_feedback(...)`: public post-submission feedback function.

The public survey page does not receive direct table read/update permissions. It can only call the two controlled functions.

## Supabase Public Config

After creating the Supabase project and running the SQL, edit:

`assets/survey-config.js`

Fill in:

```js
window.WLB_SURVEY_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY"
};
```

Then run:

```bash
npm run build
git add assets/survey-config.js docs/assets/survey-config.js docs html src sass
git commit -m "Configure Supabase response collection"
git push
```

The normal GitHub Pages URL will then submit responses automatically. The URL hash fallback still works for testing:

```text
#supabase_url=...&supabase_anon_key=...
```

## Exporting Spreadsheet Rows

In Supabase, open the table editor or SQL editor and export:

```sql
select * from public.full_boundary_response_export;
```

That gives one row per respondent with metadata, neighborhood mappings, feedback, and follow-up email.
