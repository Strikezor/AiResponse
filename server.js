const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
console.log("Key loaded:", Boolean(process.env.GEMINI_API_KEY));

const express = require("express");
const { Octokit } = require("@octokit/rest");

const app = express();
app.use(express.json());

// Initialize the GitHub API client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// The endpoint GitHub will hit
app.post("/webhook", async (req, res) => {
  // 🔒 SECURITY CHECK: Only allow your commits to trigger the AI
  const sender = req.body.sender?.login;
  const myUsername = "Strikezor"; // <-- CHANGE THIS TO YOUR EXACT GITHUB USERNAME

  if (sender !== myUsername) {
    console.log(
      `Ignoring push from ${sender}. Only processing commits from ${myUsername}.`,
    );
    return res.status(200).send("Ignored: Not the authorized user");
  }

  const event = req.headers["x-github-event"];

  if (event === "push") {
    const commits = req.body.commits || [];

    // Check if any commit in this push modified or added Input.txt
    const isInputModified = commits.some(
      (commit) =>
        commit.modified.includes("Input.txt") ||
        commit.added.includes("Input.txt"),
    );

    if (isInputModified) {
      console.log("✅ Detected change in Input.txt. Processing...");

      try {
        const owner = req.body.repository.owner.login;
        const repo = req.body.repository.name;

        // 1. Read the new prompt from Input.txt
        const { data: fileData } = await octokit.repos.getContent({
          owner,
          repo,
          path: "Input.txt",
        });
        const promptText = Buffer.from(fileData.content, "base64").toString(
          "utf-8",
        );
        console.log(`Prompt received: ${promptText}`);

        // 2. Generate the AI Response
        console.log("Sending prompt to Gemini...");

        // 🔧 FIX: Changed to a valid model version
        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
        });

        let result;
        try {
          result = await model.generateContent(promptText);
        } catch (error) {
          console.error("Error generating content from Gemini:", error);
          return res.status(500).send("Error generating content from Gemini.");
        }

        const aiResponse = result.response.text();
        console.log("Received response from Gemini.");

        // 3. Get the SHA of Output.txt
        let sha;
        try {
          const { data: outData } = await octokit.repos.getContent({
            owner,
            repo,
            path: "Output.txt",
          });
          sha = outData.sha;
        } catch (err) {
          // File might not exist yet, which is fine
        }

        // 4. Write the response back to Output.txt
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: "Output.txt",
          message: "docs: update Output.txt with AI response",
          content: Buffer.from(aiResponse).toString("base64"),
          sha: sha,
        });

        console.log("✅ Successfully updated Output.txt in GitHub!");
      } catch (error) {
        console.error("❌ Error interacting with GitHub:", error);
      }
    } else {
      console.log("Push received, but Input.txt was not changed.");
    }
  }

  // 🔧 FIX: Ensure we don't try to send headers twice
  if (!res.headersSent) {
    res.status(200).send("Webhook received");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
