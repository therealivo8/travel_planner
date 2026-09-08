# PRD — Phase 12: Resume-Relevant DevOps Practices

## Overview
Phase 11 gets the app hosted, cheaply, on Vercel + Railway. That's the right call for actually
running a personal project — but it deliberately skips the tooling most 2026 software/DevOps job
descriptions ask for by name: Infrastructure as Code (Terraform is the most-named tool), a CI/CD
pipeline that actually deploys (not just lints), and container orchestration patterns. Job postings
increasingly distinguish "used it on a personal project" from "used it in a team/production setting
with state management, modules, and review process" — this phase can't manufacture the latter, but
it can make sure the former is real, working, and demonstrable, not just a resume bullet with
nothing behind it.

This phase does **not** propose switching off Railway/Vercel or duplicating the live app on AWS/Azure
— that was considered and explicitly rejected (see the conversation this PRD came from) because it
roughly doubles setup effort and cost for a stack change that doesn't make the app better, only the
resume longer. Instead, it adds the practices that layer *on top of* the existing deploy target:
IaC for the pieces that can be IaC'd without a cloud account migration, a CI/CD pipeline that
deploys (not just checks), and a couple of small operational patterns (structured environments,
a real test suite in CI) that are asked about in interviews regardless of which cloud a candidate
used.

## Prerequisites
Phase 11 (Production Deployment) complete — this phase assumes a live Railway + Vercel deployment
to point IaC and CI/CD at. Doing this phase before Phase 11 is live means writing Terraform against
resources that don't exist yet, which is possible but harder to verify.

## Goals
- A working Terraform (or OpenTofu) configuration exists in the repo that can stand up/tear down the
  Railway project and its Postgres instance, and the Vercel project — demonstrable IaC experience
  with a provider that has a real Terraform provider (both Railway and Vercel do).
- GitHub Actions CI/CD actually deploys on merge to `main` (currently it only lints/typechecks) —
  gated behind the existing checks passing, with an explicit approval or branch-protection gate
  documented, matching how real teams gate production deploys.
- A real automated test suite exists and runs in CI — currently `uv run pytest` finds zero tests.
  This is table-stakes for "CI/CD experience" to mean anything (a pipeline with no tests is just a
  deploy script).
- The repo's README documents the architecture, deploy pipeline, and IaC setup in a way that reads
  well to an interviewer or hiring manager skimming the GitHub repo — this is as much a
  documentation deliverable as an engineering one.
- None of the above increases monthly hosting cost — IaC and CI/CD are tooling around the existing
  free/low-cost resources, not new paid resources.

## Out of Scope
- Migrating to AWS/Azure/GCP, or standing up a parallel deployment there — rejected as
  disproportionate cost/effort for a personal project; noted as a possible *future*, separate
  exercise if there's ever a specific reason (e.g., practicing for an interview that specifically
  tests a given cloud), not part of this phase.
- Kubernetes — Railway and Vercel are both already container-orchestration-adjacent (Railway runs
  the Dockerfile directly; Vercel manages its own serverless infra) and neither needs k8s at this
  scale. Adding k8s here would be resume-padding without operational purpose, and it doesn't fit
  Railway's or Vercel's platform model. If this is specifically wanted for the resume line item,
  treat it as its own future phase with its own cost/complexity tradeoff discussion — not bundled
  in silently here.
- Multi-environment (dev/staging/prod) infrastructure — Phase 11 explicitly deferred a staging
  environment as out of budget; this phase's Terraform should model production only, structured so
  a `staging` workspace/module could be added later without a rewrite, but not built now.
- Load testing, chaos engineering, or SRE-style reliability tooling — not proportionate to this
  app's actual traffic; would be pure resume decoration with no operational signal behind it.

---

## Part A: Infrastructure as Code (Terraform)

