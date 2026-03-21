const axios = require("axios");

const AZURE_DEVOPS_ORG_URL = process.env.AZURE_DEVOPS_ORG_URL;
const AZURE_DEVOPS_PROJECT = process.env.AZURE_DEVOPS_PROJECT;
const AZURE_DEVOPS_REPO_ID = process.env.AZURE_DEVOPS_REPO_ID;
const AZURE_DEVOPS_PAT = process.env.AZURE_DEVOPS_PAT;

function getAuthHeader() {
  const token = Buffer.from(`:${AZURE_DEVOPS_PAT}`).toString("base64");
  return `Basic ${token}`;
}

function getBaseUrl() {
  const orgUrl = AZURE_DEVOPS_ORG_URL.replace(/\/+$/, "");
  return `${orgUrl}/${AZURE_DEVOPS_PROJECT}/_apis/git/repositories/${AZURE_DEVOPS_REPO_ID}`;
}

/**
 * Creates a pull request in Azure DevOps.
 *
 * @param {string} sourceBranch - Branch name without refs/heads/ prefix (e.g. "master")
 * @param {string} targetBranch - Branch name without refs/heads/ prefix (e.g. "release/production")
 * @param {string} title - PR title
 * @param {string} description - PR description
 * @returns {Promise<{pullRequestId: number, url: string} | null>} PR info or null if PR already exists
 */
async function createPullRequest(sourceBranch, targetBranch, title, description) {
  const url = `${getBaseUrl()}/pullrequests?api-version=7.1-preview.1`;

  const body = {
    sourceRefName: `refs/heads/${sourceBranch}`,
    targetRefName: `refs/heads/${targetBranch}`,
    title,
    description,
    completionOptions: {
      mergeStrategy: "squash",
      deleteSourceBranch: false,
      transitionWorkItems: true,
      autoCompleteIgnoreConfigIds: [],
    },
    isDraft: false,
  };

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
    });

    const prId = response.data.pullRequestId;
    const prUrl = `${response.data.repository?.webUrl || ""}/pullrequest/${prId}`;

    console.log(`✅ Azure DevOps PR #${prId} created: ${sourceBranch} → ${targetBranch}`);
    return { pullRequestId: prId, url: prUrl };
  } catch (error) {
    if (error.response?.status === 409) {
      console.log(`ℹ️ PR already exists from ${sourceBranch} → ${targetBranch}. Skipping.`);
      return null;
    }
    throw error;
  }
}

/**
 * Enables auto-complete on a pull request so it merges automatically
 * once all policies pass.
 *
 * @param {number} pullRequestId - The PR ID to enable auto-complete on
 */
async function enableAutoComplete(pullRequestId) {
  const orgUrl = AZURE_DEVOPS_ORG_URL.replace(/\/+$/, "");

  // Step 1: Get the authenticated user's ID
  const connectionUrl = `${orgUrl}/_apis/connectionData?api-version=7.1-preview.1`;
  const connectionResponse = await axios.get(connectionUrl, {
    headers: { Authorization: getAuthHeader() },
  });
  const userId = connectionResponse.data.authenticatedUser.id;

  // Step 2: PATCH the PR to set autoCompleteSetBy
  const prUrl = `${getBaseUrl()}/pullrequests/${pullRequestId}?api-version=7.1-preview.1`;
  const patchBody = {
    autoCompleteSetBy: { id: userId },
    completionOptions: {
      mergeStrategy: "squash",
      deleteSourceBranch: false,
      transitionWorkItems: true,
      autoCompleteIgnoreConfigIds: [],
    },
  };

  await axios.patch(prUrl, patchBody, {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  console.log(`✅ Auto-complete enabled on PR #${pullRequestId}`);
}

module.exports = { createPullRequest, enableAutoComplete };
