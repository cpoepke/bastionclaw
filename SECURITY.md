# Security Policy

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Please use GitHub's private vulnerability reporting instead:

1. Go to the [Security Advisories page](https://github.com/harperaa/bastionclaw/security/advisories)
2. Click **"Report a vulnerability"**
3. Provide as much detail as possible — steps to reproduce, affected components, and potential impact

Reports are private between you and the maintainers until a fix is ready. You'll be credited in the advisory if you'd like.

## What qualifies as a security issue?

- Container escape or isolation bypass
- Secret leakage (API keys, tokens exposed to containers or logs)
- IPC privilege escalation (non-main group accessing main-group operations)
- Unauthorized command execution via messaging channels
- Mount allowlist bypass

## Response timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix**: Depends on severity, but critical issues are prioritized immediately
