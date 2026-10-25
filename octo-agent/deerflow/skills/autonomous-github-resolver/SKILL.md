---
name: autonomous-github-resolver
description: Automatically fetches, analyzes, and resolves GitHub issues by mapping them to local sandboxes, modifying code, running tests, and opening Pull Requests using the GitHub MCP and local execution tools.
origin: OCTO-Pro
---

# Autonomous GitHub Issue Resolver

> **High-Impact Skill.** This skill allows the agent to autonomously close GitHub issues. It combines the remote `github` MCP server with local `OCTO_PROJECT_ROOT` file operations and command execution.

Fetch open issues from a GitHub repository, map the problem to the local sandbox codebase, write the patch, test it, and push a Pull Request back to GitHub.

## When to Activate

- User asks to "fix issue #42", "resolve the bug in the repo", or "handle the open GitHub issues"
- User wants to automate the process of resolving a ticket from start to PR
- User says "resolve this github issue", "close issue 15", or "fix the bug reported on github"

## MCP & Tool Requirements

- **github MCP** — `github_get_issue`, `github_create_pull_request`, `github_create_issue_comment`
- **local sandbox** — `read_file`, `write_file`, `bash`/`terminal` (for running tests/git)

Ensure the `github` MCP server is registered in your `config/mcp_servers.json` and the `OCTO_PROJECT_ROOT` environment variable is correctly set by the Projects UI.

## Workflow

### Step 1: Fetch and Analyze the Issue

1. Use the `github` MCP to fetch the details of the specified issue:
   ```
   github_get_issue(owner: "owner", repo: "repo", issue_number: <number>)
   ```
2. Read the issue title, description, and comments to fully understand the bug or feature request.
3. Post a comment indicating that the autonomous agent has started working on it:
   ```
   github_create_issue_comment(owner: "owner", repo: "repo", issue_number: <number>, body: "🤖 OCTO-Pro Autonomous Agent has started resolving this issue. I am mapping the codebase and working on a patch in my local sandbox.")
   ```

### Step 2: Map to Local Sandbox

1. Ensure the user's active `OCTO_PROJECT_ROOT` matches the repository. If not, use terminal commands to `git clone` or navigate to the correct repository.
2. Create a new git branch for the fix:
   ```bash
   git checkout -b fix/issue-<number>
   ```
3. Use your file search and read tools to locate the buggy code mentioned in the issue.

### Step 3: Write and Verify the Patch

1. Use your `write_file` or search/replace tools to implement the required fix or feature.
2. If tests exist, run them using the `bash` terminal tool (e.g., `pytest`, `npm test`, `cargo test`) to ensure the patch actually fixes the issue and doesn't break existing functionality.
3. If tests fail, iterate on the patch until it passes.

### Step 4: Commit and Push

1. Stage and commit the changes locally:
   ```bash
   git add .
   git commit -m "Fix: Resolves issue #<number> - <brief description>"
   git push origin fix/issue-<number>
   ```

### Step 5: Open the Pull Request

1. Use the `github` MCP to open a Pull Request linking the issue:
   ```
   github_create_pull_request(
     owner: "owner", 
     repo: "repo", 
     title: "Fix: Resolves #<number>", 
     body: "This PR automatically resolves issue #<number>. \n\n**Changes:**\n- [x] Fixed X\n- [x] Tested Y\n\n_Generated autonomously by OCTO-Pro._",
     head: "fix/issue-<number>",
     base: "main"
   )
   ```
2. Notify the user in the local chat that the Pull Request has been successfully submitted and the sub-agent workflow is complete.

## Quality Rules

1. **Verify locally first.** Never open a PR without attempting to run a linter, compiler, or test suite locally in the sandbox.
2. **Atomic commits.** Keep the changes strictly focused on the issue description. Do not refactor unrelated code.
3. **Clear PR descriptions.** Always link the issue (`Resolves #<number>`) so GitHub automatically closes the issue when the PR merges.

## Examples

```
"Fix issue #12 in my current project"
"Read the latest issue on our repo and submit a PR to resolve it"
"Can you handle the bug report about the login button?"
```
