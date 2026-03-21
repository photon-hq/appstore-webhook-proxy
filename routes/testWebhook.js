const express = require("express");
const router = express.Router();

const { sendToTeams } = require("../services/teamsNotifier");
const { sendToSlack } = require("../services/slackNotifier");
const { handleAppPublished } = require("../services/releaseAutomation");

const ENABLE_TEST_ENDPOINT = process.env.ENABLE_TEST_ENDPOINT === "true";
const INTERNAL_TEST_TOKEN = process.env.INTERNAL_TEST_TOKEN;

router.post("/", async (req, res) => {
  // Safety gate
  if (!ENABLE_TEST_ENDPOINT) {
    return res.status(404).json({ error: "Test endpoint disabled" });
  }

  if (INTERNAL_TEST_TOKEN) {
    const provided = req.header("x-internal-token");
    if (provided !== INTERNAL_TEST_TOKEN) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const payload = req.body;
  if (!payload || !payload.data?.type) {
    return res.status(400).json({
      error:
        "Invalid payload. Expected Apple-style JSON with 'data.type'.",
    });
  }

  try {
    console.log(`🧪 Simulating Apple event: ${payload.data.type}`);

    const results = {
      slack: "skipped",
      teams: "skipped",
      azureDevOps: "skipped",
    };

    if (process.env.SLACK_WEBHOOK_URL) {
      await sendToSlack(payload, process.env.SLACK_WEBHOOK_URL);
      results.slack = "sent";
    }

    if (process.env.TEAMS_WEBHOOK_URL) {
      await sendToTeams(payload, process.env.TEAMS_WEBHOOK_URL);
      results.teams = "sent";
    }

    // Azure DevOps: create release PR when app goes live
    try {
      const prResult = await handleAppPublished(payload);
      if (prResult) {
        results.azureDevOps = `PR #${prResult.pullRequestId} created`;
      } else {
        results.azureDevOps = "skipped (event not matched or PR exists)";
      }
    } catch (prError) {
      results.azureDevOps = `error: ${prError.message}`;
    }

    res.status(200).json({
      ok: true,
      receivedType: payload.data.type,
      results,
    });
  } catch (err) {
    console.error("❌ Error while sending test payload:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;