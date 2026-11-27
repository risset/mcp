// Used only from trusted default-branch code in the privileged preview workflows.
const fs = require('node:fs');
const path = require('node:path');

const marker = '<!-- mcp-docs-preview -->';
const maxArchiveBytes = 100 * 1024 * 1024;

function domain(context, number) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR number');
    const label = `${context.repo.owner}-${context.repo.repo}-${number}`.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(label) || label.length > 63) throw new Error('Invalid preview domain');
    return `${label}.surge.sh`;
}

async function commentFor(github, context, number) {
    const comments = await github.paginate(github.rest.issues.listComments, {
        ...context.repo, issue_number: number, per_page: 100,
    });
    return comments.find(comment =>
        comment.user?.login === 'github-actions[bot]' && comment.body?.startsWith(marker));
}

async function updateComment(github, context, number, body, existing) {
    const comment = existing || await commentFor(github, context, number);
    if (comment) {
        await github.rest.issues.updateComment({...context.repo, comment_id: comment.id, body});
    } else {
        await github.rest.issues.createComment({...context.repo, issue_number: number, body});
    }
}

async function currentPull(github, context, number, state, sha) {
    const {data: pr} = await github.rest.pulls.get({...context.repo, pull_number: number});
    const repository = `${context.repo.owner}/${context.repo.repo}`;
    if (pr.state !== state || pr.head.repo?.full_name !== repository ||
        pr.base.repo.full_name !== repository || (sha && pr.head.sha !== sha)) return null;
    return pr;
}

async function run({github, context, core, mode}) {
    const event = context.payload.workflow_run;
    let number;
    let pr;

    const cleanup = mode === 'teardown' || mode === 'removed';
    if (cleanup && context.payload.pull_request) {
        number = context.payload.pull_request.number;
    } else {
        const repository = `${context.repo.owner}/${context.repo.repo}`;
        if (event?.event !== 'pull_request' || event.conclusion !== 'success' ||
            event.head_repository?.full_name !== repository) return;
        // workflow_run.pull_requests may be empty. Look up PRs through GitHub
        // instead of accepting an artifact-supplied PR number.
        let candidates = event.pull_requests;
        if (!candidates?.length) {
            candidates = await github.paginate(github.rest.pulls.list, {
                ...context.repo, state: 'all',
                head: `${context.repo.owner}:${event.head_branch}`, per_page: 100,
            });
            candidates = candidates.filter(candidate => candidate.head.sha === event.head_sha);
        }
        if (candidates.length !== 1) return;
        number = candidates[0].number;
    }

    if (cleanup) {
        pr = await currentPull(github, context, number, 'closed');
        if (!pr || (event && pr.head.ref !== event.head_branch)) return;
        // No docs preview was ever attempted: no Surge calls or new comments needed.
        if (!await commentFor(github, context, number)) return;
    } else {
        pr = await currentPull(github, context, number, 'open', event.head_sha);
        if (!pr || pr.head.ref !== event.head_branch) return;
    }

    const host = domain(context, number);
    core.setOutput('allowed', 'true');
    core.setOutput('domain', host);

    if (mode === 'prepare') {
        const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
            ...context.repo, run_id: event.id, per_page: 100,
        });
        const matches = artifacts.filter(item => item.name === 'docs' && !item.expired);
        if (matches.length !== 1) throw new Error('Expected one unexpired docs artifact');
        if (matches[0].size_in_bytes > maxArchiveBytes) throw new Error('Docs archive too large');
        const {data} = await github.rest.actions.downloadArtifact({
            ...context.repo, artifact_id: matches[0].id, archive_format: 'zip',
        });
        const archive = Buffer.from(data);
        if (archive.length > maxArchiveBytes) throw new Error('Docs archive too large');
        fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'docs-preview.zip'), archive);
    } else if (['pending', 'published', 'failed'].includes(mode)) {
        const status = mode === 'pending'
            ? 'Documentation preview is deploying.'
            : mode === 'failed'
                ? 'Documentation preview deployment failed. Check the Deploy docs preview workflow logs.'
                : `Documentation preview: https://${host}\n\nBuilt from \`${pr.head.sha}\`.`;
        await updateComment(github, context, number, `${marker}\n${status}`);
    } else if (mode === 'removed') {
        // Recheck closure here too: a queued teardown may run after reopening.
        if (await currentPull(github, context, number, 'closed')) {
            await updateComment(github, context, number,
                `${marker}\nDocumentation preview removed because this PR was closed. Reopen the PR to rebuild it.`);
        }
    }
}

module.exports = {run, domain, marker};
