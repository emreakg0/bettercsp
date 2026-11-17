<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# BetterCSP development instructions

## Project and scope

- BetterCSP is an independent, modern replacement for Rutgers University's Course Schedule Planner (CSP).
- Improve course scheduling, registration preparation, and recovery beyond recreating the existing CSP interface.
- **Students should never be left confused, panicked, or without a clear next step when course registration becomes complicated.**
- Project initialization covers documentation and agent configuration only. Do not implement application features until setup is complete and a subsequent task authorizes them.
- Preserve the user's existing work, configuration, and useful boilerplate conventions.

## Stack and repository conventions

- Use Next.js App Router, React, TypeScript, Tailwind CSS, and the existing boilerplate dependencies; target Vercel deployment.
- Routes and layouts currently live in `app/`; retain the existing project structure unless a task requires a change.
- Preserve TypeScript strict mode and the `@/*` alias mapped to the repository root.
- Read the relevant installed Next.js guide specified above before writing code; do not rely on remembered framework APIs.
- Prefer existing dependencies. Add packages only with a concrete justification after checking existing code and dependencies.
- Keep architecture modular and independently testable without premature abstraction.
- Before substantial architectural changes, consult docs/ARCHITECTURE.md. Read only relevant sections when possible. Update the document when implemented architecture materially changes, but do not rewrite it for minor edits.

## Commands and validation

```sh
npm run dev        # Local development
npm run lint       # ESLint
npx tsc --noEmit   # Type check using the installed TypeScript
npm run build      # Production build
npm run start      # Serve a production build
```

- `npm test` runs focused catalog normalization/search tests with Node’s native TypeScript support (Node >=22.18).
- Run checks proportionate to the change: relevant tests, type checks, and lint first; broaden validation when justified.
- For documentation-only changes, review the diff, verify referenced paths and commands, and check whitespace; application builds are unnecessary unless affected.

## Rutgers course data

- Local development snapshot: `data/rutgers/spring-2027.json`, Spring 2027 Rutgers–New Brunswick.
- Verified snapshot: 4,605 courses, 11,528 sections, approximately 20 MB of JSON.
- Official public SOC endpoints:
  - Courses: `https://classes.rutgers.edu/soc/api/courses.json?year=2027&term=1&campus=NB`
  - Open sections: `https://classes.rutgers.edu/soc/api/openSections.json?year=2027&term=1&campus=NB`
- The local file is a development snapshot, not a guaranteed source of current section availability.
- Inspect the actual schema before assuming course or section fields; preserve important Rutgers section metadata.
- Never print the entire catalog. Use focused scripts for schema, representative records, and counts.
- Treat live availability as time-sensitive; make freshness and uncertainty clear when relevant.

## Product priorities

1. Fast course searching and filtering.
2. Conflict-free schedule generation.
3. Personalized schedule ranking.
4. Honors-section and eligibility-restriction detection.
5. Prerequisite and special-permission warnings.
6. Automatic schedule recovery when selected sections become unavailable.
7. Registration Rescue Mode offering the smallest necessary schedule changes.
8. Saved schedules, backups, and WebReg handoff.
9. Rutgers campus-aware commute considerations.
10. Clear, low-stress, accessible UI with actionable error explanations.

## Correctness, architecture, and trust

- Prioritize registration correctness and user trust; use deterministic scheduling and eligibility validation rather than AI for correctness.
- Separate Rutgers data ingestion, schedule generation, eligibility validation, and UI.
- Keep scheduling algorithms deterministic and independently testable.
- Do not claim a student is eligible unless available information supports it. Rutgers WebReg is the final authority on registration eligibility.
- Do not bypass Rutgers authentication or automatically submit enrollment transactions.
- Favor simple, responsive, accessible UI over excessive effects; avoid generic AI-generated dashboard aesthetics.
- Explain failures clearly and give students actionable next steps.
- Build practical reusable components; search before introducing abstractions or duplicate systems.

## Mandatory Codex token optimization

These rules apply to every task. Token optimization must never compromise correctness, security, or required testing.

### Installed skills and usage

- Discover actually installed skills in `.agents/skills/`, `~/.agents/skills/`, and `~/.codex/skills/` as appropriate; never assume installation from a list alone.
- At initialization, all six skills below were verified under `~/.agents/skills/<skill>/SKILL.md`. Other skills may be available; recheck availability when needed.
- Use progressive disclosure: read only relevant `SKILL.md` files, not every installed skill on every task.
- `token-discipline`: apply its principles throughout every task; minimize unnecessary context, output, calls, repeated explanations, and redundant investigation.
- `reuse-before-create`: apply before implementing new functionality; search existing components, utilities, functions, patterns, and dependencies, then prefer reuse or extension.
- `task-router`: use for substantial or ambiguous tasks when available; choose a minimal workflow and only relevant skills, respecting its supported-host scope.
- `debugger`: use for complex debugging; identify root causes and make targeted fixes rather than speculative rewrites.
- `code-review`: use for meaningful changes involving correctness, security, or architecture; avoid full-repository reviews for trivial edits.
- `handoff`: use for substantial task completion or context transfer when useful; keep it focused on completed changes, unresolved issues, and next steps.

### Engineering rules

1. Use `rg`, `rg --files`, and precise paths for targeted discovery; avoid full directory listings and large file dumps.
2. Read only relevant files and line ranges; do not repeatedly reread unchanged code.
3. Inspect large data with focused scripts, especially the Rutgers catalog; never dump it into context.
4. Search before creating components, utilities, hooks, functions, or abstractions; reuse existing implementations.
5. Make the smallest maintainable change that fully solves the task.
6. Preserve working code; avoid unnecessary rewrites.
7. Start with focused validation; expand only when justified by the change or evidence.
8. Batch related independent operations when practical; avoid repetitive commands and unnecessary external searches.
9. Do not spawn subagents for tasks one agent can complete efficiently; follow host restrictions on delegation.
10. Keep progress summaries and final responses concise; avoid repeating code or lengthy explanations unless requested.
11. Stop when finished; do not invent features, refactor unrelated code, or expand scope without authorization.
12. Maintain concise persistent documentation for major architectural decisions instead of relying on conversation history.

## Generated and existing artifacts

- Do not manually edit generated output or dependencies such as `.next/`, `out/`, or `node_modules/`.
- Targeted reads of installed Next.js documentation remain required by the preserved framework instructions.
- Preserve the downloaded Rutgers snapshot and unrelated user changes; do not rewrite or refresh data as a side effect.

## Task completion

1. Understand the request and identify relevant existing code or documentation.
2. Apply appropriate installed skills.
3. Make focused changes within the authorized scope.
4. Run proportionate validation.
5. Report what changed, what was tested, and any remaining issues concisely.
