# Releasing the macOS recorder

The recorder uses Sparkle 2 to check for and install updates automatically. Release archives and the Sparkle appcast are hosted in GitHub Releases.

The app uses a stable private code signing certificate. It is not signed with an Apple Developer ID certificate and is not notarized. The stable identity preserves macOS permission grants across releases. Sparkle update archives are also signed with EdDSA so installed apps can verify future downloads.

The release target is arm64 macOS 15 or newer. The workflow uses Node.js 24 for the bundled sidecar and Swift Testing for the recorder package.

## One time GitHub setup

The repository requires three Actions secrets:

1. `SPARKLE_PRIVATE_KEY` contains the existing Sparkle EdDSA private key. Its public key is embedded in `script/build_and_run.sh`. Keep the local Keychain item named `meeting-note` as the recovery copy.
2. `MACOS_RELEASE_CERTIFICATE` contains the base64 encoded PKCS12 certificate named `Tape Desktop Release`.
3. `MACOS_RELEASE_CERTIFICATE_PASSWORD` contains the PKCS12 password.

The private release certificate is not an Apple certificate. Do not replace it for routine releases. Replacing it changes the app identity and invalidates existing macOS permission grants.

No Apple Developer or App Store Connect secrets are required for this release mode.

The embedded `SPARKLE_FEED_URL` points to the stable `macos-appcast` release in `glazec/tape`. `tests/local-recorder-packaging.test.ts` verifies that this origin stays aligned with the repository URL in `package.json`.

Release and local builds both use a UTC timestamp in `YYYYMMDDHHMMSS` format for `CFBundleVersion`. Sparkle compares this value rather than the displayed semantic version. Do not replace it with a Git commit count or another lower numbering scheme.

## Publish a release

Create and push a semantic version tag from `main`:

```bash
git switch main
git pull --ff-only
git tag mac-v0.3.1
git push origin mac-v0.3.1
```

Run the complete repository gate before tagging:

```bash
npm run verify:all
```

To build the same signed assets without publishing a release, run the workflow manually with a semantic version. Download the `Tape-Desktop-VERSION` Actions artifact after the run succeeds.

The `Release macOS recorder` workflow then:

1. Runs the Swift and sidecar tests.
2. Builds the arm64 app with the hardened runtime.
3. Applies the stable release signature to the app, Sparkle helpers, Node runtime, and Recall SDK binaries.
4. Signs the ZIP with Sparkle EdDSA.
5. Publishes the ZIP, checksum, and installation instructions to the versioned GitHub Release.
6. Updates the stable `macos-appcast` release asset used by installed apps.

Manual runs stop after uploading the signed release candidate artifact. Tag runs also publish the GitHub Release and stable appcast.

After the workflow succeeds, verify both the versioned release and the `macos-appcast` release in the repository that matches the embedded Sparkle feed. Confirm that `appcast.xml` references the new archive and contains a Sparkle EdDSA signature.

The workflow refuses malformed tags, tags outside `main`, missing release secrets, ad hoc or inconsistent signatures, and missing Sparkle metadata.

The 0.3 release series migrates from the changing ad hoc identity used by 0.2.0 to the stable release identity. Existing users must grant Microphone, Screen Recording, Accessibility, and Notifications once after that update. Later updates retain the stable identity.

## Install the package without Apple Developer ID signing

1. Download the `Tape Desktop` ZIP from the GitHub Release.
2. Unzip it and drag `Tape Desktop.app` into `/Applications`.
3. Open Terminal and remove the quarantine attribute from this app only:

```bash
xattr -dr com.apple.quarantine "/Applications/Tape Desktop.app"
```

4. Launch the app:

```bash
open "/Applications/Tape Desktop.app"
```

5. Grant Microphone, Screen Recording, Accessibility, and Notifications when macOS asks.

If removing quarantine reports a permission error, run the same `xattr` command with `sudo`. This bypass is necessary because the app is not notarized. Only use the ZIP downloaded from the official `glazec/tape` GitHub Release and verify its published SHA256 checksum before opening it.
