#!/bin/bash
# verify_files.sh
#
# Run this from your app root (same folder as main.js, index.html).
# It checks every file Claude has touched against its known-correct
# checksum and tells you exactly which ones are missing or out of date.
#
# Usage:
#   chmod +x verify_files.sh
#   ./verify_files.sh
#
# Written for bash 3.2 (macOS's default) -- no associative arrays.
#
# NOT included on purpose: config.js and google-oauth.config.js (you
# correctly hold real, personalized values there that will never match
# a generic reference copy), preload-additions.js (a one-time merge
# instruction file, never meant to exist standalone -- its content is
# already inside preload.js), and the two migration_*.sql files
# (one-time scripts already run directly against Supabase, not part of
# the running app).

CHECKSUMS='
backend/api/src/db/audit.js a9e197502f25f3e26da0271b85931060
backend/api/src/db/concurrency.js 743fc22ab7c75fe93ec47b89120b5f2e
backend/api/src/db/idempotency.js f4240c71c5b8325c132b9340e33da716
backend/api/src/db/pool.js 5fb9863d8fd9524c7162a29bb171a8c8
backend/api/src/db/sequence.js 3624d4cda8fa559c6f449aba5bd3ad5d
backend/api/src/db/storage.js 3ebf3968e109fb33947d70d8c3b3fef5
backend/api/src/middleware/auth.js 17ca4d3485349012372b9ddda4cc5fee
backend/api/src/routes/boqItems.js 31006ea36cdf1042b10a085419f563f5
backend/api/src/routes/changeOrders.js 8cea083c4988ca191763d6803cc72d9c
backend/api/src/routes/clients.js 940c73a76b032e79d391a58f72e973a8
backend/api/src/routes/documents.js b1ad62dffc504535e75bb3da36b5137f
backend/api/src/routes/estimates.js 4857dad5d65b608456ff2339d6946a20
backend/api/src/routes/inspections.js 7056d22b48ae0b2782b89dea2a3e3ce8
backend/api/src/routes/misc.js df051d8d09c3ee147f4ac55412720150
backend/api/src/routes/payments.js 2fe5fd50d968b322a7262e3a309c0781
backend/api/src/routes/photoLinks.js c5f4e0f81efe44efc0a6200d1239adc5
backend/api/src/routes/photos.js 11d9b4c79a3fe1b80e1245878f56cc33
backend/api/src/routes/profile.js 3ab33d32914dc33b48b5e38b816a94fb
backend/api/src/routes/progressLogs.js 747aa66c296ebb038bf48f1e9475bfa1
backend/api/src/routes/projects.js ff98a72cf16e249ea65925e5cebeaccd
backend/api/src/routes/settings.js 714f6ba461a28ecebe1a6e2afac89eab
backend/api/src/routes/snags.js 5270aa20954fdc5d9322dc5a594428a6
backend/api/src/routes/takeOffGroups.js 1c6ca1e8987792d0dde3e98f92ecbe72
backend/api/src/routes/takeOffTemplates.js a5f4f397421c43de97fadfacd8e4f544
backend/api/src/routes/takeOffs.js 29d448d96512721d23892465dbef1f06
backend/api/src/routes/taskGroups.js b35c7cb371bf00659c12147b2717ea18
backend/api/src/routes/tasks.js 7e6830bcc0690db5a6afdb6ff87d78a1
backend/api/src/routes/units.js eec79212bc26630782132d056d88b6ed
backend/api/src/routes/vendors.js 38023a9a6ae97a8bc0c858898cfc6050
backend/api/src/routes/workOrders.js c018945749bfb7d4b3ac8a8279602339
backend/api/src/server.js d05f928dc1bf941e77e3b242febe0380
accounts.js f750f7eba2cd2a2ab41dd49dd9ef1fc1
app.js 8c7ea11e62ce51d297c37475f9836bc8
backup.js 03da1344dd85bd59357210020d299b8b
branding.js 29b0bfb991b4a70dc25882182bcd35e9
changeorders.js e29e63b95e561386d87f6a92cd581ce6
console.js 3b6eae88310dae5850f32b4d36f81c9b
dashboard.js 4f20bdb3d347bcb84ac36e05d143b3b4
db.js 1fe6100d73c2db4dcfbd11525eb29e58
estimates.js ed00ca3eb1fead7cc9d1be9dd1f3e91a
index.html 24fea82e0bd1c6136e95fc0f4d60508d
main.js 05adadf47f13bdbdbcf0f3101eda7062
modals.js 016a6fc50fb0340b258ee7b2653f09f9
photos.js 4e349ff3cb019752e197c2fef84addc3
preload.js 3fa939a3b3cff8b72451bf471053a3c2
projectexport.js aa34cda826dacf03bb3c5f9ddd947ad0
projecttrash.js c0f023cd485b1dea83f4c05d87467b78
reports.js 4bb48f1e71cffc2ce2e0b8b928d99556
search.js 370a942bfd36a80a25eb7d22622b8cf1
tasks.js c2896a929a68494437a5338636ce1840
utils.js be916cceccc3f21f2499b536dc34556f
workorder-helpers.js 1ac91a6b7e97c0af9842903c8b030f7a
'

echo "$CHECKSUMS" | grep -v '^[[:space:]]*$' | while IFS=' ' read -r file expected; do
  if [ -z "$file" ]; then continue; fi
  if [ ! -f "$file" ]; then
    echo "MISSING:   $file"
    continue
  fi
  if command -v md5 >/dev/null 2>&1; then
    actual=$(md5 -q "$file")
  else
    actual=$(md5sum "$file" | cut -d' ' -f1)
  fi
  if [ "$actual" != "$expected" ]; then
    echo "MISMATCH:  $file"
  fi
done

echo ""
echo "----------------------------------------"
echo "Any file not listed above with MISSING or MISMATCH is confirmed correct."
echo "Send Claude the MISMATCH/MISSING list if anything shows up."
echo "----------------------------------------"
