# Contributing to Melodarr Proxy

First off, thanks for taking the time to contribute!

All types of contributions are encouraged and valued. See the Table of Contents for different ways to help and details about how this project handles them. Please make sure to read the relevant section before making your contribution. It will make it a lot easier for us maintainers and smooth out the experience for all involved. The community looks forward to your contributions.

## Code of Conduct

This project and everyone participating in it is governed by a Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to see if the problem has already been reported.

When you are creating a bug report, please include as many details as possible:
* **Use a clear and descriptive title** for the issue to identify the problem.
* **Describe the exact steps which reproduce the problem** in as many details as possible.
* **Provide specific examples to demonstrate the steps.** Include links to files or copy/pasteable snippets.
* **Describe the behavior you observed after following the steps** and point out what exactly is the problem with that behavior.
* **Explain which behavior you expected to see instead and why.**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. 

When you are creating an enhancement suggestion, please include as many details as possible:
* **Use a clear and descriptive title** for the issue to identify the suggestion.
* **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
* **Describe the current behavior** and **explain which behavior you expected to see instead** and why.
* **Explain why this enhancement would be useful** to most users.

### Pull Requests

* Fill in the required template
* Do not include issue numbers in the PR title
* Follow the code style of the project
* Document new code
* End all files with a newline

## Contribution Decision Process

Most changes are handled through normal pull request review. Maintainers look for:

* preserved Lidarr/SkyHook response compatibility
* focused scope
* tests proportional to risk
* clear docs when behavior, install steps, or operator workflows change
* no avoidable instability in provider aggregation, cache behavior, or circuit breaker recovery

Larger changes should start as an issue before implementation, especially when they affect public API shape, Docker/Proxmox installs, provider aggregation, Melodash navigation, release automation, or security posture.

See [GOVERNANCE.md](GOVERNANCE.md) for project decision-making and [MAINTAINERS.md](MAINTAINERS.md) for ownership.

AI-assisted work follows the Phase 1 operating model in [docs/ai/phase-1-operating-model.md](docs/ai/phase-1-operating-model.md).

## Breaking Changes

Breaking changes require an issue, migration notes, changelog entry, and updated docs before release.

Examples include:

* changing Lidarr/SkyHook response shape
* removing or renaming public endpoints
* changing default ports, images, volumes, or required services
* changing persistent data format in `/data`
* removing environment variables without a replacement

When possible, deprecate first and keep compatibility aliases until removal is necessary.

## Setup Local Environment

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/melodarr-proxy.git`
3. Install dependencies: `yarn install`
4. Copy `.env.example` to `.env` and adjust the variables.
5. Start the development server: `yarn dev`

## Code Style

This project follows standard JavaScript style guidelines.

Before submitting a pull request, run:

```bash
yarn lint
yarn test
```

For Docker verification:

```bash
docker compose --profile test build test
```
