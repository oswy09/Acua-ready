<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3232569e-eb4f-4176-a7c3-b8041eca486c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set credentials in [.env.local](.env.local):
   - `GEMINI_API_KEY` for Gemini (recommended)
   - `GROQ_API_KEY` for Groq (optional alternative)
   - `VITE_SUPABASE_URL` for Supabase project URL (optional, enables multiuser cloud sync)
   - `VITE_SUPABASE_ANON_KEY` for Supabase anon public key
3. Run the app:
   `npm run dev`

## Supabase Multiuser Setup (Optional)

1. Create a Supabase project.
2. In Supabase, open SQL Editor and run [supabase.sql](supabase.sql).
3. In Authentication > Providers, enable Email provider (magic link).
4. In Authentication > URL Configuration, add your local URL (e.g. `http://localhost:3000`) as redirect URL.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.

With this enabled, each logged-in user gets private cloud sync for chat history, notes, quiz progress, and loaded document state across devices.
