import { context, getOctokit } from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/parameters-and-response-types';
import { getInputs } from './action-inputs';
import { ESource, IGithubData, JIRADetails, PullRequestParams } from './types';
import { buildPRDescription, buildMultipleJIRAPRDescription, getJIRAIssueKeyByDefaultRegexp, getJIRAIssueKeysByDefaultRegexp, getJIRAIssueKeysByCustomRegexp, getMultipleJIRAIssueKeysByCustomRegexp, getPRDescription } from './utils';

export class GithubConnector {
  githubData: IGithubData = {} as IGithubData;
  octokit: InstanceType<typeof GitHub>;

  constructor() {
    const { GITHUB_TOKEN } = getInputs();

    this.octokit = getOctokit(GITHUB_TOKEN);

    this.githubData = this.getGithubData();
  }

  get isPRAction(): boolean {
    return this.githubData.eventName === 'pull_request' || this.githubData.eventName === 'pull_request_target';
  }

  get headBranch(): string {
    return this.githubData.pullRequest.head.ref;
  }

  getIssueKeyFromTitle(): { key: string; source: ESource } {
    const { WHAT_TO_USE } = getInputs();

    const prTitle = this.githubData.pullRequest.title || '';
    const branchName = this.headBranch;

    let keyFound: string | null = null;
    let source: ESource | null = null;

    switch (WHAT_TO_USE) {
      case ESource.branch:
        keyFound = this.getIssueKeyFromString(branchName);
        source = keyFound ? ESource.branch : null;
        break;
      case ESource.prTitle:
        keyFound = this.getIssueKeyFromString(prTitle);
        source = keyFound ? ESource.prTitle : null;
        break;
      case ESource.both:
        const keyByPRTitle = this.getIssueKeyFromString(prTitle);
        if (keyByPRTitle) {
          keyFound = keyByPRTitle;
          source = ESource.prTitle;
        } else {
          keyFound = this.getIssueKeyFromString(branchName);
          source = keyFound ? ESource.branch : null;
        }
        break;
    }

    if (!keyFound || !source) {
      throw new Error('JIRA key not found');
    }
    console.log(`JIRA key found -> ${keyFound} from ${source}`);
    return { key: keyFound, source };
  }

  // New method to get multiple JIRA issue keys from all sources
  async getMultipleIssueKeys(): Promise<{ keys: string[]; sources: ESource[] }> {
    const { WHAT_TO_USE } = getInputs();

    const prTitle = this.githubData.pullRequest.title || '';
    const branchName = this.headBranch;
    const commitMessages = await this.getCommitMessages();

    const allKeys: string[] = [];
    const sources: ESource[] = [];

    // Extract from branch name
    if (WHAT_TO_USE === ESource.branch || WHAT_TO_USE === ESource.both || WHAT_TO_USE === ESource.all) {
      const branchKeys = this.getIssueKeysFromString(branchName);
      if (branchKeys.length > 0) {
        allKeys.push(...branchKeys);
        sources.push(...Array(branchKeys.length).fill(ESource.branch));
        console.log(`JIRA keys found in branch -> ${branchKeys.join(', ')}`);
      }
    }

    // Extract from PR title
    if (WHAT_TO_USE === ESource.prTitle || WHAT_TO_USE === ESource.both || WHAT_TO_USE === ESource.all) {
      const titleKeys = this.getIssueKeysFromString(prTitle);
      if (titleKeys.length > 0) {
        allKeys.push(...titleKeys);
        sources.push(...Array(titleKeys.length).fill(ESource.prTitle));
        console.log(`JIRA keys found in PR title -> ${titleKeys.join(', ')}`);
      }
    }

    // Extract from commit messages
    if (WHAT_TO_USE === ESource.commits || WHAT_TO_USE === ESource.all) {
      const commitKeys = this.getIssueKeysFromCommitMessages(commitMessages);
      if (commitKeys.length > 0) {
        allKeys.push(...commitKeys);
        sources.push(...Array(commitKeys.length).fill(ESource.commits));
        console.log(`JIRA keys found in commits -> ${commitKeys.join(', ')}`);
      }
    }

    // Remove duplicates while preserving order
    const uniqueKeys: string[] = [];
    const uniqueSources: ESource[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      if (!seen.has(key)) {
        seen.add(key);
        uniqueKeys.push(key);
        uniqueSources.push(sources[i]);
      }
    }

    if (uniqueKeys.length === 0) {
      throw new Error('No JIRA keys found');
    }

    console.log(`Total unique JIRA keys found: ${uniqueKeys.length} -> ${uniqueKeys.join(', ')}`);
    return { keys: uniqueKeys, sources: uniqueSources };
  }

