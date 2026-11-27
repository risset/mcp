const {test} = require('node:test');
const assert = require('node:assert/strict');
const prepare = require('./docs-publish-dev.cjs');

function fixture() {
    const repository = {full_name: 'neo4j/mcp'};
    const run = {
        id: 42, status: 'completed', conclusion: 'success',
        event: 'workflow_dispatch', path: '.github/workflows/docs-generate-html.yml',
        head_branch: 'main', head_sha: 'abc', head_repository: repository,
    };
    const context = {
        repo: {owner: 'neo4j', repo: 'mcp'},
        payload: {repository: {default_branch: 'main'}, workflow_run: {...run}},
    };
    const outputs = {};
    const reads = [];
    const artifacts = [{name: 'docs'}, {name: 'antora-log'}];
    const github = {
        rest: {
            actions: {
                getWorkflowRun: async params => { reads.push(params); return {data: run}; },
                listWorkflowRunArtifacts: async () => artifacts,
            },
            repos: {getBranch: async () => ({data: {commit: {sha: 'abc'}}})},
        },
        paginate: async (method, params) => method(params),
    };
    const core = {info() {}, setOutput(name, value) { outputs[name] = value; }};
    return {github, context, core, enabled: 'true', run, outputs, reads, artifacts};
}

test('dispatch payload identifies the completed build and hardcodes dev', async () => {
    const f = fixture();
    await prepare(f);
    assert.equal(f.outputs.allowed, 'true');
    assert.deepEqual(JSON.parse(f.outputs.payload), {
        org: 'neo4j', repo: 'mcp', run_id: 42, publish_env: 'dev',
    });
});

for (const [name, change] of [
    ['disabled publishing', f => { f.enabled = ''; }],
    ['personal fork', f => { f.context.repo.owner = 'risset'; }],
    ['PR build', f => { f.context.payload.workflow_run.event = 'pull_request'; }],
    ['failed build', f => { f.context.payload.workflow_run.conclusion = 'failure'; }],
    ['feature branch', f => { f.context.payload.workflow_run.head_branch = 'test'; }],
    ['fork source', f => { f.context.payload.workflow_run.head_repository = {full_name: 'other/mcp'}; }],
]) {
    test(`skips ${name} before accessing artifacts`, async () => {
        const f = fixture();
        change(f);
        await prepare(f);
        assert.deepEqual(f.outputs, {});
        assert.deepEqual(f.reads, []);
    });
}

for (const [name, change] of [
    ['incomplete run', f => { f.run.status = 'in_progress'; }],
    ['wrong workflow', f => { f.run.path = '.github/workflows/docs-pr-checks.yml'; }],
    ['PR metadata mismatch', f => { f.run.event = 'pull_request'; }],
    ['failed run metadata', f => { f.run.conclusion = 'failure'; }],
]) {
    test(`rejects ${name} from the run API`, async () => {
        const f = fixture();
        change(f);
        await assert.rejects(prepare(f), /unverified source workflow/);
        assert.deepEqual(f.outputs, {});
    });
}

test('skips stale default-branch builds', async () => {
    const f = fixture();
    f.run.head_sha = 'old';
    await prepare(f);
    assert.deepEqual(f.outputs, {});
});

test('rejects missing, expired or duplicate artifacts', async () => {
    for (const artifacts of [
        [{name: 'antora-log'}],
        [{name: 'docs', expired: true}, {name: 'antora-log'}],
        [{name: 'docs'}, {name: 'docs'}, {name: 'antora-log'}],
    ]) {
        const f = fixture();
        f.artifacts.splice(0, f.artifacts.length, ...artifacts);
        await assert.rejects(prepare(f), /Expected one unexpired/);
        assert.deepEqual(f.outputs, {});
    }
});
