# Security Setup Checklist

These GitHub Actions workflows run automatically on push and PR.
The items below require **manual configuration in GitHub repo settings** —
they cannot be enabled via a workflow file.

---

## GitHub Settings → Security (enable all of these)

### Secret Scanning
`Settings → Security → Secret scanning → Enable`

Scans every push for known secret patterns (API keys, tokens, credentials).
Alerts are private to repo admins. Enable "Push protection" to block commits
containing secrets before they land.

### Dependabot Alerts
`Settings → Security → Dependabot alerts → Enable`

Monitors dependencies across all languages in the stack for known CVEs.
Covers: npm (auth-service, ui), pip (email-service, dealer-ai),
Go modules (gateway, game-state, deck-service, etc.), Maven/Gradle (bank-service).

### Dependabot Security Updates
`Settings → Security → Dependabot security updates → Enable`

Auto-opens PRs to update vulnerable dependencies. The dependency-review
workflow in `security.yml` catches these on PR before they merge.

### Code Scanning (CodeQL)
`Settings → Security → Code scanning → Set up → Advanced`

The `codeql.yml` workflow handles this automatically once the repo has
Actions enabled. No additional settings required.

---

## Workflow Summary

| Workflow | Trigger | What it catches |
|---|---|---|
| `codeql.yml` | push, PR, weekly | Code vulnerabilities across all languages |
| `security.yml` | push, PR | Committed secrets (gitleaks), vulnerable new deps |
| `dockerfile-lint.yml` | push, PR (Dockerfile changes) | Container security anti-patterns |

---

## The Rule

**The first commit to any new project should be:**
1. `.gitignore` — before any code exists
2. This checklist completed
3. GitHub secret scanning push protection enabled

Not before production. Not when the skeleton is working. **First commit.**

A credential that hits version control — even briefly, even in a private repo —
should be considered compromised and rotated. The push protection setting
prevents the problem rather than detecting it after the fact.
