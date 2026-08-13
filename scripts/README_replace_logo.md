Replace the project logo with your new image

1) Place the new image somewhere accessible (e.g., your Downloads folder) and note its full path.

2) From a PowerShell prompt run (adjust path to your image):

```powershell
cd "C:\shibi\Stafivo Main\STAFIVO"
.\scripts\replace_logo.ps1 -SourcePath "C:\Users\YOU\Downloads\new-logo.png"
```

This will:
- Backup `stafivo_web/public/brand/stafivo-logo.png` and `stafivo_mobile/assets/stafivo_logo.png` to `.bak` files
- Copy your image to both locations (overwriting existing files)

3) Rebuild and verify:

- Next.js (web admin):
```bash
cd "stafivo_web"
npm run dev
# or
yarn dev
```

- Flutter web (mobile app):
```bash
cd "stafivo_mobile"
flutter clean
flutter pub get
flutter run -d chrome
```

If you want, upload the image into the workspace (e.g., at project root) and I can run the script here and finish the replacement for you.