### Design
Add a `infra/` directory with Terraform configuration using:
- The [Railway Terraform provider](https://registry.terraform.io/providers/terraform-community-providers/railway)
  (community-maintained — note this honestly in the README; Railway doesn't have a first-party
  provider, which is itself worth knowing/saying in an interview rather than glossing over) to
  define the Railway project, service, and Postgres plugin.
- The [Vercel Terraform provider](https://registry.terraform.io/providers/vercel/vercel) (official,
  first-party) to define the Vercel project and its environment variables (values sourced from
  `TF_VAR_*` / a `.tfvars` file that is gitignored — never commit real secret values into Terraform
  state or config).
- Remote state — Terraform Cloud's free tier is the natural fit here (also itself a resume-relevant
  detail: "used remote state with locking," not just `terraform.tfstate` on a laptop).

Structure:
```
infra/
  main.tf          # provider blocks, backend config
  railway.tf        # Railway project/service/postgres resources
  vercel.tf         # Vercel project + env vars
  variables.tf       # input variables (API tokens, secret values — no defaults for secrets)
  outputs.tf         # exposed values (service URLs) for use in docs/CI
  terraform.tfvars.example   # documents required vars without real values
```

### Acceptance Criteria
- [ ] `terraform plan` runs cleanly against the real Railway + Vercel projects created in Phase 11,
      showing no diff (i.e., the Terraform config accurately describes what's already there — either
      written to match the existing manually-created resources, or the resources are recreated via
      `terraform apply` and the manual ones decommissioned, whichever is cleaner to demonstrate).
- [ ] No real secret value (API tokens, `SECRET_KEY`, etc.) appears in any committed file — verified
      by checking `terraform.tfvars` is gitignored and `terraform.tfvars.example` contains only
      placeholder values.
- [ ] Remote state is configured (Terraform Cloud free tier or equivalent) — state file itself is
      not committed to git.
- [ ] `infra/README.md` documents how to run `terraform init/plan/apply` and what each resource
      block does, written for someone (including an interviewer) with no prior context.

---

## Part B: CI/CD Pipeline That Actually Deploys

### Design
`.github/workflows/ci.yml` currently only lints and typechecks both frontend and backend. This part
extends it — or adds a companion `deploy.yml` — so that a merge to `main` that passes CI also
triggers a real deploy, rather than relying on Vercel's/Railway's own git-push auto-deploy as the
only deploy mechanism (which works, but demonstrates nothing about GitHub Actions pipeline design,
which is the actual skill being evidenced here).

Two reasonable shapes — pick one and document the choice:
1. **Actions-driven deploy**: CI job runs `terraform apply` (Part A) and/or calls the Railway/Vercel
   CLI directly after tests pass, replacing the platforms' own auto-deploy-on-push. Gives full
   pipeline visibility in GitHub Actions logs.
