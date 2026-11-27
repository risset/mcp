const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {run, domain, marker} = require('./docs-preview.cjs');

function fixture() {
    const repository = {full_name: 'example/mcp'};
    const pr = {
        number: 42, state: 'open',
        head: {sha: 'abc123', ref: 'docs-test', repo: repository},
        base: {repo: repository},
    };
    const context = {
        repo: {owner: 'example', repo: 'mcp'},
        payload: {
            workflow_run: {
                id: 123, event: 'pull_request', conclusion: 'success',
                head_repository: repository, head_branch: 'docs-test',
                head_sha: pr.head.sha, pull_requests: [{number: pr.number}],
            },
            pull_request: {number: pr.number},
        },
    };
    const outputs = {};
    const comments = [];
    const writes = [];
    const artifacts = [{id: 7, name: 'docs', expired: false, size_in_bytes: 3}];
    const downloads = [];
    const rest = {
        pulls: {
            get: async () => ({data: pr}),
            list: async () => [pr],
        },
        issues: {
            listComments: async () => comments,
            createComment: async data => writes.push({action: 'create', ...data}),
            updateComment: async data => writes.push({action: 'update', ...data}),
        },
        actions: {
            listWorkflowRunArtifacts: async () => artifacts,
            downloadArtifact: async data => {
                downloads.push(data);
                return {data: Buffer.from('zip')};
            },
        },
    };
    const github = {rest, paginate: async (method, params) => method(params)};
    const core = {setOutput: (name, value) => { outputs[name] = value; }};
    return {github, context, core, pr, outputs, comments, writes, artifacts, downloads};
}

test('domain is derived from trusted repository metadata and PR number', () => {
    assert.equal(domain(fixture().context, 42), 'example-mcp-42.surge.sh');
    assert.throws(() => domain(fixture().context, '42'));
});

