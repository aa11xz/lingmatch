# Android release signing

LingMatch keeps `applicationId` and Capacitor `appId` at `com.aa11xz.lingmatch`. Release APKs must use the same private signing key as the APK already installed on the phone. A different key cannot update that installation.

Before configuring GitHub Actions, compare the installed APK's certificate SHA-256 fingerprint with the candidate keystore certificate. Do not upload a keystore to GitHub until the fingerprints match.

The currently installed phone APK and `LingMatch-v2-debug.apk` were both verified with certificate SHA-256 `5b157f2eaad97823bb47d3f41a989eebc61370b01ffaa38442f3bf0ee0783fb8`. The same public fingerprint is pinned in `android/gradle.properties`; local Gradle and GitHub Actions both read that single source. Do not change the pin unless the phone's installed app and the replacement signing key have been deliberately migrated together.

This is the existing Android Debug signing identity, and its keystore uses the standard `android` password. It is retained because the installed app depends on this certificate. The source keystore remains unchanged. Repository Actions secrets now hold the same keystore and alias. A separate DPAPI-encrypted copy is stored at `%USERPROFILE%\Documents\LingMatchSigningBackup\lingmatch-debug-keystore.dpapi`; it is restricted to the current Windows account and cannot be restored under a different account or machine.

The repository has these Actions secrets configured for the same verified keystore:

- `LINGMATCH_KEYSTORE_BASE64`: base64 encoding of the verified keystore file.
- `LINGMATCH_KEY_ALIAS`: key alias in that keystore.
- `LINGMATCH_KEYSTORE_PASSWORD`: keystore password.
- `LINGMATCH_KEY_PASSWORD`: private key password.

The `Build LingMatch Android APK` workflow intentionally stops if any signing secret is missing. Gradle checks the keystore certificate before packaging, and the workflow checks that the final APK has exactly one signer with the pinned certificate before upload. A mismatch fails the workflow and prevents artifact upload. The workflow removes its temporary keystore copy and assigns a monotonically increasing `versionCode` starting above the installed versionCode 4.

Local Gradle builds default to version `2.0.3` / `versionCode 5`. Override with `-PlingmatchVersionCode=...` and `-PlingmatchVersionName=...` when needed. A local release build also requires `LINGMATCH_KEYSTORE_PATH`, `LINGMATCH_KEY_ALIAS`, `LINGMATCH_KEYSTORE_PASSWORD`, and `LINGMATCH_KEY_PASSWORD`. The source-controlled certificate pin is checked automatically.

The v5 IndexedDB migration retains vocabularies, preferences, results, practice events, study tasks, and the original `learningProfiles` records. It creates new progress rows from legacy profiles without clearing the original rows, so learning data remains recoverable if a field needs remapping.
