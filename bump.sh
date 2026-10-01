#!/bin/bash
# 用法：
#   ./bump.sh patch   → 2.1.0 → 2.1.1  （修小 bug、微調樣式）
#   ./bump.sh minor   → 2.1.0 → 2.2.0  （修較多內容、中型功能調整）
#   ./bump.sh major   → 2.1.0 → 3.0.0  （新增全新功能）
# 會同時改 js/version.js 和 sw.js 的 VERSION，已安裝的裝置才會收到更新。

set -e
cd "$(dirname "$0")"

TYPE=${1:-patch}
CURRENT=$(grep -o "'[0-9]*\.[0-9]*\.[0-9]*'" js/version.js | tr -d "'")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case $TYPE in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  *) echo "Usage: ./bump.sh [patch|minor|major]"; exit 1 ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"

# macOS 和 Linux 的 sed -i 寫法不同，加 .bak 兩邊都能用
sed -i.bak "s/APP_VERSION = '[^']*'/APP_VERSION = '$NEW'/" js/version.js && rm js/version.js.bak
sed -i.bak "s/const VERSION = '[^']*'/const VERSION = '$NEW'/" sw.js && rm sw.js.bak

echo "✓ $CURRENT → $NEW"