  private getIssueKeyFromString(stringToParse: string): string | null {
    const { JIRA_PROJECT_KEY, CUSTOM_ISSUE_NUMBER_REGEXP } = getInputs();
    const shouldUseCustomRegexp = !!CUSTOM_ISSUE_NUMBER_REGEXP;

    console.log(`looking in: ${stringToParse}`);

    return shouldUseCustomRegexp
      ? getJIRAIssueKeysByCustomRegexp(stringToParse, CUSTOM_ISSUE_NUMBER_REGEXP, JIRA_PROJECT_KEY)
      : getJIRAIssueKeyByDefaultRegexp(stringToParse);
  }

  // New method to get multiple JIRA issue keys from a string
  private getIssueKeysFromString(stringToParse: string): string[] {
    const { JIRA_PROJECT_KEY, CUSTOM_ISSUE_NUMBER_REGEXP } = getInputs();
    const shouldUseCustomRegexp = !!CUSTOM_ISSUE_NUMBER_REGEXP;

    console.log(`looking for multiple keys in: ${stringToParse}`);

    return shouldUseCustomRegexp
      ? getMultipleJIRAIssueKeysByCustomRegexp(stringToParse, CUSTOM_ISSUE_NUMBER_REGEXP, JIRA_PROJECT_KEY)
      : getJIRAIssueKeysByDefaultRegexp(stringToParse);
  }

  // Method to get commit messages from the PR
  private async getCommitMessages(): Promise<string[]> {
    const owner = this.githubData.owner;
    const repo = this.githubData.repository.name;
    const prNumber = this.githubData.pullRequest.number;

    try {
      const { data: commits } = await this.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
      });

      return commits.map(commit => commit.commit.message);
    } catch (error) {
      console.log('Failed to fetch commit messages:', error);
      return [];
    }
  }

  // Method to extract JIRA keys from commit messages
  private getIssueKeysFromCommitMessages(commitMessages: string[]): string[] {
    const allKeys: string[] = [];

    for (const message of commitMessages) {
      const keys = this.getIssueKeysFromString(message);
      allKeys.push(...keys);
    }

    return allKeys;
  }

  async updatePrDetails(details: JIRADetails) {
    const owner = this.githubData.owner;
    const repo = this.githubData.repository.name;
    console.log('Updating PR details');
    const { number: prNumber = 0 } = this.githubData.pullRequest;
    const recentBody = await this.getLatestPRDescription({ repo, owner, number: this.githubData.pullRequest.number });

    const prData: RestEndpointMethodTypes['pulls']['update']['parameters'] = {
      owner,
      repo,
      pull_number: prNumber,
      body: getPRDescription(recentBody, buildPRDescription(details)),
    };

    return await this.octokit.rest.pulls.update(prData);
  }

  // New method to update PR details with multiple JIRA issues
  async updatePrDetailsWithMultipleIssues(detailsList: JIRADetails[]) {
    const owner = this.githubData.owner;
    const repo = this.githubData.repository.name;
    console.log(`Updating PR details with ${detailsList.length} JIRA issues`);
    const { number: prNumber = 0 } = this.githubData.pullRequest;
    const recentBody = await this.getLatestPRDescription({ repo, owner, number: this.githubData.pullRequest.number });

    const prData: RestEndpointMethodTypes['pulls']['update']['parameters'] = {
      owner,
      repo,
      pull_number: prNumber,
      body: getPRDescription(recentBody, buildMultipleJIRAPRDescription(detailsList)),
    };

    return await this.octokit.rest.pulls.update(prData);
  }

  // PR description may have been updated by some other action in the same job, need to re-fetch it to get the latest
  async getLatestPRDescription({ owner, repo, number }: { owner: string; repo: string; number: number }): Promise<string> {
    return this.octokit.rest.pulls
      .get({
        owner,
        repo,
        pull_number: number,
      })
      .then(({ data }: RestEndpointMethodTypes['pulls']['get']['response']) => {
        return data.body || '';
      });
  }

  private getGithubData(): IGithubData {
    const {
      eventName,
      payload: { repository, pull_request: pullRequest },
    } = context;

    let owner: IGithubData['owner'] | undefined;

    if (context?.payload?.organization) {
      owner = context?.payload?.organization?.login;
    } else {
      console.log('Could not find organization, using repository owner instead.');
      owner = context.payload.repository?.owner.login;
    }

    if (!owner) {
      throw new Error('Could not find owner.');
    }

    return {
      eventName,
      repository,
      owner,
      pullRequest: pullRequest as PullRequestParams,
    };
  }
}
