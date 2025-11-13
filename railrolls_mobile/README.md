# railrolls_mobile

Face-enrolled attendance capture app for Rail Rolls.

## Face embedding Edge Function (stub)

The Flutter client now requires a Supabase Edge Function that returns a 128‑D
embedding per captured face. For MVP/testing we ship a deterministic hash-based
stub that lets the pipeline run end-to-end; replace the body with a real
embedding model before production.

### 1. Create and deploy
```bash
supabase functions new face-embed
# replace supabase/functions/face-embed/index.ts with the provided stub
supabase functions deploy face-embed --no-verify-jwt
```
Optional: lock the endpoint with a shared key so only the app can call it.
```bash
supabase secrets set --env-file - <<'EOF'
EMBED_API_KEY=super-secret-embed-key
EOF
supabase functions deploy face-embed --no-verify-jwt
```

### 2. Configure the app
Add the deployed URL (and key, if set) to `.env`:
```
FACE_EMBED_FUNCTION_URL=https://<project-ref>.functions.supabase.co/face-embed
FACE_EMBED_FUNCTION_KEY=super-secret-embed-key   # optional
```
Re-run `flutter pub get` and relaunch the app; the enrollment/check-in screens
will now show the embedding confidence instead of the “embedding disabled”
banner.

## Flutter docs

- [First Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Cookbook](https://docs.flutter.dev/cookbook)

Flutter’s [online documentation](https://docs.flutter.dev/) covers tutorials,
samples, guidance on mobile development, and API references.
