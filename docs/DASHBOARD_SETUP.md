# Dashboard setup

The dashboard (`web/`) is a static React app. It talks to Supabase directly with the **publishable** key; row-level security limits the data to accounts listed in `app_users`.

## 1. Create your login (Supabase dashboard)

1. **Authentication → Users → Add user → Create new user**: your email and a password, with **Auto Confirm User** ticked.
2. **Authentication → Sign In / Providers**: turn off **Allow new users to sign up**, so nobody else can register.
3. Copy your new user's **UID** from the Users list, then in **SQL Editor** run:
   ```sql
   insert into public.app_users (user_id) values ('<your UID>');
   ```
   If you skip this, the dashboard shows the exact statement to run after you sign in.

## 2. Run it locally

```bash
cd web
npm install
```

Copy `web/.env.example` to `web/.env.local` and fill in:
- `VITE_SUPABASE_URL`: the project URL, without `/rest/v1`
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Project Settings → API Keys → publishable key (`sb_publishable_…`)

```bash
npm run dev
```

No Supabase needed for UI work: `npm run dev:demo` runs on built-in sample data.

Checks (the same ones CI runs): `npm run lint`, `npm test`, `npm run build`.

## 3. Deploy to Vercel

1. vercel.com → **Add New → Project** → import the GitHub repo.
2. **Root Directory:** `web`. Vercel detects Vite (build `npm run build`, output `dist`).
3. **Environment Variables:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, as above.
4. Deploy. Every push to `main` redeploys, and every PR gets a preview URL.

`web/vercel.json` sends every path to `index.html`, so links like `/filtered` work on refresh.

No Supabase URL settings need changing for email + password login. (They would for magic links or OAuth.)
