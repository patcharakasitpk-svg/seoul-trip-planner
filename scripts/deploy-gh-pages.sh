#!/usr/bin/env bash
# Build แล้ว push โฟลเดอร์ dist/ ขึ้น branch gh-pages (GitHub Pages แบบฟรี ไม่ต้องใช้ Actions)
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
touch dist/.nojekyll
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
cp -R dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git commit -q -m "deploy: $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "$REMOTE" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "Deployed to gh-pages"
