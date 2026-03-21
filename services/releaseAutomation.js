const { createPullRequest, enableAutoComplete } = require("./azureDevOpsService");
const { sendToTeams } = require("./teamsNotifier");
const { sendToSlack } = require("./slackNotifier");

const AZURE_DEVOPS_SOURCE_BRANCH = process.env.AZURE_DEVOPS_SOURCE_BRANCH || "master";
const AZURE_DEVOPS_TARGET_BRANCH = process.env.AZURE_DEVOPS_TARGET_BRANCH || "release/production";
const APPLE_EVENT_TRIGGER = process.env.APPLE_EVENT_TRIGGER || "READY_FOR_SALE";

/**
 * Checks whether an Apple webhook payload should trigger a PR,
 * and if so, creates the PR in Azure DevOps with auto-complete.
 *
 * @param {object} payload - The full Apple webhook payload
 * @returns {Promise<{pullRequestId: number, url: string} | null>} PR info, or null if skipped
 */
async function handleAppPublished(payload) {
  const eventType = payload.data?.type;
  const newState = payload.data?.attributes?.newValue;

  if (eventType !== "appStoreVersionAppVersionStateUpdated") {
    return null;
  }

  if (newState !== APPLE_EVENT_TRIGGER) {
    return null;
  }

  if (!process.env.AZURE_DEVOPS_PAT) {
    console.warn("⚠️ AZURE_DEVOPS_PAT not configured. Skipping PR creation.");
    return null;
  }

  const versionId = payload.data?.relationships?.instance?.data?.id || "unknown";

  const title = `Release: merge ${AZURE_DEVOPS_SOURCE_BRANCH} to ${AZURE_DEVOPS_TARGET_BRANCH}`;
  const description = [
    `App version is now **${newState}** (Live on the App Store).`,
    "",
    `- Version ID: \`${versionId}\``,
    `- Source: \`${AZURE_DEVOPS_SOURCE_BRANCH}\``,
    `- Target: \`${AZURE_DEVOPS_TARGET_BRANCH}\``,
    "",
    "Automatically created by [appstore-webhook-proxy](https://github.com/yannisalexiou/appstore-webhook-proxy).",
  ].join("\n");

  try {
    const result = await createPullRequest(
      AZURE_DEVOPS_SOURCE_BRANCH,
      AZURE_DEVOPS_TARGET_BRANCH,
      title,
      description,
    );

    if (!result) {
      // PR already exists (409) — not an error
      return null;
    }

    await enableAutoComplete(result.pullRequestId);

    console.log(`✅ Release PR #${result.pullRequestId} created and auto-complete enabled: ${result.url}`);
    return result;
  } catch (error) {
    console.error("❌ Failed to create Azure DevOps PR:", error.response?.data || error.message);

    // Notify Teams/Slack about the failure so the team can act manually
    await notifyPRCreationFailure(error, versionId);

    return null;
  }
}

/**
 * Sends a failure notification to Teams/Slack when PR creation fails.
 */
async function notifyPRCreationFailure(error, versionId) {
  const statusCode = error.response?.status || "N/A";
  const errorMessage = error.response?.data?.message || error.message || "Unknown error";

  const failurePayload = {
    data: {
      type: "azureDevOpsPRCreationFailed",
      attributes: {
        timestamp: new Date().toISOString(),
        newValue: "PR_CREATION_FAILED",
        oldValue: "",
      },
      relationships: {
        instance: { data: { id: versionId } },
      },
    },
  };

  // Build a minimal Teams MessageCard for the failure
  const teamsMessage = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: "FF0000",
    summary: "Azure DevOps PR Creation Failed",
    sections: [
      {
        activityTitle: "❌ Failed to Create Release PR",
        activitySubtitle: "appstore-webhook-proxy → Azure DevOps",
        activityImage:
          "https://developer.apple.com/assets/elements/icons/app-store/app-store-128x128_2x.png",
        facts: [
          { name: "Error", value: errorMessage },
          { name: "HTTP Status", value: `${statusCode}` },
          { name: "Version ID", value: versionId },
          { name: "Source", value: AZURE_DEVOPS_SOURCE_BRANCH },
          { name: "Target", value: AZURE_DEVOPS_TARGET_BRANCH },
          { name: "Action Required", value: "Create the PR manually or check PAT expiry." },
        ],
        markdown: true,
      },
    ],
  };

  const slackMessage = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "❌ Failed to Create Release PR",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Error:*\n${errorMessage}` },
          { type: "mrkdwn", text: `*HTTP Status:*\n${statusCode}` },
          { type: "mrkdwn", text: `*Version ID:*\n${versionId}` },
          { type: "mrkdwn", text: `*Source → Target:*\n${AZURE_DEVOPS_SOURCE_BRANCH} → ${AZURE_DEVOPS_TARGET_BRANCH}` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "⚠️ *Action Required:* Create the PR manually or check PAT expiry." },
        ],
      },
    ],
  };

  try {
    if (process.env.TEAMS_WEBHOOK_URL) {
      const axios = require("axios");
      await axios.post(process.env.TEAMS_WEBHOOK_URL, teamsMessage);
    }
    if (process.env.SLACK_WEBHOOK_URL) {
      const axios = require("axios");
      await axios.post(process.env.SLACK_WEBHOOK_URL, slackMessage);
    }
  } catch (notifyError) {
    console.error("❌ Failed to send PR failure notification:", notifyError.message);
  }
}

module.exports = { handleAppPublished };
