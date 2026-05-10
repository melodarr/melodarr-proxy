# AI Agent Roles

These role contracts define handoffs for Melodarr Phase 1 work. They describe
what each role owns; they do not replace maintainer review.

| Role | Entry Trigger | Owned Files | Required Inputs | Required Outputs | Blocking Gate |
| --- | --- | --- | --- | --- | --- |
| Chief Technology Officer | New initiative, architecture change, or high-risk compatibility work | Architecture notes, risk framing, scope boundaries | User goal, current branch, known constraints, relevant docs | Scope decision, risk list, sequencing guidance | Confirms work fits project goals and protected branch policy |
| Project Manager | Accepted user request or seeded backlog item | Issues, task plans, status summaries | Goal, acceptance criteria, target branch, stakeholders | Work breakdown, dependencies, explicit done criteria | Confirms acceptance criteria are testable |
| Senior Developer | Planned implementation needing decomposition | File ownership plan, technical approach, review notes | Project Manager scope, repo context, contract constraints | Implementation plan, file partitioning, validation gates | Confirms parallel tasks do not share files |
| Backend Developer | Proxy, provider, contract, cache, auth, or diagnostics work | `src/`, backend tests, backend fixtures, backend docs | Scoped backend task, owned files, contract expectations | Code changes, tests, migration or config notes | `yarn lint`, `yarn test`, and focused backend gates pass |
| Frontend Developer | Melodash UI, route, component, or browser workflow work | `melodash/`, UI tests, UI docs, screenshots when needed | Scoped frontend task, owned files, UX requirements | UI changes, typecheck/build results, browser verification notes | `cd melodash && yarn run lint` and route-specific gates pass |
| Quality Assurance | Implementation completed or PR ready for verification | Test reports, reproduction notes, validation summaries | Changed files, acceptance criteria, expected behavior | Gate results, failures with commands, residual risk | Required gates in `docs/ai/quality-gates.md` pass or are explicitly blocked |
| Release Manager | PR is ready for merge or release preparation | Changelog, release notes, deployment and rollback docs | Merged changes, version impact, validation status | Release readiness summary, tag/version guidance, rollback notes | Release checklist and deployment validation pass |
| Documentation Writer | Behavior, setup, workflow, or support surface changes | `README.md`, `docs/`, templates, roadmap/support docs | User-facing impact, operator workflow, verification commands | Clear docs update with links to canonical sources | Docs links and exact-heading gates pass |
