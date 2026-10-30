# Security policy

## Supported versions

Only the latest release gets fixes. Its Docker image is checked every week: when a base
image (Debian or Node) has a new build, the image is rebuilt, tested, and published again
as `X.Y` and `latest`. `X.Y.Z` tags stay exactly as released, so use `latest` or `X.Y` to
get those fixes.

## Reporting a vulnerability

Please don't open a public issue. Report it privately instead:

- on GitHub: the repository's **Security** tab, then **Report a vulnerability**;
- or by email to coding@reggarantai.com.

Say what's affected, how to reproduce it, and what an attacker could do with it. You'll
get a reply within a week, and credit in the release notes if you'd like.

## How the image is kept clean

- CI scans every build with Trivy and fails on high or critical vulnerabilities that
  already have a fix, so a release can't ship with one.
- The image is distroless: no shell, no package manager, no npm. It runs as a non-root
  user, and published images carry an SBOM and provenance.
- The weekly rebuild brings in fixes from Debian and Node as they're published.

Scanners still report a few vulnerabilities in glibc, the GCC runtime libraries, and zlib
that Debian hasn't fixed, or has decided not to fix. Scanners rate them differently (Trivy
follows Debian's ratings; Docker Scout and Grype lean on CVSS scores), so their counts
don't match. Each one goes away with the rebuild after Debian fixes it. The zlib ones don't
reach the app: Node uses the zlib built into it, not the system's.

## Scope

API Contract Builder is meant to run on your own machine, for one person, so it has no
login. Publish its port on `127.0.0.1` only, as the README does: anyone who can reach the
port can read and change every contract.