test('downloads only the docs artifact from the triggering workflow run', async () => {
    const f = fixture();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-preview-test-'));
    const previous = process.env.RUNNER_TEMP;
    process.env.RUNNER_TEMP = directory;
    try {
        await run({...f, mode: 'prepare'});
        assert.equal(f.outputs.allowed, 'true');
        assert.equal(fs.readFileSync(path.join(directory, 'docs-preview.zip'), 'utf8'), 'zip');
        assert.equal(f.downloads[0].artifact_id, 7);
    } finally {
        if (previous === undefined) delete process.env.RUNNER_TEMP;
        else process.env.RUNNER_TEMP = previous;
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

for (const [name, change] of [
    ['failed build', f => { f.context.payload.workflow_run.conclusion = 'failure'; }],
    ['manual build', f => { f.context.payload.workflow_run.event = 'workflow_dispatch'; }],
    ['fork build', f => { f.context.payload.workflow_run.head_repository = {full_name: 'other/mcp'}; }],
    ['fork PR', f => { f.pr.head.repo = {full_name: 'other/mcp'}; }],
    ['closed PR', f => { f.pr.state = 'closed'; }],
    ['stale commit', f => { f.pr.head.sha = 'newer'; }],
    ['different branch', f => { f.pr.head.ref = 'another-branch'; }],
    ['ambiguous PR', f => { f.context.payload.workflow_run.pull_requests.push({number: 43}); }],
]) {
    test(`skips ${name} without downloading or commenting`, async () => {
        const f = fixture();
        change(f);
        await run({...f, mode: 'prepare'});
        assert.deepEqual(f.outputs, {});
        assert.deepEqual(f.downloads, []);
        assert.deepEqual(f.writes, []);
    });
}

test('falls back to GitHub PR lookup when the run has no PR association', async () => {
    const f = fixture();
    f.context.payload.workflow_run.pull_requests = [];
    await run({...f, mode: 'pending'});
    assert.equal(f.writes[0].issue_number, 42);
});

test('rejects missing, expired, duplicate or oversized artifacts', async () => {
    for (const artifacts of [
        [], [{name: 'docs', expired: true}],
        [{name: 'docs'}, {name: 'docs'}],
        [{name: 'docs', size_in_bytes: 101 * 1024 * 1024}],
    ]) {
        const f = fixture();
        f.artifacts.splice(0, f.artifacts.length, ...artifacts);
        await assert.rejects(run({...f, mode: 'prepare'}));
        assert.deepEqual(f.downloads, []);
    }
});

test('creates a pending comment, then updates only the bot-owned preview comment', async () => {
    const f = fixture();
    await run({...f, mode: 'pending'});
    assert.equal(f.writes[0].action, 'create');
    assert.match(f.writes[0].body, /deploying/);
    f.comments.push({id: 1, user: {login: 'someone'}, body: marker});
    f.comments.push({id: 2, user: {login: 'github-actions[bot]'}, body: marker});
    await run({...f, mode: 'published'});
    assert.equal(f.writes[1].action, 'update');
    assert.equal(f.writes[1].comment_id, 2);
    assert.match(f.writes[1].body, /https:\/\/example-mcp-42.surge.sh/);
});

test('reports failed deployment in the existing bot comment', async () => {
    const f = fixture();
    f.comments.push({id: 2, user: {login: 'github-actions[bot]'}, body: marker});
    await run({...f, mode: 'failed'});
    assert.equal(f.writes[0].action, 'update');
    assert.match(f.writes[0].body, /deployment failed/);
});

test('teardown skips PRs without a preview comment', async () => {
    const f = fixture();
    f.pr.state = 'closed';
    await run({...f, mode: 'teardown'});
    assert.deepEqual(f.outputs, {});
    assert.deepEqual(f.writes, []);
});

test('teardown derives the site from a closed same-repository PR', async () => {
    const f = fixture();
    f.pr.state = 'closed';
    f.comments.push({id: 2, user: {login: 'github-actions[bot]'}, body: marker});
    await run({...f, mode: 'teardown'});
    assert.equal(f.outputs.domain, 'example-mcp-42.surge.sh');
    await run({...f, mode: 'removed'});
    assert.match(f.writes[0].body, /preview removed/);
});

test('a late workflow_run cleans a closed PR even if its queued teardown was replaced', async () => {
    const f = fixture();
    delete f.context.payload.pull_request;
    f.pr.state = 'closed';
    f.comments.push({id: 2, user: {login: 'github-actions[bot]'}, body: marker});
    await run({...f, mode: 'prepare'});
    assert.deepEqual(f.outputs, {});
    await run({...f, mode: 'teardown'});
    assert.equal(f.outputs.domain, 'example-mcp-42.surge.sh');
    assert.deepEqual(f.downloads, []);
});

for (const [name, listing, status, removed] of [
    ['existing site', '\\x1b[90mexample-mcp-42.surge.sh\\x1b[0m  owner@example.invalid', 0, true],
    ['missing site', 'another-mcp-42.surge.sh  owner@example.invalid', 0, false],
    ['authentication failure', '', 1, false],
]) {
    test(`Surge cleanup handles ${name}`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-preview-surge-'));
        const bin = path.join(directory, 'surge/node_modules/.bin');
        fs.mkdirSync(bin, {recursive: true});
        fs.writeFileSync(path.join(bin, 'surge'), `#!/usr/bin/env bash
if [ "$1" = list ]; then
    printf '%b\\n' "$TEST_LISTING"
    exit "$TEST_STATUS"
fi
if [ "$1" = teardown ]; then
    printf '%s' "$2" > "$RUNNER_TEMP/removed"
fi
`, {mode: 0o700});
        try {
            const result = spawnSync('bash', [path.join(__dirname, 'docs-preview-remove.sh')], {
                env: {...process.env, RUNNER_TEMP: directory, SURGE_TOKEN: 'dummy',
                    DOMAIN: 'example-mcp-42.surge.sh', TEST_LISTING: listing,
                    TEST_STATUS: String(status)},
                encoding: 'utf8',
            });
            assert.equal(result.status, status, result.stderr);
            assert.equal(fs.existsSync(path.join(directory, 'removed')), removed);
            if (removed) assert.equal(fs.readFileSync(path.join(directory, 'removed'), 'utf8'),
                'example-mcp-42.surge.sh');
        } finally {
            fs.rmSync(directory, {recursive: true, force: true});
        }
    });
}

test('queued teardown skips a reopened PR', async () => {
    const f = fixture();
    f.comments.push({id: 2, user: {login: 'github-actions[bot]'}, body: marker});
    await run({...f, mode: 'teardown'});
    await run({...f, mode: 'removed'});
    assert.deepEqual(f.outputs, {});
    assert.deepEqual(f.writes, []);
});
