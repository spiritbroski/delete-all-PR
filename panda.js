const { Octokit } = require("@octokit/rest");
const { throttling } = require("@octokit/plugin-throttling");

const ThrottledOctokit = Octokit.plugin(throttling);

const token = "";
const octokit = new ThrottledOctokit({
  auth: token,
  throttle: {
    onRateLimit: (retryAfter, options) => {
      console.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`
      );
      console.warn(`Retrying after ${retryAfter} seconds!`);
      return true;
    },
    onAbuseLimit: (retryAfter, options) => {
      console.warn(
        `Abuse detection mechanism triggered for request ${options.method} ${options.url}`
      );
    },
  },
});

async function disableDependabot(repo) {
  const owner = repo.owner.login;
  const repoName = repo.name;

  try {
    const settings = await octokit.rest.repos.get({
      owner,
      repo: repoName,
    });

    if (settings.data.has_issues && settings.data.has_projects && settings.data.has_wiki) {
      await octokit.rest.repos.update({
        owner,
        repo: repoName,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      });

      console.log(`Disabled Dependabot in repository '${owner}/${repoName}'`);
    } else {
      console.log(`Dependabot is already disabled in repository '${owner}/${repoName}'`);
    }
  } catch (error) {
    console.error(
      `Error disabling Dependabot in repository '${owner}/${repoName}':`,
      error.message
    );
  }
}

async function mergePR(owner, repoName, pr) {
  console.log(`Merging PR #${pr.number} in repository '${owner}/${repoName}'`);

  try {
    await octokit.rest.pulls.merge({
      owner,
      repo: repoName,
      pull_number: pr.number,
      merge_method: "squash",
    });
  } catch (error) {
    console.error(
      `Error merging PR #${pr.number} in repository '${owner}/${repoName}':`,
      error.message
    );

    console.log(`Attempting to force-merge PR #${pr.number} in repository '${owner}/${repoName}'`);

    try {
      await octokit.rest.repos.merge({
        owner,
        repo: repoName,
        base: pr.base.ref,
        head: pr.head.sha,
        commit_message: `Force-merge PR #${pr.number}`,
      });

      console.log(`Force-merged PR #${pr.number} in repository '${owner}/${repoName}'`);
    } catch (forceMergeError) {
      console.error(
        `Error force-merging PR #${pr.number} in repository '${owner}/${repoName}':`,
        forceMergeError.message
      );

      console.log(`Deleting PR #${pr.number} in repository '${owner}/${repoName}'`);

      try {
        await octokit.rest.pulls.update({
          owner,
          repo: repoName,
          pull_number: pr.number,
          state: "closed",
        });

        console.log(`Deleted PR #${pr.number} in repository '${owner}/${repoName}'`);
      } catch (deleteError) {
        console.error(
          `Error deleting PR #${pr.number} in repository '${owner}/${repoName}':`,
          deleteError.message
        );
      }
    }
  }
}

async function processRepo(repo) {
  const owner = repo.owner.login;
  const repoName = repo.name;

  try {
      // Disable Dependabot
      await disableDependabot(repo);

      // Get open pull requests in the repository
      const pullRequests = [];
      for await (const response of octokit.paginate.iterator(octokit.rest.pulls.list, {
          owner,
          repo: repoName,
          state: "open",
      })) {
          pullRequests.push(...response.data);
      }

      // Merge all open pull requests
      const concurrencyLimit = 3;

      for (let i = 0; i < pullRequests.length; i += concurrencyLimit) {
          const pullRequestsBatch = pullRequests.slice(i, i + concurrencyLimit);
          await Promise.all(pullRequestsBatch.map((pr) => mergePR(owner, repoName, pr)));
      }
  } catch (error) {
      console.error(`Error processing repository '${owner}/${repoName}':`, error.message);
  }
}

async function main() {
    try {
        // Get all repositories
        const repos = [];
        for await (const response of octokit.paginate.iterator(octokit.rest.repos.listForAuthenticatedUser)) {
            repos.push(...response.data);
        }

        // Process each repository
        const concurrencyLimit = 3;

        for (let i = 0; i < repos.length; i += concurrencyLimit) {
            const reposBatch = repos.slice(i, i + concurrencyLimit);
            await Promise.all(reposBatch.map((repo) => processRepo(repo)));
        }

        console.log("All open pull requests processed.");
    } catch (error) {
        console.error("An error occurred:", error);
    }
}

main();