2. **Actions-gated deploy**: keep Vercel/Railway's native auto-deploy, but add a required status
   check (the existing lint/typecheck job, plus Part C's new test job) as a GitHub branch protection
   rule on `main`, so a broken build can never reach the auto-deploying platforms in the first place.
   Less pipeline code, but a real and correctly-described pattern ("deploy gated on CI" is a
   legitimate, common setup — not a lesser one).

**Recommended: option 2**, extended with option 1's `terraform plan` (not `apply`) running on every
PR as a visible check — plan-on-PR/apply-on-merge is a very standard, interview-recognizable
pattern, and avoids fighting Railway/Vercel's own deploy mechanism, which is otherwise reliable and
free.

### Acceptance Criteria
- [ ] `main` has branch protection requiring the CI workflow (lint, typecheck, and Part C's tests) to
      pass before merge.
- [ ] `terraform plan` runs automatically on every PR that touches `infra/` and posts/shows its
      output somewhere visible (workflow log at minimum; a PR comment is a nice-to-have, not
      required).
- [ ] A deliberately broken PR (failing test or lint) is confirmed blocked from merging by branch
      protection, not just "would have been caught."
- [ ] The chosen deploy shape (option 1 vs. 2 above) is documented in the repo README with the
      reasoning, so it reads as a decision, not a default.

---

## Part C: Real Automated Test Suite in CI

### Design
`uv run pytest` currently collects zero tests. This isn't just a gap for resume purposes — Part B's
whole "CI gates deploy" story is meaningless without tests actually verifying behavior. Scope this
narrowly: not full coverage, but enough real, meaningful tests that CI is doing genuine work.

Minimum viable set:
- Backend: `pytest` + `httpx`'s `AsyncClient` (or FastAPI's `TestClient`) against a test database
  (a Postgres test container via `pytest-docker` or a Railway/local ephemeral DB) covering: auth
  (register/login/refresh/logout — Phase 8's fixes are exactly the kind of thing worth regression-
  testing), the two new health endpoints from Phase 11 (`/health` returns 200 with no DB dependency;
  `/health/db` returns 200 only with a working DB connection), and at least one full trip-creation
  CRUD flow.
- Frontend: whatever the existing `pnpm` toolchain supports (Vitest/Jest + React Testing Library) —
  even a small set of component/unit tests is enough to make "frontend CI" mean something beyond
  typecheck/lint. Full frontend test coverage is explicitly not required here — that's a much larger
  effort than this phase's scope.
- Both suites run in the CI workflow from Part B and gate the deploy.

### Acceptance Criteria
- [ ] `uv run pytest` in `backend/` runs a non-trivial number of real tests (not placeholders) and
      passes in CI against a real (test) database connection, not mocks-all-the-way-down.
- [ ] The two health endpoints from Phase 11 are directly tested, including the specific behavior
      that motivated splitting them (`/health` must not fail when the DB is unreachable).
- [ ] At least one frontend test exists and runs in CI.
- [ ] CI fails (and blocks merge, per Part B) when a test is broken — verified with one deliberately
      broken test, then reverted.

---

## Part D: Repo Documentation for External Readers

### Design
A root `README.md` (or a substantially expanded existing one) that an interviewer or hiring manager
skimming the GitHub repo can use to understand, in under two minutes: what the app does, the
architecture (frontend/backend/DB/external APIs), how it's deployed (link to Phase 11's runbook and
Part A's `infra/README.md`), and the CI/CD flow (link to Part B). This is explicitly a documentation
task, not new engineering — but it's the difference between the work in Phases 11-12 being visible
to an outside reader versus only visible to someone who already knows to look in `docs/prd/`.

Include a short architecture diagram (even ASCII/mermaid is fine) showing: Vercel (Next.js) →
Railway (FastAPI) → Railway Postgres, plus the external APIs (Google Maps, OpenRouteService, Sentry)
and where Terraform/CI fit around that.

### Acceptance Criteria
- [ ] Root `README.md` includes: a one-paragraph project description, an architecture diagram or
      clear textual equivalent, a "how it's deployed" section linking to the runbook, and a "CI/CD"
      section linking to the workflow.
- [ ] A person with zero prior context on this repo can read the README and correctly describe, in
      their own words, what happens between a `git push` to `main` and the change being live.

---

## Acceptance Criteria (full phase)
- [ ] Terraform config in `infra/` accurately describes the live Railway + Vercel resources, with
      remote state and no committed secrets.
- [ ] `main` is branch-protected on a CI workflow that includes real tests, not just lint/typecheck.
- [ ] `terraform plan` runs as a visible CI check on PRs touching `infra/`.
- [ ] A real (if minimal) backend test suite exists, covers auth and the Phase 11 health-endpoint
      split, and runs in CI.
- [ ] At least one frontend test exists and runs in CI.
- [ ] Root README documents architecture, deploy flow, and CI/CD clearly enough for an external
      reader (e.g., an interviewer) to follow without additional context.
- [ ] No new recurring cost was introduced (Terraform Cloud free tier, GitHub Actions free minutes
      at this repo's low usage, no new paid resources).

## Future Phase Candidates (not this phase)
- A parallel AWS or Azure deployment as a dedicated learning/portfolio exercise, kept explicitly
  separate from the live Railway+Vercel app so cost stays bounded and the "why two clouds" story
  stays clean if ever discussed in an interview.
- Kubernetes, if a specific role/interview calls for demonstrable k8s experience — noted in Phase 11
  and here as deliberately excluded from the live app's actual architecture.
- Multi-environment Terraform workspaces (dev/staging/prod) if a staging environment is ever added
  (see Phase 11's Out of Scope).
