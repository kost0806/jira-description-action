import * as core from '@actions/core';
import { ESource } from './types';
import { shouldSkipBranch } from './utils';
import { getInputs } from './action-inputs';
import { GithubConnector } from './github-connector';
import { JiraConnector } from './jira-connector';

async function run(): Promise<void> {
  const { FAIL_WHEN_JIRA_ISSUE_NOT_FOUND, USE_MULTIPLE_JIRA_ISSUES, BRANCH_IGNORE_PATTERN } = getInputs();

  try {

    const githubConnector = new GithubConnector();
    const jiraConnector = new JiraConnector();

    if (!githubConnector.isPRAction) {
      console.log('This action meant to be run only on PRs');
      setOutputs(null, null);
      process.exit(0);
    }

    if (shouldSkipBranch(githubConnector.headBranch, BRANCH_IGNORE_PATTERN)) {
      setOutputs(null, null);
      process.exit(0);
    }

    // Use multiple JIRA issues feature if enabled
    if (USE_MULTIPLE_JIRA_ISSUES) {
      const { keys, sources } = await githubConnector.getMultipleIssueKeys();

      const detailsList = [];
      const processedKeys = [];

      for (const key of keys) {
        try {
          const details = await jiraConnector.getTicketDetails(key);
          detailsList.push(details);
          processedKeys.push(key);
        } catch (error) {
          console.log(`Failed to fetch details for JIRA issue ${key}: ${error.message}`);
          if (FAIL_WHEN_JIRA_ISSUE_NOT_FOUND) {
            throw error;
          }
        }
      }

      if (detailsList.length === 0) {
        throw new Error('No valid JIRA issues found');
      }

      await githubConnector.updatePrDetailsWithMultipleIssues(detailsList);
      setMultipleOutputs(processedKeys, sources.slice(0, processedKeys.length));
    } else {
      // Use original single JIRA issue logic
      const { key, source } = githubConnector.getIssueKeyFromTitle();
      const details = await jiraConnector.getTicketDetails(key);
      await githubConnector.updatePrDetails(details);
      setOutputs(key, source);
    }
  } catch (error) {
    console.log('Failed to add JIRA description to PR.');
    core.error(error.message);
    setOutputs(null, null);
    if (FAIL_WHEN_JIRA_ISSUE_NOT_FOUND) {
      core.setFailed(error.message);
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

function setOutputs(key: string | null, source: ESource | null): void {
  var isFound = key !== null;
  core.setOutput('jira-issue-key', key);
  core.setOutput('jira-issue-found', isFound);
  core.setOutput('jira-issue-source', source || 'null');
}

// New function to set outputs for multiple JIRA issues
function setMultipleOutputs(keys: string[], sources: ESource[]): void {
  const isFound = keys.length > 0;
  core.setOutput('jira-issue-key', keys.length > 0 ? keys[0] : null); // Primary key for backward compatibility
  core.setOutput('jira-issue-keys', keys.join(','));
  core.setOutput('jira-issue-found', isFound);
  core.setOutput('jira-issue-count', keys.length);
  core.setOutput('jira-issue-source', sources.length > 0 ? sources[0] : 'null'); // Primary source for backward compatibility
  core.setOutput('jira-issue-sources', sources.join(','));
}

run();
