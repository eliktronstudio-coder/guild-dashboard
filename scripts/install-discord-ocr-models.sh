#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ]
root=/var/lib/xd-discord-ocr-models
install -d -m 755 -o root -g root "$root"
revision=e12c65a915945e4c28e237a9b52bc4a8f39a0cec
for language in eng rus; do
 case "$language" in
  eng) expected=8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba ;;
  rus) expected=b617eb6830ffabaaa795dd87ea7fd251adfe9cf0efe05eb9a2e8128b7728d6b6 ;;
 esac
 target=$root/$language.traineddata
 if [ -f "$target" ] && printf '%s  %s\n' "$expected" "$target" | sha256sum --check --status; then continue; fi
 temporary=$(mktemp "$root/.${language}.XXXXXX")
 trap 'rm -f "$temporary"' EXIT
 curl --fail --silent --show-error --location --proto '=https' --max-time 120 "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/$revision/$language.traineddata" -o "$temporary"
 printf '%s  %s\n' "$expected" "$temporary" | sha256sum --check --status
 chmod 644 "$temporary"
 mv "$temporary" "$target"
 trap - EXIT
done
echo 'Pinned Russian/English high-accuracy OCR models verified.'
