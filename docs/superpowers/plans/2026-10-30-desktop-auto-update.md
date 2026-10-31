# Desktop automatic update implementation plan

Approved behavior: download updates automatically and install on the next safe quit after recording and saving finish.

Goal: correct misleading local version labels and protect recording work during update installation.

Architecture: retain Sparkle and its signed feed, timestamp comparison, startup checks, automatic downloads, and installation on quit. Resolve development display versions from the nearest desktop release tag with a dev suffix; require explicit semantic versions for release packaging. Make the existing termination gate cover all pending capture recovery work and disable the quit override while an update is ready to install. Preserve ordinary Quit anyway when no update is pending.

1. Add executable regression probes for version resolution and the actual app termination methods. Verify failures against the old behavior.
2. Add script/app_version.sh and use it in build_and_run.sh. Preserve explicit APP_VERSION and timestamp BUILD_VERSION. Untagged source displays 0.0.0-dev.
3. Use Sparkle's installation callbacks to mark updates as requiring a safe quit. Include SDK uploads still draining in the saving guard.
4. Run the probes in the existing Swift and release gates. Update releasing and testing documentation.
5. Verify version probes, termination probes, packaging tests, Swift tests, and app compilation. Inspect the resulting package metadata. A real signed upgrade remains a separate release validation, since the current installed development build is newer than the published feed.

Execution stays in this chat. The managed worktree tool rejected the relocated repository because it is outside this chat's registered workspace; use a dedicated branch in the clean repository.

Validation completed: 72 Swift tests, 38 native process probes including 24 update cases, and 15 packaging tests passed. Swift executable compilation, shell syntax, targeted ESLint, and whitespace checks passed. The packaged app reports 0.3.6-dev, retains automatic check and download flags and the production feed URL, and passes strict nested code signature verification. No release has been published and the installed app has not been replaced.
