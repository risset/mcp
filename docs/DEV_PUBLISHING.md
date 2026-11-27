# Publishing MCP documentation to dev

This is a dev-only rollout. It does not enable production publishing or replace the existing `docs-mcp` production workflow.

## Workflows

- `docs-generate-html.yml` ("Generate docs HTML (dev)") builds `docs/public/publish.yml`, verifies its log, and retains the site artifact. It runs on docs PRs for testing, and can be started manually.
- `docs-publish-dev.yml` ("Publish docs to dev") runs after the build has **completed successfully**. It can dispatch only a manually started, current-default-branch build from `neo4j/mcp`, with the enable variable set.
- The dispatch always targets `neo4j/docs-publish`, event `publish-html`, environment `dev`. There is no production input.
- Personal forks and PR builds can generate artifacts, but never dispatch them to the central publisher.

Dispatch is separate from generation because the central publisher checks that the source run has already completed successfully and came from `docs-generate-html.yml`.

Version 2 comes from this repository. Version 1 remains on `neo4j/docs-mcp` branch `1.x`.

## Before enabling publication

Coordinate these steps with the documentation infrastructure maintainers.

1. **Confirm the dev destination.** The actual upload prefix and public URL are controlled by the central publisher's `dev` environment, not by the dispatching repository. Confirm `DOCS_PREFIX`, `PUBLISH_PATH`, and whether `DRYRUN` is enabled.
   - At the time this workflow was added, the shared `docs-tools@v2` publish build targets `https://development.neo4j.dev/docs/sandbox/restructure/docs` and uses the restructure UI bundle. Confirm that this matches the agreed destination before publishing.
   - Setting a different Antora URL does **not** select or isolate an S3 upload destination.
2. **Agree who writes dev MCP docs.** Both this build and `docs-mcp` produce `mcp/1` and `mcp/2`. If they use the same destination, they can overwrite each other. Either arrange an isolated central-publisher dev destination or coordinate switching only the old workflow's dev dispatch. Leave its production publishing intact.
3. **Register the source repository** in `neo4j/docs-publish/config/branch-record.yml`:

   ```yaml
   neo4j/mcp:
     dev: { ref: "main" }
   ```

   Do not add a production entry for this stage. An ingest configuration is not required to publish HTML. If the branch-record generator is used, set `DOCS_DEV_BRANCH=main` on the source repository as its mirror.
4. **Allow the central publisher to read the build.** Ensure its existing `DOCS_PUBLISH_READ_TOKEN_NEO4J` has Actions read access to `neo4j/mcp` if it is restricted to selected repositories. Personal-owner sources such as `risset/mcp` are not supported by its current read-token configuration.
5. **Configure the dispatch credential.** In `neo4j/mcp`, configure the `dev` environment with `DOCS_DISPATCH_TOKEN`. It must be able to send repository-dispatch events to `neo4j/docs-publish`, and its identity must be in that publisher's approved-sender configuration. This is not the Surge token. Apply any required reviewers and branch restrictions to the environment.
6. **Configure optional navigation credentials** (`DOCS_NAV_USER_AGENT` and/or `DOCS_TESTING_CRAWLER`) if required by the shared build's navigation fetch. Do not place credential values in files.
7. Keep the repository variable `DOCS_DEV_PUBLISH_ENABLED` unset or `false` until the preceding checks and the upstream build-only test are complete.

The workflows and helpers must be on the default branch before testing the follow-up `workflow_run` publisher. Do not change the existing PR preview setup.

## Test without publishing

In a fork, open a PR containing these files. Check the "Generate docs HTML (dev)" run:

- Publisher helper tests pass.
- The publish build contains both `mcp/1/index.html` and `mcp/2/index.html`, with their assets.
- The Antora log has no warnings or errors.
- The uploaded `docs` artifact uses the correct dev URL.
- Nothing is dispatched to `neo4j/docs-publish`.

After upstream merge, manually run the same build on `neo4j/mcp/main` with `DOCS_DEV_PUBLISH_ENABLED` still false. This verifies the upstream build and environment without publication.

## Request the first dev publication

Only after the destination and access checks are approved:

1. Set the repository variable `DOCS_DEV_PUBLISH_ENABLED=true` on `neo4j/mcp`.
2. Start the build from the default branch:

   ```sh
   gh workflow run docs-generate-html.yml --repo neo4j/mcp --ref main
   ```

3. Wait for "Generate docs HTML (dev)" to complete successfully.
4. Check "Publish docs to dev". It rechecks the completed run, source workflow, branch, current commit and artifacts before dispatching.
5. Check "Publish documentation" in `neo4j/docs-publish`. A successful dispatch alone does **not** prove the upload completed. Its run must succeed and, if `DRYRUN` is true, it has not uploaded anything.
6. Use the publisher's reported destination URL to check both versions, CSS, images, navigation and redirects.

The source build must still match the default branch's current commit. If the branch has moved, start a fresh build rather than publishing stale artifacts.

Publication is intentionally manual during this rollout. Automatic publishing on pushes can be added after the dev route has been verified and its ownership agreed.

## Rollback

Set `DOCS_DEV_PUBLISH_ENABLED=false` to stop future dispatches. This does not stop a central publish already in progress; coordinate that run with the docs maintainers if necessary.

Builds, Surge PR previews and the existing production publisher remain independent.
