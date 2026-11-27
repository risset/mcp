// The central publisher requires a successful *completed* docs-generate-html.yml
// run. Dispatch from workflow_run, not from within the source build itself.
module.exports = async function prepareDevPublication({github, context, core, enabled}) {
    const event = context.payload.workflow_run;
    const repository = `${context.repo.owner}/${context.repo.repo}`;
    const branch = context.payload.repository.default_branch;
    if (repository !== 'neo4j/mcp' || enabled !== 'true' ||
        event?.conclusion !== 'success' || event.event !== 'workflow_dispatch' ||
        event.head_repository?.full_name !== repository || event.head_branch !== branch) return;

    const {data: run} = await github.rest.actions.getWorkflowRun({
        ...context.repo, run_id: event.id,
    });
    if (run.status !== 'completed' || run.conclusion !== 'success' ||
        run.event !== 'workflow_dispatch' || run.head_branch !== branch ||
        run.head_repository?.full_name !== repository ||
        run.path !== '.github/workflows/docs-generate-html.yml') {
        throw new Error('Refusing to publish an unverified source workflow run');
    }
    const {data: head} = await github.rest.repos.getBranch({...context.repo, branch});
    if (run.head_sha !== head.commit.sha) {
        core.info('Skipping an outdated build: the default branch has moved.');
        return;
    }
    const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
        ...context.repo, run_id: run.id, per_page: 100,
    });
    for (const name of ['docs', 'antora-log']) {
        if (artifacts.filter(item => item.name === name && !item.expired).length !== 1) {
            throw new Error(`Expected one unexpired ${name} artifact`);
        }
    }
    core.setOutput('payload', JSON.stringify({
        org: context.repo.owner,
        repo: context.repo.repo,
        run_id: run.id,
        publish_env: 'dev',
    }));
    core.setOutput('allowed', 'true');
};
